// Plans and payments, through the sign-in service's /billing calls (api/src/billing.ts). The
// service asks Paygate for Stripe Checkout and the hosted billing page, so the site never sees a
// card or a key. A build without the service (the in-browser demo) keeps a pretend plan in this
// browser instead, so the plan screens can be tried: nothing is charged and no page opens.

import { BILLING_COPY, BILLING_RETURN_PARAM, PLAN_PRICES } from "../constants/billing";
import { CONSOLE_PATHS } from "../constants/console";
import type { BillingInterval, PaidPlanKey } from "../constants/pricing";
import type { AccountCredit, AccountPlan, DiscountCode, PlanChangePreview } from "../types/billing";
import { callService } from "./auth";
import { AUTH_API_URL } from "../constants/auth";

/** True for the in-browser demo: the plan lives in this browser and nothing is charged. */
export const billingDemo = !AUTH_API_URL;

/** The signed-in account's plan. `refresh` asks Paygate first, e.g. straight after checkout. */
export async function getPlan(refresh = false) {
  if (billingDemo) return demoPlan();
  return callService<AccountPlan>(refresh ? "/billing?refresh=1" : "/billing");
}

/**
 * Moves a paid plan to the other paid plan. With `preview`, only says what moving would charge now
 * (prorated for the rest of the period); without it, moves and returns the new plan.
 */
export async function previewPlanChange(plan: PaidPlanKey): Promise<PlanChangePreview> {
  if (billingDemo) return demoPreview(plan);
  return callService<PlanChangePreview>("/billing/change", { plan, preview: true });
}

export async function changePlan(plan: PaidPlanKey): Promise<AccountPlan> {
  if (billingDemo) return demoChange(plan);
  return callService<AccountPlan>("/billing/change", { plan });
}

/**
 * Sends the browser to Stripe Checkout for `plan`, with `code` taken off when there is one. Throws
 * the service's sentence if it can't.
 */
export async function startCheckout(plan: PaidPlanKey, interval: BillingInterval = "month", code?: string) {
  if (billingDemo) {
    // Stands in for paying on Stripe: the plan starts and the page comes back as Checkout would.
    demoStart(plan, interval);
    window.location.assign(`${SETTINGS_PATH}?${BILLING_RETURN_PARAM}=success`);
    return;
  }
  const { url } = await callService<{ url: string }>("/billing/checkout", { plan, interval, ...(code ? { code } : {}) });
  window.location.assign(url);
}

/** What a discount code takes off. Throws the service's sentence for a code that isn't valid. */
export async function lookupCode(code: string) {
  if (billingDemo) {
    if (code.trim().toUpperCase() === DEMO_CODE) return { code: DEMO_CODE, summary: "20% off for 3 months" };
    throw new Error(`That code isn't valid. In the demo, try ${DEMO_CODE}.`);
  }
  return callService<DiscountCode>(`/billing/promo?code=${encodeURIComponent(code.trim())}`);
}

/** The account's credit and its latest changes. */
export async function getCredits() {
  if (billingDemo) return { credit: 0, currency: "usd", history: [] };
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
  if (billingDemo) throw new Error(BILLING_COPY.demoManage);
  const { url } = await callService<{ url: string }>("/billing/manage", {});
  window.location.assign(url);
}

/* ------------------------------------------------------------- Demo */

const SETTINGS_PATH = CONSOLE_PATHS.settings;
const DEMO_KEY = "floodwall-demo-plan";
const DEMO_CODE = "DEMO20";
const DAY = 24 * 60 * 60_000;

type DemoPlan = { plan: PaidPlanKey; interval: BillingInterval; periodStart: number; periodEnd: number };

function readDemo(): DemoPlan | null {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    return raw ? (JSON.parse(raw) as DemoPlan) : null;
  } catch {
    return null;
  }
}

function writeDemo(value: DemoPlan) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(value));
  } catch {
    // Without storage the demo plan lasts only as long as the page.
  }
}

function demoPlan(): AccountPlan {
  const demo = readDemo();
  if (!demo) return { plan: "free", status: null, features: null, periodEnd: null, cancelAtPeriodEnd: false };
  return { plan: demo.plan, status: "active", features: null, periodEnd: demo.periodEnd, cancelAtPeriodEnd: false, interval: demo.interval };
}

function demoStart(plan: PaidPlanKey, interval: BillingInterval) {
  const now = Date.now();
  writeDemo({ plan, interval, periodStart: now, periodEnd: now + (interval === "year" ? 365 : 30) * DAY });
}

function demoPreview(plan: PaidPlanKey): PlanChangePreview {
  const demo = readDemo();
  if (!demo) throw new Error("You don't have a paid plan to change. Choose a plan first.");
  if (demo.plan === plan) throw new Error("You're already on that plan.");
  const left = Math.max(0, (demo.periodEnd - Date.now()) / (demo.periodEnd - demo.periodStart));
  const price = (key: PaidPlanKey) => PLAN_PRICES[key][demo.interval];
  return { plan, amountDue: Math.max(0, Math.round((price(plan) - price(demo.plan)) * left)), currency: "usd" };
}

function demoChange(plan: PaidPlanKey): AccountPlan {
  const demo = readDemo();
  if (!demo) throw new Error("You don't have a paid plan to change. Choose a plan first.");
  writeDemo({ ...demo, plan });
  return demoPlan();
}

/** Puts the demo account back on Free, as cancelling on the billing page would. */
export function resetDemoPlan() {
  try {
    localStorage.removeItem(DEMO_KEY);
  } catch {
    // Nothing stored.
  }
}
