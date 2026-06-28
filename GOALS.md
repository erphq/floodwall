# GOALS - cofferdam

Sequenced milestones toward a control plane that makes high-volume,
agent-driven DevOps survivable. The throughline: agents generate change
faster than humans can review, so the system has to govern *throughput*,
not approve line items.

## v0.1 - the wall ✦ **shipped**

- `Intent` model: attributed change with `Action`, `Priority`, `BlastRadius`.
- `Admission`: per-agent token-bucket rate limiting + bounded priority queue
  with backpressure. Logical-clock time, fully deterministic.
- `policy` + `Gate`: `Policy` trait, three reference policies
  (`NoGlobalDestroy`, `BlastNeedsPriority`, `ResourceAllowlist`), composed
  deny-overrides with a full per-policy breakdown.
- `Ledger`: append-only FNV-1a hash chain, `verify()` detects any edit.
- `Cofferdam`: submit -> admit -> gate -> record end to end.
- Demo binary flooding the wall with 4000 intents across five agents.
- Tests: 20 unit + 1 doctest. fmt + clippy (`-D warnings`) clean.

## v0.2 - scheduler ◦ next

- A cooperative scheduler between admission and the gate: serialize
  intents that share a wide blast radius or target the same resource,
  run independent narrow ones concurrently.
- Conflict detection on `(resource, action)` so two agents cannot apply
  contradictory changes in the same window.
- Per-resource in-flight limits.

## v0.3 - trustworthy ledger

- Replace FNV-1a with a SHA-256 chain (reuse the from-scratch primitive
  from `shunya`).
- Per-record signatures keyed by agent identity.
- Periodic Merkle checkpoints so a verifier can audit a suffix without
  replaying from genesis.

## v0.4 - persistence + replay

- Durable, append-only ledger on disk.
- Rebuild full plane state (buckets, queue watermarks) from the ledger on
  restart.
- Property test: replay(record-stream) reproduces the live decisions.

## v0.5 - policy as code

- Declarative policy format so rules are data, not Rust.
- A worked OPA/Rego-style example evaluated at the gate.
- Policy bundles versioned and recorded in the ledger alongside verdicts.

## Later

- Backpressure signalling back to agents (a credit/quota protocol) so a
  well-behaved fleet self-throttles before it hits the wall.
- Distributed cofferdam: shard by resource, gossip the ledger heads.
- Formal model (TLA+) of the admit/serialize/commit protocol with safety
  (no two conflicting changes commit) and liveness (every admitted intent
  eventually decides) obligations.
