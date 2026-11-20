import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { startPlane } from "./fake-plane.mjs";
import { claudeAgentSdkHooks } from "../src/agent-sdk.js";
import { inferChange, matchCommand, patternsFromEnv, redactedContext } from "../src/hook.js";

const HOOK = fileURLToPath(new URL("../hooks/claude-code.mjs", import.meta.url));

/** Run the hook script with `input` on stdin. */
function runHook(input, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HOOK], {
      env: { PATH: process.env.PATH, FLOODWALL_PLANE: "p1", FLOODWALL_HOOK_WAIT: "0", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}

const pre = (command, id = "toolu_1") => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, tool_use_id: id, cwd: "/work/infra" });

async function setup() {
  const plane = await startPlane();
  const state = mkdtempSync(join(tmpdir(), "fw-hook-test-"));
  const env = { FLOODWALL_API_KEY: plane.apiKey, FLOODWALL_URL: plane.url, FLOODWALL_HOOK_STATE_DIR: state };
  return { plane, state, env };
}

test("a command that is not risky is left alone and never reaches the plane", async () => {
  const { plane, env } = await setup();
  try {
    for (const command of ["ls -la", "kubectl get pods", "kubectl rollout status deploy/web", "terraform plan", "kubectl get pods | grep delete"]) {
      const out = await runHook(pre(command), env);
      assert.equal(out.code, 0, command);
      assert.equal(out.stderr, "");
    }
    assert.equal(plane.submitted.length, 0);
  } finally {
    await plane.close();
  }
});

test("an admitted kubectl scale runs, and PostToolUse reports success", async () => {
  const { plane, env } = await setup();
  try {
    const out = await runHook(pre("kubectl scale deployment ok-web --replicas=3"), env);
    assert.equal(out.code, 0);
    assert.equal(out.stdout, "");
    assert.deepEqual(plane.submitted[0].action, { kind: "scale", resource: "-/-/deployment/ok-web", replicas: 3 });
    assert.equal(plane.submitted[0].agent, "claude-code");
    await runHook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "toolu_1", tool_input: {}, tool_response: {} }, env);
    assert.equal(plane.outcomes.length, 1);
    assert.equal(plane.outcomes[0].outcome, "succeeded");
  } finally {
    await plane.close();
  }
});

test("a failed command is reported failed with the error", async () => {
  const { plane, env } = await setup();
  try {
    await runHook(pre("terraform apply -auto-approve", "toolu_2"), env);
    assert.equal(plane.submitted[0].action.kind, "apply");
    await runHook({ hook_event_name: "PostToolUseFailure", tool_name: "Bash", tool_use_id: "toolu_2", tool_input: {}, error: "exit 1: boom" }, env);
    assert.equal(plane.outcomes[0].outcome, "failed");
    assert.equal(plane.outcomes[0].reason, "exit 1: boom");
  } finally {
    await plane.close();
  }
});

test("a rejected command is blocked with exit 2 and the reason on stderr", async () => {
  const { plane, env, state } = await setup();
  try {
    const out = await runHook(pre("kubectl delete deployment bad-db"), env);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /Blocked by Floodwall \(rejected/);
    assert.match(out.stderr, /policy says reject/);
    assert.equal(plane.submitted[0].action.kind, "destroy");
    assert.deepEqual(readdirSync(state), []); // nothing to report: it never ran
  } finally {
    await plane.close();
  }
});

test("a held command is blocked, and tells Claude to stop and not retry", async () => {
  const { plane, env } = await setup();
  try {
    const out = await runHook(pre("helm uninstall held-release"), env);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /held/);
    assert.match(out.stderr, /Do not retry/);
    assert.equal(plane.submitted[0].action.resource, "-/-/helm/held-release");
  } finally {
    await plane.close();
  }
});

test("a held command released while the hook waits is allowed", async () => {
  const { plane, env } = await setup();
  try {
    const pending = runHook(pre("helm uninstall held-r2"), { ...env, FLOODWALL_HOOK_WAIT: "20" });
    while (plane.submitted.length === 0) await new Promise((r) => setTimeout(r, 20));
    const s = plane.submitted[0];
    plane.release(`${s.agent}/${s.id}`);
    assert.equal((await pending).code, 0);
  } finally {
    await plane.close();
  }
});

