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
