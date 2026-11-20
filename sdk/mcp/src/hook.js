// The logic behind the Claude Code hook script and the Claude Agent SDK hooks:
// ask the plane before a risky shell command, block unless admitted, and
// report how it went.

import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
import { MAX_CONTEXT_BYTES } from "@floodwall/client";
import { configFromEnv, createClient } from "./config.js";

/** Commands that change things. `rollout` only when it restarts or undoes; `rollout status` is a read. */
export const DEFAULT_PATTERNS = [
  String.raw`\bkubectl\b.*\b(apply|delete|scale|replace|patch|rollout\s+(restart|undo|pause|resume))\b`,
  String.raw`\bterraform\b.*\b(apply|destroy)\b`,
  String.raw`\bhelm\b.*\b(install|upgrade|uninstall)\b`,
];

/** Patterns from FLOODWALL_HOOK_PATTERNS (a JSON array of regexes, or one per line), else the defaults. */
export function patternsFromEnv(env = process.env) {
  const raw = env.FLOODWALL_HOOK_PATTERNS?.trim();
  if (!raw) return DEFAULT_PATTERNS.map((p) => new RegExp(p, "i"));
  const sources = raw.startsWith("[") ? JSON.parse(raw) : raw.split("\n").map((l) => l.trim()).filter(Boolean);
  return sources.map((p) => new RegExp(p, "i"));
}

