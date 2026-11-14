// Plans and payments, through Paygate (pay.erpai.studio), which runs Stripe
// for us. The Worker never sees a card or a Stripe key: it asks Paygate for a
// checkout page or a billing page, and Paygate's signed webhooks tell it what
// each account has paid for, which it keeps on the account's row.
//
//   GET  /billing                     the signed-in account's plan (?refresh=1 asks Paygate first)
//   POST /billing/checkout  { plan, interval }   a Stripe Checkout page for Team or Business
//   POST /billing/manage              Paygate's hosted billing page: invoices, card, cancel
//   GET  /billing/promo?code=…        what a discount code takes off, before checkout
//   GET  /billing/credits             the account's credit, spent on its next invoices
//   POST /billing/webhook             Paygate's webhooks (signed; no session, no site origin)
//
// Discount codes are made in Paygate (the app's Discounts tab); credit is granted by an admin
// (POST /admin/credit in admin.ts) and is Stripe's customer balance.

import { sessionAccount } from "./auth";
import type { Env } from "./env";
import { HttpError, json, readBody, readJson } from "./http";
import { paymentFailedEmail, sendEmail } from "./mail";
import { MESSAGES } from "./rules";

/** The plans that can be bought; Free is what an account has without one. */
export const PAID_PLANS = ["team", "business"] as const;
export const INTERVALS = ["month", "year"] as const;

/** How far a webhook's signed time may be from ours. */
const SIGNATURE_TOLERANCE_MS = 5 * 60_000;
/** Paygate's events are small; this leaves room for an invoice with many lines. */
const MAX_WEBHOOK_LENGTH = 256 * 1024;

/** What Paygate says an account is entitled to (GET /v1/entitlements, entitlement.changed). */
type Entitlement = {
  active: boolean;
  plan: string | null;
  status: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  features?: Record<string, unknown> | null;
};

type PlanRow = {
  plan: string;
  plan_status: string | null;
  plan_features: string | null;
  plan_period_end: number | null;
  plan_cancel_at_period_end: number;
};

/** What the site is told about the account's plan. */
function publicPlan(row: PlanRow) {
  return {
    plan: row.plan,
    status: row.plan_status,
    features: row.plan_features ? (JSON.parse(row.plan_features) as Record<string, unknown>) : null,
    periodEnd: row.plan_period_end,
    cancelAtPeriodEnd: row.plan_cancel_at_period_end === 1,
  };
}

function secretKey(env: Env) {
  if (!env.PAYGATE_SECRET_KEY || !env.PAYGATE_URL) {
    console.error("billing is not configured: set PAYGATE_URL and PAYGATE_SECRET_KEY");
    throw new HttpError(503, MESSAGES.billingUnavailable);
  }
  return env.PAYGATE_SECRET_KEY;
}

/** A discount code as the site may send it: letters, digits, dashes and underscores. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The code in `value`, trimmed, or null when there is none; a malformed one is a 400. */
export function discountCode(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  const code = typeof value === "string" ? value.trim() : "";
  if (!CODE_PATTERN.test(code)) throw new HttpError(400, MESSAGES.badCode);
  return code;
}

/**
 * One call to Paygate's app API. Returns the status and parsed body; a network failure is a 502.
 * A call with a body carries an Idempotency-Key: `idempotencyKey` when the caller has one to
 * repeat on a retry, otherwise a new one.
 */