test("an unreachable plane fails closed; FLOODWALL_FAIL_OPEN=1 lets the command run", async () => {
  const { plane, env } = await setup();
  await plane.close();
  const closed = await runHook(pre("kubectl apply -f deploy.yaml"), env);
  assert.equal(closed.code, 2);
  assert.match(closed.stderr, /could not be asked/);
  const open = await runHook(pre("kubectl apply -f deploy.yaml"), { ...env, FLOODWALL_FAIL_OPEN: "1" });
  assert.equal(open.code, 0);
  assert.match(open.stderr, /FAIL_OPEN/);
});

test("a server error and missing configuration fail closed too", async () => {
  const { plane, env } = await setup();
  try {
    const err = await runHook(pre("kubectl delete deployment boom-x"), env);
    assert.equal(err.code, 2);
    const missing = await runHook(pre("kubectl delete deployment web"), { FLOODWALL_HOOK_STATE_DIR: env.FLOODWALL_HOOK_STATE_DIR });
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /FLOODWALL_API_KEY/);
  } finally {
    await plane.close();
  }
});

test("FLOODWALL_HOOK_PATTERNS and FLOODWALL_HOOK_BLAST are honoured", async () => {
  const { plane, env } = await setup();
  try {
    const custom = { ...env, FLOODWALL_HOOK_PATTERNS: JSON.stringify(["\\bpulumi\\s+up\\b"]), FLOODWALL_HOOK_BLAST: "region" };
    assert.equal((await runHook(pre("kubectl delete deployment web"), custom)).code, 0);
    assert.equal(plane.submitted.length, 0);
    assert.equal((await runHook(pre("pulumi up --yes"), custom)).code, 0);
    assert.equal(plane.submitted[0].blast_radius, "region");
    assert.match(plane.submitted[0].action.resource, /^shell:pulumi up/);
  } finally {
    await plane.close();
  }
});

test("bad stdin fails closed, other tools are ignored", async () => {
  const { plane, env } = await setup();
  try {
    assert.equal((await runHook("not json", env)).code, 2);
    assert.equal((await runHook({ ...pre("kubectl delete deployment web"), tool_name: "Read" }, env)).code, 0);
    assert.equal(plane.submitted.length, 0);
  } finally {
    await plane.close();
  }
});

test("the Agent SDK hooks have the SDK's shape and deny what the plane refuses", async () => {
  const { plane, env } = await setup();
  try {
    const hooks = claudeAgentSdkHooks({ env: { ...env, FLOODWALL_PLANE: "p1" }, waitSeconds: 0 });
    assert.deepEqual(Object.keys(hooks).sort(), ["PostToolUse", "PostToolUseFailure", "PreToolUse"]);
    assert.equal(hooks.PreToolUse[0].matcher, "Bash");
    const [preHook] = hooks.PreToolUse[0].hooks;
    const [postHook] = hooks.PostToolUse[0].hooks;
    const denied = await preHook(pre("kubectl delete deployment bad-db", "t9"));
    assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
    assert.match(denied.hookSpecificOutput.permissionDecisionReason, /Floodwall/);
    assert.deepEqual(await preHook(pre("kubectl scale deployment ok-web --replicas=2", "t10")), {});
    assert.deepEqual(await postHook({ hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "t10", tool_input: {} }), {});
    assert.equal(plane.outcomes.at(-1).outcome, "succeeded");
  } finally {
    await plane.close();
  }
});

const patterns = patternsFromEnv({});

