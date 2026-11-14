// Plans and payments, through the sign-in service's /billing calls (api/src/billing.ts). The
// service asks Paygate for Stripe Checkout and the hosted billing page, so the site never sees a
// card or a key. In the in-browser demo, there is no billing.

import { BILLING_COPY } from "../constants/billing";
import type { BillingInterval, PaidPlanKey } from "../constants/pricing";
import type { AccountCredit, AccountPlan, DiscountCode } from "../types/billing";
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

/**
 * Sends the browser to Stripe Checkout for `plan`, with `code` taken off when there is one. Throws
 * the service's sentence if it can't.
 */
export async function startCheckout(plan: PaidPlanKey, interval: BillingInterval = "month", code?: string) {
  requireService();
  const { url } = await callService<{ url: string }>("/billing/checkout", { plan, interval, ...(code ? { code } : {}) });
  window.location.assign(url);
}

/** What a discount code takes off. Throws the service's sentence for a code that isn't valid. */
export async function lookupCode(code: string) {
  requireService();
  return callService<DiscountCode>(`/billing/promo?code=${encodeURIComponent(code.trim())}`);
}

/** The account's credit and its latest changes. */
export async function getCredits() {
  requireService();
  return callService<AccountCredit>("/billing/credits");
}

/** "$25.00", in the account's currency. */
export function formatCredit(cents: number, currency: string | null) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: (currency ?? "usd").toUpperCase() }).format(cents / 100);
}

// A code from a link (/pricing?code=LAUNCH20) is kept for the tab, so it survives signing up or in
// on the way to checkout.
const CODE_KEY = "floodwall-discount-code";

export function savedCode() {
  try {
    return sessionStorage.getItem(CODE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveCode(code: string) {
  try {
    if (code) sessionStorage.setItem(CODE_KEY, code);
    else sessionStorage.removeItem(CODE_KEY);
  } catch {
    // Storage is optional: the code still applies on this page.
  }
}

/** The code in this page's ?code=, saved for later; otherwise one saved earlier in the tab. */
export function codeFromPage() {
  if (typeof window === "undefined") return "";
  const fromUrl = new URLSearchParams(window.location.search).get(CODE_PARAM)?.trim() ?? "";
  if (fromUrl) saveCode(fromUrl);
  return fromUrl || savedCode();
}

export const CODE_PARAM = "code";

/** Sends the browser to Paygate's billing page: invoices, card, cancel. */
export async function openBilling() {
  requireService();
  const { url } = await callService<{ url: string }>("/billing/manage", {});
  window.location.assign(url);
}
