/** An account's plan, as the sign-in service keeps it (GET /billing). */
export type AccountPlan = {
  /** "free", "team" or "business". */
  plan: string;
  /** Paygate's subscription status: active, trialing, past_due, canceled; null on Free. */
  status: string | null;
  /** The plan's limits, from Paygate: planes, decisions_included, retention_days, … */
  features: Record<string, unknown> | null;
  /** When the period ends, in ms since the epoch. */
  periodEnd: number | null;
  cancelAtPeriodEnd: boolean;
};