test("a compound command with more than one risky command is blocked without asking the plane", async () => {
  const { plane, env } = await setup();
  try {
    for (const command of [
      "kubectl scale deploy/ok-web --replicas=3 && kubectl delete ns prod",
      "kubectl apply -f a.yaml; kubectl delete deploy web",
      "kubectl delete deploy a || kubectl delete deploy b",
      "kubectl delete deploy a | kubectl delete deploy b",
      "kubectl delete deploy a & kubectl delete deploy b",
      "kubectl delete deploy a\nkubectl delete deploy b",
    ]) {
      const out = await runHook(pre(command), env);
      assert.equal(out.code, 2, command);
      assert.match(out.stderr, /run one guarded command per Bash call/);
    }
    assert.equal(plane.submitted.length, 0);
    // One risky command among harmless ones is still guarded as that one command.
    assert.equal((await runHook(pre("cd infra && kubectl scale deploy/ok-web --replicas=3 && echo done"), env)).code, 0);
    assert.equal(plane.submitted.length, 1);
  } finally {
    await plane.close();
  }
});

test("a risky command behind eval, sh -c, $( ) or backticks is blocked without asking the plane", async () => {
  const { plane, env } = await setup();
  try {
    for (const command of [
      'bash -c "kubectl delete deploy web"',
      "sh -c 'terraform destroy'",
      "eval kubectl delete deploy web",
      "kubectl delete deploy $(echo web)",
      "kubectl delete deploy `echo web`",
      "kubectl delete deploy web <(echo x)",
    ]) {
      const out = await runHook(pre(command), env);
      assert.equal(out.code, 2, command);
      assert.match(out.stderr, /run one guarded command per Bash call/);
    }
    assert.equal((await runHook(pre("echo $(date) && ls"), env)).code, 0);
    assert.equal(plane.submitted.length, 0);
  } finally {
    await plane.close();
  }
});

/** A copy of the hook script with its own `src/hook.js`, so the hook's dependencies can be broken. */
function brokenHook(hookSource) {
  const dir = mkdtempSync(join(tmpdir(), "fw-broken-hook-"));
  mkdirSync(join(dir, "hooks"));
  copyFileSync(HOOK, join(dir, "hooks", "claude-code.mjs"));
  if (hookSource !== null) {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "hook.js"), hookSource);
    writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  }
  return join(dir, "hooks", "claude-code.mjs");
}

function runScript(script, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { env: { PATH: process.env.PATH } });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

test("the hook script exits 2 on a crash, an unhandled rejection or a missing module", async () => {
  const thrown = await runScript(brokenHook('export const handleHook = async () => { throw new Error("kaboom"); };'), pre("kubectl delete deploy web"));
  assert.equal(thrown.code, 2);
  assert.match(thrown.stderr, /Blocked by Floodwall: hook error \(kaboom\)/);

  const late = await runScript(
    brokenHook('export const handleHook = () => { Promise.reject(new Error("late")); return new Promise(() => setTimeout(() => {}, 5000)); };'),
    pre("kubectl delete deploy web"),
  );
  assert.equal(late.code, 2);
  assert.match(late.stderr, /hook error \(late\)/);

  const uncaught = await runScript(
    brokenHook('export const handleHook = () => { setTimeout(() => { throw new Error("later"); }, 10); return new Promise(() => setTimeout(() => {}, 5000)); };'),
    pre("kubectl delete deploy web"),
  );
  assert.equal(uncaught.code, 2);

  const missing = await runScript(brokenHook(null), pre("kubectl delete deploy web"));
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /hook error/);

  const noDependency = await runScript(brokenHook('import "@floodwall/not-installed"; export const handleHook = async () => ({});'), pre("kubectl delete deploy web"));
  assert.equal(noDependency.code, 2);
});

test("resources carry context and namespace, with kind aliases normalised", () => {
  const resource = (command) => {
    const m = matchCommand(command, patterns);
    return inferChange(m.segment).action;
  };
  assert.deepEqual(resource("kubectl -n prod --context eu delete deploy web"), { kind: "destroy", resource: "eu/prod/deployment/web" });
  assert.equal(resource("kubectl delete svc/api --namespace=shop").resource, "-/shop/service/api");
  assert.equal(resource("kubectl delete ns prod").resource, "-/-/namespace/prod");
  assert.equal(resource("kubectl scale sts db --replicas=2 -n x").resource, "-/x/statefulset/db");
  assert.equal(resource("kubectl rollout restart ds/agent").resource, "-/-/daemonset/agent");
  assert.equal(resource("kubectl delete cm settings").resource, "-/-/configmap/settings");
  assert.equal(resource("kubectl delete po/web-1").resource, "-/-/pod/web-1");
  assert.equal(resource("helm uninstall web -n shop --kube-context eu").resource, "eu/shop/helm/web");
});

