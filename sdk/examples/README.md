# Sample agents

Small, commented agents that ask a Floodwall plane before each change they
make. Each one only prints what it would run until you pass `--apply`, and
without `FLOODWALL_KEY` it prints the change it would ask about and stops, so
you can read and run them before you have a plane.

| File | Language | What it shows |
|------|----------|---------------|
| [`deploy-agent.mjs`](deploy-agent.mjs) | TypeScript | Rolls an image out to a few services, one `guard()` each. |
| [`kubernetes-scaler.mjs`](kubernetes-scaler.mjs) | TypeScript | Guards a `kubectl scale`; handles `NotAdmitted` and plane errors. |
| [`terraform-apply.py`](terraform-apply.py) | Python | `terraform apply` per workspace, with the blast radius read from the workspace's name. |
| [`remediation-bot.py`](remediation-bot.py) | Python | Restarts unhealthy services, one intent each; handles held and rejected restarts. |
| [`ci-gate.mjs`](ci-gate.mjs) + [`github-actions-deploy.yml`](github-actions-deploy.yml) | TypeScript, YAML | A CI step that asks before deploying, fails the job if not admitted, and reports the outcome. |
| [`llm-agent-tool.mjs`](llm-agent-tool.mjs) | TypeScript | An AI agent's tool calls, each through `guard()`, with refusals handed back to the model as text. |
| [`mcp-config.json`](mcp-config.json) | JSON | Registers the `@floodwall/mcp` server with Claude Code (`.mcp.json`) or Cursor (`.cursor/mcp.json`). |
| [`claude-code-settings.json`](claude-code-settings.json) | JSON | Claude Code hooks: risky `Bash` commands are blocked unless the plane admits them, and the outcome is reported. |
| [`agent-sdk-agent.mjs`](agent-sdk-agent.mjs) | TypeScript | A Claude Agent SDK agent with `claudeAgentSdkHooks()` guarding its shell commands. |
| [`langgraph-agent.py`](langgraph-agent.py) | Python | A LangGraph agent with a `guarded_tool` and a `guard_node`. |
| [`signed-agent.mjs`](signed-agent.mjs) | TypeScript | Makes an Ed25519 key, prints the public key for the plane's keyring, and signs intents. |

## Running them

They import the clients from this repository (`../typescript/src/index.js`,
`../python`), so they run from a checkout with no install, except the two built
on another framework: `agent-sdk-agent.mjs` needs `@anthropic-ai/claude-agent-sdk`
and `@floodwall/mcp`, and `langgraph-agent.py` needs `langgraph` (the comment at
the top of each says what to install). In your own project,
`npm install @floodwall/client` or `pip install floodwall` and import from the
package instead.

```sh
export FLOODWALL_KEY=fw_live_...     # an agent key from the console (API keys)
export FLOODWALL_PLANE=pl_...        # the plane's id
# export FLOODWALL_URL=http://127.0.0.1:8787   # optional: another API, such as a local one
# export FLOODWALL_AGENT=my-agent              # optional: each example has its own default name

node sdk/examples/kubernetes-scaler.mjs web 5               # asks, then prints the kubectl command
node sdk/examples/kubernetes-scaler.mjs web 5 --apply       # asks, then runs it
python3 sdk/examples/terraform-apply.py dev staging prod-eu
python3 sdk/examples/remediation-bot.py
node sdk/examples/ci-gate.mjs ask --resource api --manifest "$(git rev-parse HEAD)" --dry-run
node sdk/examples/llm-agent-tool.mjs
node sdk/examples/signed-agent.mjs
```

Node 20+ and Python 3.9+. `signed-agent.mjs` uses WebCrypto's Ed25519, which
needs no package.

## Rules to try them with

Paste these into the plane's Policies to see each verdict:

```text
format 1

policy "guardrails" {
  reject "{resource} holds state, so no agent may take it to zero"
    when destructive and resource matches "*-db"
  defer "a region-wide change waits for a person"
    when blast_radius >= region and priority < pager
  defer "scaling {resource} to {replicas} needs a person"
    when replicas > 10
}
```

With these, `kubernetes-scaler.mjs web 5` is admitted, `web 20` is held,
`terraform-apply.py prod-eu` is held until someone releases it in the console
or in Slack, and the LLM agent's `delete_deployment("orders-db")` is rejected.

The documentation for each is at https://floodwall.ai/docs/examples.