/** Command substitution, process substitution, eval and `sh -c`: ways to hide a command from a pattern. */
const INDIRECTION = /\$\(|`|<\(|>\(|\beval\b|\b(?:sh|bash|zsh|dash|ksh)\s+(?:-\w+\s+)*-\w*c\b/;

/**
 * Find what the command would run that needs asking about.
 * Resolves to `{ none: true }` (nothing risky), `{ segment }` (exactly one risky command),
 * or `{ refuse }` (several, or one hidden behind indirection: ask for one guarded command per call).
 */
export function matchCommand(command, patterns) {
  if (typeof command !== "string") return { none: true };
  const joined = command.replace(/\\\r?\n/g, " "); // backslash-newline continuations
  const plain = (text) => text.replace(/["'\\]/g, ""); // quotes and backslashes can split a word: k\ubectl
  const refuse = {
    refuse:
      "Blocked by Floodwall: run one guarded command per Bash call (no chaining with && || ; | &, no $( ), backticks, eval, sh -c or variables around a change). Split it up and run each change on its own.",
  };
  const segments = joined
    .split(/&&|\|\||[;|&\n]/)
    .map((seg) => plain(seg).trim())
    .filter(Boolean);
  const matched = segments.filter((seg) => patterns.some((p) => p.test(seg)));
  if (matched.length > 1 || (matched.length === 1 && INDIRECTION.test(joined))) return refuse;
  if (matched.length === 1) return { segment: matched[0] };
  // Nothing matched, but a change tool is named somewhere other than as the command a
  // segment runs, next to a change verb (`K=kubectl; $K delete x`): it is hidden from the
  // patterns, so ask for it plainly. A segment that runs the tool itself was read and found
  // harmless (`kubectl rollout status`, `kubectl get pods | grep delete`).
  const TOOL = /\b(kubectl|terraform|helm)\b/i;
  // The segment's command word, after any `VAR=value` assignments and `sudo`: word by word, no regex backtracking.
  const runsTool = (seg) => {
    const words = seg.split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i += 1;
    if (words[i]?.toLowerCase() === "sudo") i += 1;
    const command = (words[i] ?? "").split("/").pop().toLowerCase();
    return command === "kubectl" || command === "terraform" || command === "helm";
  };
  const hidden = segments.some((seg) => TOOL.test(seg) && !runsTool(seg));
  if (hidden && /\b(apply|delete|scale|replace|patch|rollout|destroy|install|upgrade|uninstall)\b/i.test(plain(joined))) {
    return refuse;
  }
  return { none: true };
}

const KIND_ALIASES = {
  deploy: "deployment", deployments: "deployment", svc: "service", services: "service", ns: "namespace", namespaces: "namespace",
  sts: "statefulset", statefulsets: "statefulset", ds: "daemonset", daemonsets: "daemonset", cm: "configmap", configmaps: "configmap",
  po: "pod", pods: "pod",
};
const normKind = (kind) => {
  const k = String(kind).toLowerCase().replace(/\.[a-z0-9.]+$/, "");
  return KIND_ALIASES[k] ?? k;
};

const TAKES_VALUE = new Set(["-n", "--namespace", "-l", "--selector", "-f", "--filename", "-k", "--kustomize", "--context", "--replicas", "--kubeconfig", "-o", "--output", "--set", "--values", "--version", "--timeout", "--kube-context", "-c", "--container", "--cluster", "--user", "--type", "-p", "--patch"]);

/** Words that are neither flags nor the values of the flags that take one in a separate word. */
function positionals(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i].startsWith("-")) {
      if (TAKES_VALUE.has(words[i])) i++;
    } else out.push(words[i]);
  }
  return out;
}

/** Every value given for a flag: `-n prod`, `-n=prod`, `--namespace prod`, and kubectl's attached `-nprod`. */
function flagValues(words, ...names) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    for (const name of names) {
      if (words[i] === name) out.push(words[i + 1]);
      else if (words[i].startsWith(`${name}=`)) out.push(words[i].slice(name.length + 1));
      else if (/^-[A-Za-z]$/.test(name) && words[i].startsWith(name) && words[i].length > 2) out.push(words[i].slice(2));
    }
  }
  return out;
}

function flagValue(words, ...names) {
  return flagValues(words, ...names)[0];
}

/** What cannot be read as a known change is treated as the worst: a global destroy. */
const unparseable = (segment, priority) => ({
  action: { kind: "destroy", resource: `shell:${segment.slice(0, 120)}` },
  blastRadius: "global",
  priority,
});

/**
 * Turn the one matched command into the change the plane rules on. Kubernetes resources are
 * `<context>/<namespace>/<kind>/<name>` (a missing context or namespace is `-`); terraform is
 * `terraform:<dir>`; anything else is `shell:<command>`. A command that matched but cannot be
 * read is a global destroy. Reading `-f` files for the resource needs the file inside `cwd`.
 */
export function inferChange(segment, { cwd = process.cwd(), blastRadius = "service", priority = "normal", withContext = false } = {}) {
  const words = segment.split(/\s+/);
  const base = { blastRadius, priority };
  const manifest = segment.slice(0, 500);

  if (/\bkubectl\b/i.test(segment)) {
    const ctx = flagValue(words, "--context") ?? "-";
    const flagNs = flagValue(words, "-n", "--namespace");
    const kubeIdx = words.findIndex((w) => /(^|\/)kubectl$/i.test(w));
    const pos = positionals(words.slice(kubeIdx + 1));
    const verb = pos[0]?.toLowerCase();
    const rest = pos.slice(1);
    const at = (kind, name, ns) => {
      const k = normKind(kind);
      return `${ctx}/${k === "namespace" ? "-" : (flagNs ?? ns ?? "-")}/${k}/${name}`;
    };
    // One object only: anything that names more (several names, several -f, a file with several
    // documents) is ruled on as unreadable, never as its first object.
    const MANY = Symbol("many");
    const target = (list) => {
      const [first, second] = list;
      if (!first) return null;
      if (first.includes("/")) {
        const [kind, name] = first.split("/");
        if (list.length > 1) return MANY;
        return kind && name ? { kind, name } : null;
      }
      if (list.length > 2) return MANY;
      return second && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(second) ? { kind: first, name: second } : null;
    };
    const files = flagValues(words, "-f", "--filename");
    const fromFile = () => {
      if (files.length > 1) return MANY;
      const text = files[0] && readManifest(files[0], cwd);
      if (text === undefined || text === null) return null;
      const doc = firstDocument(text);
      if (doc.many) return MANY;
      return doc.kind && doc.name ? { ...doc, text } : null;
    };
    // Names and a file together: kubectl acts on both, so neither alone is the change.
    const one = (named, filed) => {
      if (named === MANY || filed === MANY || (named && filed)) return MANY;
      return named ?? filed;
    };

    if (verb === "scale") {
      const replicas = Number(flagValue(words, "--replicas"));
      const t = one(target(rest), files.length ? fromFile() ?? MANY : null);
      if (t && t !== MANY && Number.isInteger(replicas) && replicas >= 0) return { ...base, action: { kind: "scale", resource: at(t.kind, t.name), replicas } };
      return unparseable(segment, priority);
    }
    if (verb === "delete") {
      const t = one(target(rest), files.length ? fromFile() ?? MANY : null);
      if (!t || t === MANY || rest.includes("all") || words.includes("--all") || words.includes("-A") || flagValue(words, "-l", "--selector")) return unparseable(segment, priority);
      return { ...base, action: { kind: "destroy", resource: at(t.kind, t.name, t.namespace) } };
    }
    if (verb === "rollout") {
      const t = ["restart", "undo", "pause", "resume"].includes(rest[0]?.toLowerCase()) ? one(target(rest.slice(1)), files.length ? MANY : null) : null;
      if (!t || t === MANY) return unparseable(segment, priority);
      return { ...base, action: { kind: "apply", resource: at(t.kind, t.name), manifest } };
    }
    if (verb === "apply" || verb === "replace" || verb === "patch") {
      const f = verb === "patch" ? (files.length ? MANY : null) : files.length ? fromFile() ?? MANY : null;
      const t = one(target(rest), f);
      if (!t || t === MANY) return unparseable(segment, priority);
      const change = { ...base, action: { kind: "apply", resource: at(t.kind, t.name, t.namespace), manifest } };
      if (f && withContext) change.context = redactedContext(f.text);
      return change;
    }
    return unparseable(segment, priority);
  }
  if (/\bterraform\b/i.test(segment)) {
    const dir = flagValue(words, "-chdir");
    const resource = `terraform:${basename(resolve(cwd, dir ?? "."))}`;
    if (words.some((w) => w.toLowerCase() === "destroy")) return { ...base, action: { kind: "destroy", resource } };
    if (words.some((w) => w.toLowerCase() === "apply")) return { ...base, action: { kind: "apply", resource, manifest } };
    return unparseable(segment, priority);
  }
  if (/\bhelm\b/i.test(segment)) {
    const helmIdx = words.findIndex((w) => /(^|\/)helm$/i.test(w));
    const pos = positionals(words.slice(helmIdx + 1));
    const verb = pos[0]?.toLowerCase();
    if (!["install", "upgrade", "uninstall"].includes(verb) || !pos[1]) return unparseable(segment, priority);
    const ctx = flagValue(words, "--kube-context") ?? "-";
    const ns = flagValue(words, "-n", "--namespace") ?? "-";
    const resource = `${ctx}/${ns}/helm/${pos[1]}`;
    return { ...base, action: verb === "uninstall" ? { kind: "destroy", resource } : { kind: "apply", resource, manifest } };
  }
  const destructive = /\b(delete|destroy|uninstall|remove|rm|drop|purge)\b/.test(segment);
  const resource = `shell:${segment.slice(0, 120)}`;
  return { ...base, action: destructive ? { kind: "destroy", resource } : { kind: "apply", resource, manifest } };
}

/** A `-f` file's text when it is a small .yaml/.yml/.json regular file inside `cwd`; else undefined. */
function readManifest(file, cwd) {
  try {
    if (!file || file === "-" || /^[a-z]+:\/\//i.test(file)) return undefined;
    if (![".yaml", ".yml", ".json"].includes(extname(file).toLowerCase())) return undefined;
    const root = realpathSync(cwd);
    const path = realpathSync(resolve(root, file));
    if (path !== root && !path.startsWith(root.endsWith(sep) ? root : root + sep)) return undefined;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_CONTEXT_BYTES) return undefined;
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** kind, metadata.name and metadata.namespace of the first document: a simple line parse for YAML. */
export function firstDocument(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      let doc = JSON.parse(trimmed);
      if (Array.isArray(doc)) {
        if (doc.length > 1) return { many: true };
        doc = doc[0];
      }
      if (/^list$/i.test(String(doc?.kind ?? "")) || /List$/.test(String(doc?.kind ?? ""))) return { many: true };
      return { kind: doc?.kind, name: doc?.metadata?.name, namespace: doc?.metadata?.namespace };
    } catch {
      return {};
    }
  }
  const docs = text.split(/^---\s*$/m).filter((d) => d.trim() && !d.trim().split("\n").every((l) => l.trim().startsWith("#")));
  if (docs.length > 1) return { many: true };
  const doc = docs[0] ?? "";
  const lines = doc.split("\n");
  const out = { kind: lines.map((l) => /^kind:\s*["']?([A-Za-z0-9.]+)/.exec(l)).find(Boolean)?.[1] };
  if (out.kind && /List$/.test(out.kind)) return { many: true };
  const at = lines.findIndex((l) => /^metadata:\s*$/.test(l));
  if (at >= 0) {
    let indent = null;
    for (const line of lines.slice(at + 1)) {
      if (!line.trim() || line.trim().startsWith("#")) continue;
      const lead = line.length - line.trimStart().length;
      if (lead === 0) break;
      indent ??= lead;
      if (lead !== indent) continue;
      const m = /^\s+(name|namespace):\s*["']?([^"'#\s]+)/.exec(line);
      if (m) out[m[1]] = m[2];
    }
  }
  return out;
}

const SENSITIVE_KEY = /^(?:data|stringdata)$|password|passwd|secret|token|api[_-]?key|private[_-]?key/i;

/**
 * The manifest as AI-review context. Any Secret (a document, or an item nested in a List, at any
 * indentation) is dropped, whole `data:`/`stringData:` blocks and values under keys like password,
 * secret, token, api key and private key are replaced. Undefined if nothing is left.
 */
export function redactedContext(text) {
  const trimmed = text.trimStart();
  let out;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const scrub = (v) => {
        if (Array.isArray(v)) return v.filter((x) => x?.kind !== "Secret").map(scrub);
        if (v && typeof v === "object") {
          return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : scrub(x)]));
        }
        return v;
      };
      const doc = JSON.parse(trimmed);
      if (doc?.kind === "Secret") return undefined;
      out = JSON.stringify(scrub(doc), null, 2);
    } catch {
      return undefined;
    }
  } else {
    // A Secret anywhere in the text (own document or nested in a List): share nothing at all.
    if (/^\s*(?:-\s+)?["']?kind["']?\s*:\s*["']?Secret["']?\s*(?:#.*)?$/im.test(text)) return undefined;
    const lines = text.split("\n");
    const result = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const block = /^(\s*(?:-\s+)?)(?:data|stringData)\s*:\s*(?:#.*)?$/.exec(line);
      if (block) {
        const indent = block[1].length;
        result.push(`${line.replace(/\s*(?:#.*)?$/, "")} [redacted]`);
        while (i + 1 < lines.length && (!lines[i + 1].trim() || lines[i + 1].length - lines[i + 1].trimStart().length > indent)) i++;
        continue;
      }
      result.push(
        line.replace(/^(\s*-?\s*["']?[\w.-]*(?:password|passwd|secret|token|api[_-]?key|private[_-]?key)[\w.-]*["']?\s*:)\s*\S.*$/i, "$1 [redacted]"),
      );
    }
    out = result.join("\n");
  }
  if (!out.trim() || new TextEncoder().encode(out).length > MAX_CONTEXT_BYTES) return undefined;
  return out;
}

// --- state: which intent belongs to which tool call ---

/**
 * The private directory for saved intent keys; throws unless it is a real 0700 directory we own.
 * Windows has no POSIX modes (a directory always reads as 0666, or 0444 read-only), so there the
 * mode is not checked: the default, in the user's own temp directory, is private by its ACL.
 */
export function stateDir(env) {
  const runtime = env.XDG_RUNTIME_DIR;
  const dir =
    env.FLOODWALL_HOOK_STATE_DIR ||
    (runtime ? join(runtime, "floodwall-hook") : join(tmpdir(), `floodwall-hook-${process.getuid?.() ?? "u"}`));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`state directory ${dir} is not a plain directory`);
  if (process.getuid && stat.uid !== process.getuid()) throw new Error(`state directory ${dir} is not owned by this user`);
  if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700) throw new Error(`state directory ${dir} must have mode 0700`);
  return dir;
}

const stateFile = (env, toolUseId) => join(stateDir(env), `${String(toolUseId).replace(/[^A-Za-z0-9_-]/g, "_")}.json`);

function remember(env, toolUseId, key) {
  const file = stateFile(env, toolUseId);
  try {
    unlinkSync(file);
  } catch {
    // Nothing to replace.
  }
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    writeSync(fd, JSON.stringify(key));
  } finally {
    closeSync(fd);
  }
}