test("kubectl apply -f reads kind, name and namespace from a one-document file inside the working directory", () => {
  const cwd = mkdtempSync(join(tmpdir(), "fw-manifest-"));
  writeFileSync(
    join(cwd, "deploy.yaml"),
    "# comment\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  labels:\n    name: not-this\n  name: ok-web\n  namespace: shop\nspec:\n  password: hunter2\n",
  );
  writeFileSync(join(cwd, "d.json"), JSON.stringify({ kind: "Service", metadata: { name: "api", namespace: "x" } }));
  writeFileSync(join(cwd, "notes.txt"), "kind: Deployment");
  const change = (command, extra = {}) => inferChange(matchCommand(command, patterns).segment, { cwd, ...extra });
  assert.equal(change("kubectl apply -f deploy.yaml").action.resource, "-/shop/deployment/ok-web");
  assert.equal(change("kubectl apply -f d.json -n y").action.resource, "-/y/service/api");
  assert.equal(change("kubectl apply -f deploy.yaml").context, undefined); // context is opt-in
  assert.match(change("kubectl apply -f deploy.yaml", { withContext: true }).context, /kind: Deployment/);
  // Outside the directory, not yaml/json, stdin, a URL or a directory: unreadable, so the worst case.
  for (const command of ["kubectl apply -f ../deploy.yaml", "kubectl apply -f notes.txt", "kubectl apply -f -", "kubectl apply -f https://x.test/a.yaml", "kubectl apply -f ."]) {
    const c = change(command, { withContext: true });
    assert.equal(c.action.kind, "destroy", command);
    assert.equal(c.blastRadius, "global");
    assert.equal(c.context, undefined);
  }
});

test("a command acting on more than one object is never ruled on as its first: it is a global destroy", () => {
  const cwd = mkdtempSync(join(tmpdir(), "fw-many-"));
  writeFileSync(join(cwd, "two.yaml"), "kind: ConfigMap\nmetadata:\n  name: tmp\n---\nkind: Deployment\nmetadata:\n  name: prod-db\n  namespace: prod\n");
  writeFileSync(join(cwd, "list.yaml"), "kind: List\nitems:\n  - kind: Deployment\n    metadata:\n      name: prod-db\n");
  writeFileSync(join(cwd, "arr.json"), JSON.stringify([{ kind: "ConfigMap", metadata: { name: "a" } }, { kind: "Deployment", metadata: { name: "prod-db" } }]));
  writeFileSync(join(cwd, "a.yaml"), "kind: ConfigMap\nmetadata:\n  name: a\n");
  writeFileSync(join(cwd, "b.yaml"), "kind: Deployment\nmetadata:\n  name: prod-db\n");
  const change = (command) => inferChange(matchCommand(command, patterns).segment, { cwd });
  for (const command of [
    "kubectl delete deployment tmp prod-db",
    "kubectl delete pod/x deployment/prod-db",
    "kubectl scale deployment a prod-db --replicas=0",
    "kubectl rollout restart deploy/a deploy/prod-db",
    "kubectl delete -f two.yaml",
    "kubectl apply -f two.yaml",
    "kubectl apply -f list.yaml",
    "kubectl apply -f arr.json",
    "kubectl apply -f a.yaml -f b.yaml",
    "kubectl delete deploy tmp -f b.yaml",
  ]) {
    const c = change(command);
    assert.equal(c.action.kind, "destroy", command);
    assert.equal(c.blastRadius, "global", command);
    assert.match(c.action.resource, /^shell:/, command);
  }
});