export async function paygate(env: Env, method: string, path: string, body?: unknown, idempotencyKey?: string) {
  const key = secretKey(env);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    // Paygate replays the first answer to a repeated key.
    headers["Idempotency-Key"] = idempotencyKey ?? crypto.randomUUID();
  }
  let response: Response;
  try {
    response = await fetch(`${env.PAYGATE_URL.replace(/\/$/, "")}/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error("paygate: unreachable", error);
    throw new HttpError(502, MESSAGES.billingUnavailable);
  }
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON: treated as a failure below.
  }
  return { status: response.status, body: parsed };
}

export function paygateFailed(what: string, answer: { status: number; body: any }): never {
  console.error(`paygate: ${what} refused`, answer.status, JSON.stringify(answer.body?.error ?? null).slice(0, 300));
  throw new HttpError(502, MESSAGES.billingUnavailable);
}

/** The signed-in account, which must be past the waitlist to buy anything. */
async function requireMember(request: Request, env: Env, now: number) {
  const account = await sessionAccount(request, env, now);
  if (!account) throw new HttpError(401, MESSAGES.signedOut);
  if (account.user.waiting) throw new HttpError(403, MESSAGES.waiting);
  return account;
}

/**
 * Copies an entitlement onto the account, unless what is there is newer. Without an active
 * subscription the account is on Free.
 */
async function storeEntitlement(env: Env, userId: string, ent: Entitlement, asOf: number) {
  const active = ent.active && !!ent.plan;
  const periodEnd = ent.current_period_end ? Date.parse(ent.current_period_end) : NaN;
  const result = await env.DB.prepare(
    `UPDATE users SET plan = ?1, plan_status = ?2, plan_features = ?3, plan_period_end = ?4,
       plan_cancel_at_period_end = ?5, plan_updated_at = ?6
     WHERE id = ?7 AND plan_updated_at <= ?6`,
  )
    .bind(
      active ? ent.plan : "free",
      ent.status ?? null,
      active && ent.features ? JSON.stringify(ent.features) : null,
      Number.isFinite(periodEnd) ? periodEnd : null,
      ent.cancel_at_period_end ? 1 : 0,
      asOf,
      userId,
    )
    .run();
  return result.meta.changes > 0;
}

async function planRow(env: Env, userId: string) {
  return env.DB.prepare(
    "SELECT plan, plan_status, plan_features, plan_period_end, plan_cancel_at_period_end FROM users WHERE id = ?",
  )
    .bind(userId)
    .first<PlanRow>();
}

export async function currentPlan(request: Request, env: Env, now: number) {
  const { id } = await requireMember(request, env, now);
  // Straight after checkout the webhook may not have landed yet, so the site asks for a refresh.
  if (new URL(request.url).searchParams.get("refresh") === "1") {
    const answer = await paygate(env, "GET", `/entitlements/${encodeURIComponent(id)}`);
    if (answer.status !== 200) paygateFailed("entitlements", answer);
    await storeEntitlement(env, id, answer.body as Entitlement, now);
  }
  const row = await planRow(env, id);
  if (!row) throw new HttpError(401, MESSAGES.signedOut);
  return json(publicPlan(row));
}

export async function startCheckout(request: Request, env: Env, now: number, origin: string) {
  const { id, user } = await requireMember(request, env, now);
  const body = await readJson(request);
  const plan = PAID_PLANS.find((p) => p === body.plan);
  const interval = INTERVALS.find((i) => i === (body.interval ?? "month"));
  if (!plan || !interval) throw new HttpError(400, MESSAGES.badPlan);
  const code = discountCode(body.code);

  const answer = await paygate(env, "POST", "/checkout", {
    customer: { external_id: id, email: user.email },
    plan,
    interval,
    // A code chosen on the site is applied up front; without one, Checkout offers a box for it.
    ...(code ? { promotion_code: code } : { allow_promotion_codes: true }),
    // Back to the site the reader came from: one of ALLOWED_ORIGINS.
    success_url: `${origin}/account?billing=success`,
    cancel_url: `${origin}/pricing`,
    metadata: { floodwall_user: id },
  });
  if (answer.status === 409 && answer.body?.error?.code === "already_subscribed") {
    throw new HttpError(409, MESSAGES.alreadySubscribed);
  }
  if (refusedCode(answer)) throw new HttpError(400, MESSAGES.badCode);
  if (answer.status !== 200 && answer.status !== 201) paygateFailed("checkout", answer);
  return json({ url: answer.body.url });
}

export async function manageBilling(request: Request, env: Env, now: number) {
  const { id } = await requireMember(request, env, now);
  const answer = await paygate(env, "POST", "/billing-link", { external_id: id });
  if (answer.status === 404) throw new HttpError(404, MESSAGES.noBilling);
  if (answer.status !== 200 && answer.status !== 201) paygateFailed("billing link", answer);
  return json({ url: answer.body.url });
}

const refusedCode = (answer: { status: number; body: any }) =>
  answer.status === 400 && answer.body?.error?.code === "invalid_promotion_code";

/** What a discount code takes off ("20% off for 3 months"), so the site can show it before checkout. */
export async function lookupCode(request: Request, env: Env, now: number) {
  await requireMember(request, env, now);
  const code = discountCode(new URL(request.url).searchParams.get("code"));
  if (!code) throw new HttpError(400, MESSAGES.badCode);
  const answer = await paygate(env, "GET", `/promotion-codes/${encodeURIComponent(code)}`);
  if (refusedCode(answer) || answer.status === 404) throw new HttpError(400, MESSAGES.badCode);
  if (answer.status !== 200) paygateFailed("promotion code", answer);
  return json({ code: answer.body.code as string, summary: (answer.body.coupon?.summary ?? null) as string | null });
}

/** One line of the account's credit history: what was granted or spent, in cents. */
type CreditLine = { amount: number; description: string | null; created: string | null };

/** The account's credit: Stripe spends it on the next invoices before charging the card. */
export async function currentCredits(request: Request, env: Env, now: number) {
  const { id } = await requireMember(request, env, now);
  const answer = await paygate(env, "GET", `/customers/${encodeURIComponent(id)}/credits?limit=10`);
  // No Paygate customer yet: never bought or been given anything.
  if (answer.status === 404) return json({ credit: 0, currency: null, history: [] });
  if (answer.status !== 200) paygateFailed("credits", answer);
  const history: CreditLine[] = (answer.body.transactions ?? []).map((t: any) => ({
    // Stripe counts credit as a negative balance; the site shows what was added as positive.
    amount: -Number(t.amount),
    description: t.description ?? null,
    created: t.created ?? null,
  }));
  return json({ credit: Math.max(0, Number(answer.body.credit) || 0), currency: answer.body.currency ?? null, history });
}

/** Checks `Paygate-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`. */
export async function verifySignature(secret: string, header: string | null, body: string, now: number) {
  if (!header) return false;
  const parts = new Map(header.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
  const t = Number(parts.get("t"));
  const given = parts.get("v1");
  if (!Number.isInteger(t) || !given || !/^[0-9a-f]{64}$/.test(given)) return false;
  if (Math.abs(now - t * 1000) > SIGNATURE_TOLERANCE_MS) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signature = new Uint8Array(given.match(/../g)!.map((h) => parseInt(h, 16)));
  // verify() compares in constant time.
  return crypto.subtle.verify("HMAC", key, signature, new TextEncoder().encode(`${t}.${body}`));
}

type PaygateEvent = {
  id: string;
  type: string;
  created: string;
  customer?: { external_id?: string } | null;
  data?: any;
};

export async function receiveWebhook(request: Request, env: Env, now: number) {
  if (!env.PAYGATE_WEBHOOK_SECRET) {
    console.error("billing is not configured: set PAYGATE_WEBHOOK_SECRET");
    throw new HttpError(503, MESSAGES.billingUnavailable);
  }
  const raw = await readBody(request, MAX_WEBHOOK_LENGTH);
  if (!(await verifySignature(env.PAYGATE_WEBHOOK_SECRET, request.headers.get("Paygate-Signature"), raw, now))) {
    throw new HttpError(400, MESSAGES.badRequest);
  }
  let event: PaygateEvent;
  try {
    event = JSON.parse(raw);
  } catch {
    throw new HttpError(400, MESSAGES.badRequest);
  }
  if (!event || typeof event.id !== "string" || typeof event.type !== "string") {
    throw new HttpError(400, MESSAGES.badRequest);
  }

  const seen = await env.DB.prepare("SELECT 1 FROM billing_events WHERE id = ?").bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });

  const userId = event.customer?.external_id;
  const created = Date.parse(event.created);
  const asOf = Number.isFinite(created) ? created : now;
  if (userId) {
    switch (event.type) {
      case "entitlement.changed":
        if (event.data?.entitlement) await storeEntitlement(env, userId, event.data.entitlement, asOf);
        break;
      case "payment.failed":
        await notifyPaymentFailed(env, userId);
        break;
    }
  }
  // Recorded once handled: a failure above answers 500 and Paygate sends the event again.
  await env.DB.prepare("INSERT OR IGNORE INTO billing_events (id, type, received_at) VALUES (?, ?, ?)")
    .bind(event.id, event.type, now)
    .run();
  return json({ received: true });
}

async function notifyPaymentFailed(env: Env, userId: string) {
  const row = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(userId).first<{ email: string }>();
  if (!row) return;
  const origin = env.ALLOWED_ORIGINS.split(",")[0].trim();
  try {
    await sendEmail(env, row.email, paymentFailedEmail(`${origin}/account`));
  } catch (error) {
    // The plan itself follows from entitlement.changed; a lost reminder isn't worth a retry storm.
    console.error("billing: payment-failed email not sent", error);
  }
}
