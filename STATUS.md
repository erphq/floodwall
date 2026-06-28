# STATUS - cofferdam

## Current state

v0.1 is shipped: the full wall in one zero-dependency crate. An `Intent`
flows through `Admission` (per-agent token bucket + bounded priority queue
with backpressure), into a deny-overrides policy `Gate`, and every verdict
lands in a tamper-evident hash-chained `Ledger`. The `Cofferdam` type ties
the four together; a demo binary floods it with 4000 intents across five
agents to show admission control, gating, and the ledger holding up under
load. 20 unit tests + 1 doctest, fmt + clippy (`-D warnings`) clean,
pinned to Rust 1.95.

## Recently shipped

- **v0.1** - Intent model, admission control, policy gate, hash-chained
  ledger, end-to-end `Cofferdam`, demo binary, CI (fmt / clippy / test /
  build), Dependabot (cargo + actions).

## Next up

- **v0.2 scheduler** - serialize wide-blast / same-resource intents, run
  independent narrow ones concurrently; conflict detection on
  `(resource, action)`.
- **v0.3 ledger** - swap FNV-1a for a SHA-256 chain, sign records, add
  Merkle checkpoints.