test("attached short flags are read: -nprod is namespace prod, -fx.yaml is the file", () => {
  const cwd = mkdtempSync(join(tmpdir(), "fw-attached-"));
  writeFileSync(join(cwd, "b.yaml"), "kind: Deployment\nmetadata:\n  name: prod-db\n");
  const change = (command) => inferChange(matchCommand(command, patterns).segment, { cwd });
  assert.equal(change("kubectl delete deployment prod-db -nprod").action.resource, "-/prod/deployment/prod-db");
  assert.equal(change("kubectl apply -fb.yaml -nprod").action.resource, "-/prod/deployment/prod-db");
});

test("a matching command that cannot be read is a global destroy, also when no verb is found", async () => {
  for (const command of ["kubectl delete pods --all", "kubectl delete deploy -l app=web", "kubectl -l app=patch get pods", "kubectl scale deploy/web", "helm install"]) {
    const m = matchCommand(command, patterns);
    const c = inferChange(m.segment);
    assert.equal(c.action.kind, "destroy", command);
    assert.equal(c.blastRadius, "global", command);
    assert.match(c.action.resource, /^shell:/);
  }
  const { plane, env } = await setup();
  try {
    assert.equal((await runHook(pre("kubectl delete pods --all"), env)).code, 0);
    assert.equal(plane.submitted[0].blast_radius, "global");
    assert.equal(plane.submitted[0].action.kind, "destroy");
  } finally {
    await plane.close();
  }
});

test("manifest context drops Secret documents and redacts sensitive values", () => {
  // A Secret anywhere drops the whole context: nothing is sent.
  assert.equal(redactedContext("kind: Secret\nmetadata:\n  name: s\n---\nkind: Deployment\nspec:\n  replicas: 3\n"), undefined);
  const yaml = redactedContext("kind: Deployment\nspec:\n  env:\n    - name: X\n  DB_PASSWORD: hunter2\n  apiKey: abc\n  replicas: 3\n");
  assert.ok(!/hunter2|abc/.test(yaml), yaml);
  assert.match(yaml, /replicas: 3/);
  assert.equal(redactedContext('{"kind":"Secret","data":{}}'), undefined);
  const json = JSON.parse(redactedContext('{"kind":"Deployment","spec":{"token":"t","n":1}}'));
  assert.deepEqual(json.spec, { token: "[redacted]", n: 1 });
});

test("the hook sends manifest context to the plane only when FLOODWALL_HOOK_CONTEXT=1", async () => {
  const { plane, env } = await setup();
  const cwd = mkdtempSync(join(tmpdir(), "fw-cwd-"));
  writeFileSync(join(cwd, "ok.yaml"), "kind: Deployment\nmetadata:\n  name: ok-web\nspec:\n  replicas: 2\n");
  try {
    const input = { ...pre("kubectl apply -f ok.yaml"), cwd };
    assert.equal((await runHook(input, env)).code, 0);
    assert.equal(plane.submitted[0].context, undefined);
    assert.equal((await runHook({ ...input, tool_use_id: "toolu_c" }, { ...env, FLOODWALL_HOOK_CONTEXT: "1" })).code, 0);
    assert.match(plane.submitted[1].context, /replicas: 2/);
  } finally {
    await plane.close();
  }
});

test("a state directory that is not private is refused, and nothing is sent", { skip: process.platform === "win32" && "Windows has no POSIX modes" }, async () => {
  const { plane, env, state } = await setup();
  try {
    chmodSync(state, 0o755);
    const out = await runHook(pre("kubectl scale deployment ok-web --replicas=3"), env);
    assert.equal(out.code, 2);
    assert.match(out.stderr, /0700/);
    assert.equal(plane.submitted.length, 0);
    chmodSync(state, 0o700);
    assert.equal((await runHook(pre("kubectl scale deployment ok-web --replicas=3"), env)).code, 0);
    assert.equal((readdirSync(state).length), 1);
    assert.equal((await import("node:fs")).statSync(join(state, readdirSync(state)[0])).mode & 0o777, 0o600);
  } finally {
    await plane.close();
  }
});

