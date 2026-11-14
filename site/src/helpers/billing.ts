// Plans and payments, through the sign-in service's /billing calls (api/src/billing.ts). The
// service asks Paygate for Stripe Checkout and the hosted billing page, so the site never sees a
// card or a key. In the in-browser demo, there is no billing.

import { BILLING_COPY } from "../constants/billing";
import type { BillingInterval, PaidPlanKey } from "../constants/pricing";
import type { AccountPlan } from "../types/billing";
import { callService } from "./auth";
import { AUTH_API_URL } from "../constants/auth";

export const billingAvailable = !!AUTH_API_URL;

function requireService() {
  if (!billingAvailable) throw new Error(BILLING_COPY.demo);
}

/** The signed-in account's plan. `refresh` asks Paygate first, e.g. straight after checkout. */
export async function getPlan(refresh = false) {
  requireService();
  return callService<AccountPlan>(refresh ? "/billing?refresh=1" : "/billing");
}

/** Sends the browser to Stripe Checkout for `plan`. Throws the service's sentence if it can't. */
export async function startCheckout(plan: PaidPlanKey, interval: BillingInterval = "month") {
  requireService();
  const { url } = await callService<{ url: string }>("/billing/checkout", { plan, interval });
  window.location.assign(url);
}

/** Sends the browser to Paygate's billing page: invoices, card, cancel. */
export async function openBilling() {
  requireService();
  const { url } = await callService<{ url: string }>("/billing/manage", {});
  window.location.assign(url);
}
