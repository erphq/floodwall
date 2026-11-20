# @floodwall/mcp

Make LLM agents ask a [Floodwall](https://floodwall.ai) plane before they
change production: an MCP server, a Claude Code hook, and a Claude Agent SDK
hook helper. Built on [`@floodwall/client`](../typescript); Node 20+.

```sh
npm install @floodwall/mcp@0.1.0
```

It depends on `@floodwall/client` ^0.2.0 (the `context` field), so publish the
client first. From a checkout, `npm run link-local-client` installs
`../typescript` in its place without saving it (the lockfile is not kept, for
that reason).

## Configuration

| Variable | |
|---|---|
| `FLOODWALL_API_KEY` / `FLOODWALL_API_KEY_FILE` | An **agent-scoped** key for the plane (console, API keys), or a file holding it. Required. Prefer a key bound to the agent's name, and for the hook prefer the file: the agent's own shell inherits the environment, not a 0600 file. |
| `FLOODWALL_PLANE` | The plane's id. Required. |
| `FLOODWALL_URL` | Default `https://api.floodwall.ai`. Must be https unless local. |
| `FLOODWALL_AGENT` | The name rules and the ledger know the agent by. `mcp-agent` for the server, `claude-code` for the hook. |
| `FLOODWALL_SIGNING_KEY` / `_FILE` | Ed25519 seed (64 hex characters or base64, or a file with it) for planes that require signed intents. |

## The MCP server

`floodwall-mcp` serves four tools:

| Tool | What it does |
|---|---|
| `submit_intent` | `kind` (apply, scale, destroy), `resource`, `replicas` / `manifest`, `priority`, `blast_radius`, optional `context` (a diff or plan, up to 64 KiB, for the plane's AI review). Returns the verdict (`proceed: true` only for `admit`) or the queued key. |
| `wait_verdict` | `key`, `wait` seconds (up to 120). Waits for a queued or held intent. |
| `report_outcome` | `key`, `succeeded` or `failed`, `reason`. Frees the resource. |
| `list_held` | What is waiting for a person. Needs an operator key; an agent key is refused. |

The descriptions tell the model to submit **before** acting and to **stop**
unless the verdict is `admit`: no retry, no other route. Every answer carries a
`next` line saying what to do. A refusal, an unreachable plane or invalid
arguments come back as tool errors saying not to make the change.

**Claude Code**

```sh
claude mcp add floodwall -e FLOODWALL_API_KEY=fw_live_... -e FLOODWALL_PLANE=pl_... -- npx -y @floodwall/mcp@0.1.0
```

or `.mcp.json` (see [`mcp-config.json`](../examples/mcp-config.json)):

```json
{
  "mcpServers": {
    "floodwall": {
      "command": "npx",
      "args": ["-y", "@floodwall/mcp@0.1.0"],
      "env": { "FLOODWALL_API_KEY": "fw_live_...", "FLOODWALL_PLANE": "pl_..." }
    }
  }
}
```

**Cursor**: the same JSON, in `.cursor/mcp.json` (or `~/.cursor/mcp.json`).

**Streamable HTTP**: `floodwall-mcp --http 3333` serves `POST http://127.0.0.1:3333/mcp`
(stateless). It acts with one key for everyone who reaches it. Without
`FLOODWALL_MCP_TOKEN` it refuses to start on a non-loopback `--host`, refuses
requests with an `Origin` header or a non-loopback `Host` (DNS rebinding), and
turns on the MCP SDK's rebinding protection. With the token, every request
needs `Authorization: Bearer <token>`.

An MCP server relies on the model choosing to call it. To make the wall hold
even when it does not, use the hooks below. They are defence in depth, **not a
security boundary**: patterns cannot see through every shell trick, so keep the
agent's own credentials narrow too.

## Claude Code hook

`floodwall-claude-hook` guards `Bash` commands. On `PreToolUse` it matches the
command against patterns (default: `kubectl apply|delete|scale|replace|patch|rollout restart|undo|pause|resume`,
`terraform apply|destroy`, `helm install|upgrade|uninstall`), submits an intent
(see below for the resource), waits for the verdict, and **blocks the command** (exit code 2, the reason on stderr, which
Claude reads) unless it is admitted. `PostToolUse` reports `succeeded` and
`PostToolUseFailure` reports `failed`, matched by `tool_use_id`.

Add to `.claude/settings.json` ([`claude-code-settings.json`](../examples/claude-code-settings.json)):

```json
{
  "hooks": {
    "PreToolUse":         [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "npx -y -p @floodwall/mcp@0.1.0 floodwall-claude-hook", "timeout": 90 }] }],
    "PostToolUse":        [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "npx -y -p @floodwall/mcp@0.1.0 floodwall-claude-hook" }] }],
    "PostToolUseFailure": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "npx -y -p @floodwall/mcp@0.1.0 floodwall-claude-hook" }] }]
  }
}
```

| Variable | |
|---|---|
| `FLOODWALL_HOOK_PATTERNS` | Replace the default patterns: a JSON array of regexes, or one regex per line. A command that matches no built-in shape becomes `shell:<command>`. |
| `FLOODWALL_HOOK_CONTEXT` | `1` sends the `kubectl apply -f` manifest (inside the working directory, `.yaml`/`.yml`/`.json`, up to 64 KiB) as `context` for the plane's AI review. Off by default. `Secret` documents are dropped and values under keys like password, secret, token, api key and private key are replaced. |
| `FLOODWALL_HOOK_BLAST` | Blast radius of every intent: `cell`, `service` (default), `region`, `global`. |
| `FLOODWALL_HOOK_PRIORITY` | `bulk`, `normal` (default), `urgent`, `pager`. |
| `FLOODWALL_HOOK_WAIT` | Seconds to wait for a held change before blocking (default 60). Keep the hook's `timeout` above it. |
| `FLOODWALL_FAIL_OPEN` | `1` lets a command run when the plane cannot be asked. **Off by default: the hook fails closed**, including on a 5xx, a refused key or missing configuration. A real verdict is always honoured. |

**One guarded command per Bash call.** A command line with more than one
matching command (`a && b`, `;`, `|`, `&`, newlines), or a matching command
behind `$( )`, backticks, `<( )`, `>( )`, `eval` or `sh -c`, is blocked without
asking the plane: "run one guarded command per Bash call".

**Resources** read as the Kubernetes object: `<context>/<namespace>/<kind>/<name>`,
with `-` for a context or namespace not given (`--context`, `-n`), kinds
normalised (`deploy` is `deployment`, `svc`, `ns`, `sts`, `ds`, `cm`, `po`
likewise), and, for `kubectl apply -f <file>`, the kind, name and namespace
from the file's first document (only for a `.yaml`/`.yml`/`.json` file inside the
working directory). Helm is `<kube-context>/<namespace>/helm/<release>`,
terraform `terraform:<dir>`. A matching command the hook cannot read (`delete
--all`, a selector, stdin, a file outside the directory, an unknown verb)
is submitted as a **destroy with blast radius global**, so rules treat it as the
worst case.

Saved intent keys live in a private directory (`$XDG_RUNTIME_DIR/floodwall-hook`,
else the temp directory) that must be a real directory owned by you with mode
0700, or the hook blocks; files are created exclusively and without following
links. Windows has no file modes, so there the mode isn't checked: the default,
in your own temp directory, is already private to you. The hook script fails closed: a crash, bad input or a missing module exits 2.

The command text (up to 500 characters) goes to the plane as the intent's
manifest, so keep secrets out of command lines.

Only matching commands are sent; everything else runs as before. The hook
returns no permission decision when it admits, so Claude Code's own permission
prompts still apply.

## Claude Agent SDK

```js
import { query } from "@anthropic-ai/claude-agent-sdk";
import { claudeAgentSdkHooks } from "@floodwall/mcp/agent-sdk";

for await (const message of query({
  prompt: "Scale web to 6 replicas",
  options: { hooks: claudeAgentSdkHooks({ waitSeconds: 60 }) },
})) { /* … */ }
```

`claudeAgentSdkHooks({ client?, env?, matcher?, waitSeconds? })` returns
`{ PreToolUse, PostToolUse, PostToolUseFailure }` matchers. A refusal is a
`permissionDecision: "deny"` with the plane's reason. It reads the same
`FLOODWALL_*` settings as the hook; pass `client` to use your own
`Floodwall`. `@anthropic-ai/claude-agent-sdk` is an optional peer dependency.

## Tests

`npm test` (a fake plane runs in-process).
