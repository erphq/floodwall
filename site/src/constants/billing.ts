// What the account page and the pricing page say about plans and payments.
// Payments run through Paygate, which runs Stripe; the sign-in service (api/)
// asks it for checkout and billing pages.

import type { PaidPlanKey } from "./pricing";

export const PLAN_NAMES: Record<string, string> = { free: "Free", team: "Team", business: "Business" };

/** Each paid plan's price in cents, as on /pricing (constants/pricing.ts). */
export const PLAN_PRICES: Record<PaidPlanKey, Record<"month" | "year", number>> = {
  team: { month: 4900, year: 49000 },
  business: { month: 39900, year: 399000 },
};

/** The query parameter Stripe Checkout comes back to /account with. */
export const BILLING_RETURN_PARAM = "billing";

export const BILLING_COPY = {
  title: "Plan and billing",
  plan: "Plan",
  renews: "Renews",
  ends: "Ends",
  pastDue: "Your last payment didn't go through. Update your card to keep your plan.",
  free: "One plane and 25,000 decisions a month. Move up when you need more planes or a longer ledger.",
  upgrade: (plan: PaidPlanKey) => `Move to ${PLAN_NAMES[plan]}`,
  upgradeYearly: "Pay yearly, two months free",
  manage: "Invoices, card and cancelling",
  compare: "Compare plans",
  opening: "Opening checkout…",
  openingBilling: "Opening billing…",
  checking: "Confirming your payment…",
  thanks: "Thanks, your plan is active.",
  stillProcessing: "Your payment is being processed. Your plan will show here in a minute.",
  failed: "Billing could not be loaded. Please try again.",
  demo: "Demo: this plan lives in your browser. Nothing is charged and no payment page opens.",
  demoManage: "The demo has no billing page. On floodwall.ai this opens your invoices, card and cancelling.",
  demoCancel: "Back to Free",
  switchTo: (plan: string) => `Switch to ${PLAN_NAMES[plan] ?? plan}`,
  switching: "Switching…",
  previewing: "Working out the price…",
  confirmSwitch: (plan: string) => `Confirm switch to ${PLAN_NAMES[plan] ?? plan}`,
  keep: (plan: string) => `Keep ${PLAN_NAMES[plan] ?? plan}`,
  chargeNow: (amount: string) => `${amount} is charged now for the rest of this billing period. Your renewal date stays the same.`,
  noChargeNow: "Nothing is charged now. The unused part of this period goes to your account credit, and your renewal date stays the same.",
  switched: (plan: string) => `You're now on ${PLAN_NAMES[plan] ?? plan}.`,
  toFree: "To go back to Free, cancel on the billing page. You keep your plan until the period ends.",
  monthly: "Monthly",
  yearly: "Yearly",
  yearlyNote: "two months free",
  currentBadge: "Current plan",
  billedMonthly: "billed monthly",
  billedYearly: "billed yearly",
  perMonth: "a month",
  perYear: "a year",
  enterprise: "Need self-hosted planes, custom retention or a contract?",
  enterpriseLink: "Talk to us",
  current: "Your plan",
  signInToBuy: "Sign in to upgrade",
  code: {
    label: "Discount code",
    apply: "Apply",
    checking: "Checking…",
    remove: "Remove",
    applied: (code: string, summary: string | null) => `${code} applied${summary ? `: ${summary}` : ""}.`,
    atCheckout: "It comes off at checkout.",
  },
  credit: (amount: string) => `Credit ${amount}`,
  creditNote: "Used on your next invoices before your card is charged.",
};
