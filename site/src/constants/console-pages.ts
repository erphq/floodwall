// Copy and lookups for the console's page panels: the Overview's getting-started steps, the
// Ledger's kind filter and the Policies page's rules file. Kept apart from constants/console.ts,
// which holds the routes and navigation.

import { MOCK_ALLOWLIST, MOCK_INTENTS, MOCK_START_TICK } from "./console-mock";
import { REPO_URL } from "./links";
import type { LedgerRecord, PlaneState } from "../types/console";

/** The Ledger's filter, in the same tab control as the Intents page's status filter. */
export const LEDGER_FILTERS: { key: string; label: string; kind?: LedgerRecord["kind"] }[] = [
  { key: "all", label: "All" },
  { key: "decision", label: "Decisions", kind: "decision" },
  { key: "release", label: "Releases", kind: "release" },
  { key: "expiry", label: "Expiries", kind: "expiry" },
  { key: "outcome", label: "Outcomes", kind: "outcome" },
];

/** The highest id among the seed intents; anything above it was submitted in this session. */
const SEED_MAX_ID = Math.max(...MOCK_INTENTS.map((i) => i.id));

/**
 * The Overview's walk through the demo, in order. `done` reads the plane, so a step ticks itself off
 * when the person does it anywhere in the console; the last step is a check, not tracked.
 */
export const GETTING_STARTED: { title: string; detail: string; done?: (state: PlaneState) => boolean }[] = [
  {
    title: "Submit an intent",
    detail: "Propose a change as one of the demo agents. It waits in the queue for the gate.",
    done: (state) => state.intents.some((i) => i.id > SEED_MAX_ID),
  },
  {
    title: "Run a tick",
    detail: "The gate runs every policy on each queued intent and records one verdict per intent.",
    done: (state) => state.tick > MOCK_START_TICK,
  },
  {
    title: "Decide a held intent",
    detail: "Release or expire an intent the allowlist deferred. Your decision goes on the ledger too.",
    done: (state) => state.ledger.some((r) => r.kind === "release" || r.kind === "expiry"),
  },
  {
    title: "Verify the ledger",
    detail: "Check that every record still links to the digest of the one before it.",
  },
];

/** The rules file the Policies page shows, its allowlist taken from the mock gate's. */
export const POLICY_SOURCE = `policy "no-global-destroy" {
  reject "destructive global change requires human sign-off"
    when blast_radius == global and destructive
}

policy "blast-needs-priority" {
  reject "{blast_radius} blast radius needs priority >= urgent, got {priority}"
    when blast_radius >= region and priority < urgent
  reject "service blast radius needs priority >= normal, got {priority}"
    when blast_radius == service and priority < normal
}

policy "resource-allowlist" {
  defer "resource '{resource}' is not on the allowlist"
    when resource not in [${MOCK_ALLOWLIST.map((r) => `"${r}"`).join(", ")}]
}`;

export const POLICY_SOURCE_PATH = "policies/standard.rules";
export const POLICY_SOURCE_URL = `${REPO_URL}/blob/main/${POLICY_SOURCE_PATH}`;
