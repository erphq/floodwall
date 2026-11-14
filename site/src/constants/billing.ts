// What the account page and the pricing page say about plans and payments.
// Payments run through Paygate, which runs Stripe; the sign-in service (api/)
// asks it for checkout and billing pages.

import type { PaidPlanKey } from "./pricing";

export const PLAN_NAMES: Record<string, string> = { free: "Free", team: "Team", business: "Business" };

/** The query parameter Stripe Checkout comes back to /account with. */
export const BILLING_RETURN_PARAM = "billing";

export const BILLING_COPY = {
  title: "Plan and billing",
  plan: "Plan",
  renews: "Renews",
  ends: "Ends",
  pastDue: "Your last payment didn't go through. Update your card to keep your plan.",
  free: "You're on Free: one plane and 25,000 decisions a month.",
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
  demo: "Billing needs the sign-in service; this is the in-browser demo.",
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