function recall(env, toolUseId) {
  const file = stateFile(env, toolUseId);
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    if (!fstatSync(fd).isFile()) return null;
    return JSON.parse(readFileSync(fd, "utf8"));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
}

// --- the hook ---

const ADMITTED = new Set(["admit", "in_flight"]);

/**
 * Handle one hook event (Claude Code's stdin JSON, or the Agent SDK callback input).
 *
 * Resolves to `{ block: string }` to refuse the tool call, or `{}` to leave it to
 * Claude Code's usual permission flow. Never throws: failing to get an answer from
 * the plane blocks unless `FLOODWALL_FAIL_OPEN=1`.
 *
 * @param {object} input the hook input (hook_event_name, tool_name, tool_input, tool_use_id, cwd, error…)
 * @param {object} [options]
 * @param {import("@floodwall/client").Floodwall} [options.client] defaults to one built from the environment
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {(message: string) => void} [options.warn]
 */
export async function handleHook(input, { client, env = process.env, warn = (m) => console.error(m) } = {}) {
  try {
    switch (input?.hook_event_name) {
      case "PreToolUse":
        return await pre(input, { client, env, warn });
      case "PostToolUse":
        return await post(input, "succeeded", undefined, { client, env, warn });
      case "PostToolUseFailure":
        return await post(input, "failed", input.error, { client, env, warn });
      default:
        return {};
    }
  } catch (error) {
    // Only reachable from a bug here; for a PreToolUse that means we could not ask.
    return input?.hook_event_name === "PreToolUse" ? unreachableOutcome(error, env, warn) : {};
  }
}

