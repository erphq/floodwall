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
  /** "month" or "year", when known (the demo knows; the service doesn't say yet). */
  interval?: "month" | "year";
};

/** What moving to another paid plan would charge now (POST /billing/change with preview). */
export type PlanChangePreview = {
  plan: string;
  /** In cents: the prorated difference for the rest of the period. 0 when moving down. */
  amountDue: number;
  currency: string | null;
};

/** A discount code the service checked with Paygate (GET /billing/promo). */
export type DiscountCode = {
  code: string;
  /** What it takes off: "20% off for 3 months". */
  summary: string | null;
};

/** The account's credit (GET /billing/credits): spent on its next invoices before the card is charged. */
export type AccountCredit = {
  /** In cents. */
  credit: number;
  currency: string | null;
  history: { amount: number; description: string | null; created: string | null }[];
};