test("the API key can come from FLOODWALL_API_KEY_FILE", async () => {
  const { plane, env, state } = await setup();
  try {
    const keyFile = join(mkdtempSync(join(tmpdir(), "fw-key-")), "key");
    writeFileSync(keyFile, `${plane.apiKey}\n`, { mode: 0o600 });
    const { FLOODWALL_API_KEY, ...rest } = env;
    const out = await runHook(pre("kubectl scale deployment ok-web --replicas=3"), { ...rest, FLOODWALL_API_KEY_FILE: keyFile });
    assert.equal(out.code, 0);
    assert.equal(plane.submitted.length, 1);
  } finally {
    await plane.close();
  }
});

test("the Agent SDK hooks deny when something throws, unless fail-open is set", async () => {
  const { plane, env } = await setup();
  try {
    const client = { submit: async () => { throw new Error("exploded"); } };
    const [preHook] = claudeAgentSdkHooks({ client, env }).PreToolUse[0].hooks;
    const denied = await preHook(pre("kubectl scale deployment ok-web --replicas=3"));
    assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
    const [open] = claudeAgentSdkHooks({ client, env: { ...env, FLOODWALL_FAIL_OPEN: "1" } }).PreToolUse[0].hooks;
    assert.deepEqual(await open(pre("kubectl scale deployment ok-web --replicas=3")), {});
    const compound = await preHook(pre("kubectl delete deploy a && kubectl delete deploy b"));
    assert.equal(compound.hookSpecificOutput.permissionDecision, "deny");
  } finally {
    await plane.close();
  }
});

test("continuations, case and quoted or escaped words cannot hide a command from the patterns", async () => {
  const { plane, env } = await setup();
  const cwd = mkdtempSync(join(tmpdir(), "fw-evade-"));
  writeFileSync(join(cwd, "d.yaml"), "kind: Deployment\nmetadata:\n  name: ok-web\n");
  try {
    const cases = [
      ["kubectl \\\n apply -f d.yaml", "-/-/deployment/ok-web"],
      ["Kubectl apply -f d.yaml", "-/-/deployment/ok-web"],
      ["kubectl delete deploy 'ok-web'", "-/-/deployment/ok-web"],
      ["k\\ubectl delete deploy ok-web", "-/-/deployment/ok-web"],
      ["terraform \\\n destroy", /^terraform:/],
    ];
    for (const [command, resource] of cases) {
      const out = await runHook({ ...pre(command, `t${plane.submitted.length}`), cwd }, env);
      assert.equal(out.code, 0, command);
      const submitted = plane.submitted.at(-1).action.resource;
      if (resource instanceof RegExp) assert.match(submitted, resource);
      else assert.equal(submitted, resource, command);
    }
    assert.equal(plane.submitted.length, cases.length);
    // Hidden behind a variable: nothing matches, but the tool and a change verb are there.
    for (const command of ["K=kubectl; $K delete x", "t=terraform && $t destroy", "H=HELM; $H uninstall web"]) {
      const out = await runHook(pre(command), env);
      assert.equal(out.code, 2, command);
      assert.match(out.stderr, /run one guarded command per Bash call/);
    }
    assert.equal(plane.submitted.length, cases.length);
    // Reads stay unguarded.
    assert.equal((await runHook(pre("Kubectl get pods"), env)).code, 0);
    assert.equal(plane.submitted.length, cases.length);
  } finally {
    await plane.close();
  }
});

test("context redaction drops a Secret nested in a List and blanks data and stringData blocks", () => {
  assert.equal(redactedContext("apiVersion: v1\nkind: List\nitems:\n  - kind: Secret\n    data:\n      a: Yg==\n  - kind: Deployment\n"), undefined);
  assert.equal(redactedContext("items:\n  - apiVersion: v1\n    kind: \"Secret\"\n"), undefined);
  const yaml = redactedContext("kind: ConfigMap\ndata:\n  a: one\n  b: two\nspec:\n  replicas: 2\n");
  assert.ok(!/one|two/.test(yaml), yaml);
  assert.match(yaml, /replicas: 2/);
  const json = JSON.parse(redactedContext(JSON.stringify({ kind: "List", items: [{ kind: "Secret", data: { a: "x" } }, { kind: "Deployment", spec: { stringData: { k: "v" } } }] })));
  assert.deepEqual(json.items, [{ kind: "Deployment", spec: { stringData: "[redacted]" } }]);
});