function unreachableOutcome(error, env, warn) {
  const why = error?.message ?? String(error);
  if (env.FLOODWALL_FAIL_OPEN === "1") {
    warn(`floodwall: could not ask the plane (${why}); FLOODWALL_FAIL_OPEN=1 so the command runs unchecked`);
    return {};
  }
  return {
    block:
      `Blocked by Floodwall: the plane could not be asked (${why}). The change is NOT approved. ` +
      "Do not run this command another way; tell the user Floodwall is unreachable.",
  };
}

async function pre(input, { client, env, warn }) {
  if (input.tool_name !== "Bash") return {};
  const found = matchCommand(input.tool_input?.command, patternsFromEnv(env));
  if (found.none) return {};
  if (found.refuse) return { block: found.refuse };
  const { segment } = found;

  // Without somewhere safe to note the intent, an admitted change could never be reported: refuse.
  if (input.tool_use_id) {
    try {
      stateDir(env);
    } catch (error) {
      return { block: `Blocked by Floodwall: ${error?.message ?? error}. Fix the state directory (FLOODWALL_HOOK_STATE_DIR) and retry.` };
    }
  }

  let decision;
  try {
    const fw = client ?? createClient(configFromEnv(env, { defaultAgent: "claude-code" }));
    const change = inferChange(segment, {
      cwd: input.cwd,
      blastRadius: env.FLOODWALL_HOOK_BLAST || "service",
      priority: env.FLOODWALL_HOOK_PRIORITY || "normal",
      withContext: env.FLOODWALL_HOOK_CONTEXT === "1",
    });
    const first = await fw.submit(change);
    decision = first;
    if (first.status === "queued" || first.status === "held") {
      const seconds = Number(env.FLOODWALL_HOOK_WAIT ?? 60);
      decision = await fw.wait(first.key, { timeoutSeconds: Number.isFinite(seconds) ? seconds : 60 });
    }
  } catch (error) {
    return unreachableOutcome(error, env, warn);
  }

  if (ADMITTED.has(decision.status)) {
    if (input.tool_use_id) {
      try {
        remember(env, input.tool_use_id, { key: decision.key, command: segment.slice(0, 200) });
      } catch (error) {
        warn(`floodwall: could not save the intent key for the outcome report: ${error?.message ?? error}`);
      }
    }
    return {};
  }
  const why = decision.policies.filter((p) => p.verdict !== "admit").map((p) => `${p.policy}: ${p.reason}`).join("; ") || decision.reason || decision.status;
  const key = `${decision.key.agent}/${decision.key.id}`;
  const advice =
    decision.status === "held" || decision.status === "queued"
      ? "It is held for a person to approve. Do not retry it or run it another way; tell the user it is waiting."
      : "Do not retry the same command or run it another way; tell the user why it was refused.";
  return { block: `Blocked by Floodwall (${decision.status}, ${key}): ${why}. ${advice}` };
}

async function post(input, outcome, reason, { client, env, warn }) {
  if (input.tool_name !== "Bash" || !input.tool_use_id) return {};
  const saved = recall(env, input.tool_use_id);
  if (!saved) return {};
  try {
    const fw = client ?? createClient(configFromEnv(env, { defaultAgent: "claude-code" }));
    await fw.report(saved.key, outcome, reason);
  } catch (error) {
    warn(`floodwall: could not report the outcome of ${saved.key.agent}/${saved.key.id}: ${error?.message ?? error}`);
  }
  return {};
}
