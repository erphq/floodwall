import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, beforeEach, describe, test } from "node:test";
import { PAYGATE_KEY, PAYGATE_WEBHOOK_SECRET, SITE, start } from "./harness.mjs";

const ADMIN = "grace@example.com";

/** Signs a webhook body the way Paygate does. */
function signed(event, { secret = PAYGATE_WEBHOOK_SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const body = JSON.stringify(event);
  const v1 = createHmac("sha256", secret).update(`${at}.${body}`).digest("hex");
  return { body, headers: { "Paygate-Signature": `t=${at},v1=${v1}` } };
}

let eventCount = 0;
function entitlementEvent(userId, entitlement, created = new Date().toISOString()) {
  eventCount += 1;
  return {
    id: `evt_${eventCount}`,
    type: "entitlement.changed",
    created,
    mode: "test",
    app: "floodwall",
    customer: { id: "cus_1", external_id: userId },
    data: { entitlement, previous: null },
  };
}

const TEAM = {
  active: true,
  plan: "team",
  status: "active",
  current_period_end: "2026-12-14T00:00:00Z",
  cancel_at_period_end: false,
  features: { planes: 5, decisions_included: 250000, retention_days: 90 },
};

describe("billing through Paygate", () => {
  let w;
  let answer; // what the fake Paygate says next
  before(async () => {
    w = await start({ bindings: { ADMIN_EMAILS: ADMIN }, paygate: (call) => answer?.(call) });
  });
  after(() => w.stop());
  beforeEach(async () => {
    answer = null;
    await w.reset();
  });

  const userId = async (email) => (await w.db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()).id;
  const webhook = (event, options) => {
    const { body, headers } = signed(event, options);
    return w.call("/billing/webhook", { body, headers, origin: null });
  };

  test("a new account is on Free", async () => {
    const cookie = await w.signIn(ADMIN);
    const plan = await w.call("/billing", { method: "GET", cookie });
    assert.equal(plan.status, 200);
    assert.deepEqual(plan.body, { plan: "free", status: null, features: null, periodEnd: null, cancelAtPeriodEnd: false });
  });

  test("checkout asks Paygate for a page and returns its url", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = () => Response.json({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
    const r = await w.call("/billing/checkout", { body: { plan: "team", interval: "year" }, cookie });
    assert.equal(r.status, 200);
    assert.equal(r.body.url, "https://checkout.stripe.com/c/pay/cs_1");

    const [call] = w.paygateCalls;
    assert.equal(call.method, "POST");
    assert.equal(call.path, "/v1/checkout");
    assert.equal(call.headers.authorization, `Bearer ${PAYGATE_KEY}`);
    assert.ok(call.headers["idempotency-key"]);
    assert.deepEqual(call.body.customer, { external_id: await userId(ADMIN), email: ADMIN });
    assert.equal(call.body.plan, "team");
    assert.equal(call.body.interval, "year");
    assert.equal(call.body.success_url, `${SITE}/account?billing=success`);
    assert.equal(call.body.cancel_url, `${SITE}/pricing`);
  });

  test("checkout refuses an unknown plan or interval without calling Paygate", async () => {
    const cookie = await w.signIn(ADMIN);
    for (const body of [{ plan: "free" }, { plan: "enterprise" }, { plan: "team", interval: "week" }, {}]) {
      const r = await w.call("/billing/checkout", { body, cookie });
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(w.paygateCalls.length, 0);
  });

  test("an account already on a plan is told to manage it", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = () => Response.json({ error: { code: "already_subscribed", message: "x" } }, { status: 409 });
    const r = await w.call("/billing/checkout", { body: { plan: "business" }, cookie });
    assert.equal(r.status, 409);
    assert.match(r.body.error, /already have a plan/);
  });

  test("Paygate failing is a 502, not a crash", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = () => Response.json({ error: { code: "boom" } }, { status: 500 });
    assert.equal((await w.call("/billing/checkout", { body: { plan: "team" }, cookie })).status, 502);
  });

  test("signed-out and waiting accounts can't buy", async () => {
    assert.equal((await w.call("/billing/checkout", { body: { plan: "team" } })).status, 401);
    assert.equal((await w.call("/billing", { method: "GET" })).status, 401);
    const waiting = await w.signIn("ada@example.com");
    assert.equal((await w.call("/billing/checkout", { body: { plan: "team" }, cookie: waiting })).status, 403);
    assert.equal((await w.call("/billing/manage", { body: {}, cookie: waiting })).status, 403);
    assert.equal(w.paygateCalls.length, 0);
  });

  test("checkout without a Paygate key is unavailable", async () => {
    const bare = await start({ bindings: { ADMIN_EMAILS: ADMIN, PAYGATE_SECRET_KEY: "" } });
    try {
      const cookie = await bare.signIn(ADMIN);
      assert.equal((await bare.call("/billing/checkout", { body: { plan: "team" }, cookie })).status, 503);
    } finally {
      await bare.stop();
    }
  });

  test("manage opens Paygate's hosted billing page", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = () => Response.json({ url: "https://pay.erpai.studio/b/floodwall?t=abc", expires_at: "x" });
    const r = await w.call("/billing/manage", { body: {}, cookie });
    assert.equal(r.status, 200);
    assert.equal(r.body.url, "https://pay.erpai.studio/b/floodwall?t=abc");
    assert.deepEqual(w.paygateCalls[0].body, { external_id: await userId(ADMIN) });

    answer = () => Response.json({ error: { code: "not_found" } }, { status: 404 });
    assert.equal((await w.call("/billing/manage", { body: {}, cookie })).status, 404);
  });

  test("entitlement.changed puts the account on its plan, once", async () => {
    const cookie = await w.signIn(ADMIN);
    const event = entitlementEvent(await userId(ADMIN), TEAM);
    const first = await webhook(event);
    assert.equal(first.status, 200);
    assert.deepEqual(first.body, { received: true });

    const plan = (await w.call("/billing", { method: "GET", cookie })).body;
    assert.equal(plan.plan, "team");
    assert.equal(plan.status, "active");
    assert.equal(plan.periodEnd, Date.parse(TEAM.current_period_end));
    assert.deepEqual(plan.features, TEAM.features);

    const again = await webhook(event);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
  });

  test("an older event never overwrites a newer one", async () => {
    const cookie = await w.signIn(ADMIN);
    const id = await userId(ADMIN);
    await webhook(entitlementEvent(id, TEAM, "2026-11-14T10:00:00Z"));
    const canceled = { active: false, plan: null, status: "canceled", cancel_at_period_end: false, features: null };
    await webhook(entitlementEvent(id, canceled, "2026-11-14T09:00:00Z"));
    assert.equal((await w.call("/billing", { method: "GET", cookie })).body.plan, "team");

    await webhook(entitlementEvent(id, canceled, "2026-11-14T11:00:00Z"));
    const plan = (await w.call("/billing", { method: "GET", cookie })).body;
    assert.equal(plan.plan, "free");
    assert.equal(plan.status, "canceled");
    assert.equal(plan.features, null);
  });

  test("a webhook with a bad or stale signature is refused and changes nothing", async () => {
    const cookie = await w.signIn(ADMIN);
    const event = entitlementEvent(await userId(ADMIN), TEAM);
    assert.equal((await webhook(event, { secret: "whsec_wrong" })).status, 400);
    assert.equal((await webhook(event, { at: Math.floor(Date.now() / 1000) - 600 })).status, 400);
    const unsigned = await w.call("/billing/webhook", { body: JSON.stringify(event), origin: null });
    assert.equal(unsigned.status, 400);
    assert.equal((await w.call("/billing", { method: "GET", cookie })).body.plan, "free");
  });

  test("payment.failed emails the account's owner", async () => {
    await w.signIn(ADMIN);
    const before = w.outbox.length;
    const r = await webhook({
      id: "evt_failed_1",
      type: "payment.failed",
      created: new Date().toISOString(),
      customer: { external_id: await userId(ADMIN) },
      data: { payment: {} },
    });
    assert.equal(r.status, 200);
    assert.equal(w.outbox.length, before + 1);
    assert.equal(w.outbox.at(-1).body.to[0], ADMIN);
    assert.match(w.outbox.at(-1).body.subject, /payment didn't go through/);
  });

  test("refresh copies Paygate's current entitlement", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = (call) => (call.path.startsWith("/v1/entitlements/") ? Response.json({ ...TEAM, plan: "business" }) : null);
    const plan = await w.call("/billing?refresh=1", { method: "GET", cookie });
    assert.equal(plan.status, 200);
    assert.equal(plan.body.plan, "business");
    assert.equal(w.paygateCalls[0].path, `/v1/entitlements/${await userId(ADMIN)}`);
  });

  test("the daily sweep forgets old webhook ids", async () => {
    await w.db.prepare("INSERT INTO billing_events (id, type, received_at) VALUES ('old', 'ping', 1), ('new', 'ping', ?)").bind(Date.now()).run();
    await w.mf.getWorker().then((worker) => worker.scheduled({ cron: "17 3 * * *" }));
    const left = await w.db.prepare("SELECT id FROM billing_events").all();
    assert.deepEqual(left.results.map((r) => r.id), ["new"]);
  });

  test("a discount code is looked up before checkout", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = (call) =>
      call.path === "/v1/promotion-codes/LAUNCH20"
        ? Response.json({ code: "LAUNCH20", coupon: { summary: "20% off for 3 months" } })
        : Response.json({ error: { code: "invalid_promotion_code", message: "x" } }, { status: 400 });
    const good = await w.call("/billing/promo?code=LAUNCH20", { method: "GET", cookie });
    assert.equal(good.status, 200);
    assert.deepEqual(good.body, { code: "LAUNCH20", summary: "20% off for 3 months" });

    const bad = await w.call("/billing/promo?code=NOPE", { method: "GET", cookie });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /isn't valid/);

    const calls = w.paygateCalls.length;
    for (const code of ["", "has space", "x".repeat(65), "../etc"]) {
      const r = await w.call(`/billing/promo?code=${encodeURIComponent(code)}`, { method: "GET", cookie });
      assert.equal(r.status, 400, code);
    }
    assert.equal(w.paygateCalls.length, calls, "malformed codes never reach Paygate");
  });

  test("checkout applies a code instead of offering the box", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = () => Response.json({ url: "https://checkout.stripe.com/c/pay/cs_2" });
    assert.equal((await w.call("/billing/checkout", { body: { plan: "team", code: " LAUNCH20 " }, cookie })).status, 200);
    const [withCode] = w.paygateCalls;
    assert.equal(withCode.body.promotion_code, "LAUNCH20");
    assert.equal(withCode.body.allow_promotion_codes, undefined);

    assert.equal((await w.call("/billing/checkout", { body: { plan: "team" }, cookie })).status, 200);
    assert.equal(w.paygateCalls[1].body.allow_promotion_codes, true);
    assert.equal(w.paygateCalls[1].body.promotion_code, undefined);

    answer = () => Response.json({ error: { code: "invalid_promotion_code", message: "x" } }, { status: 400 });
    const refused = await w.call("/billing/checkout", { body: { plan: "team", code: "EXPIRED" }, cookie });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /isn't valid/);
  });

  test("credits: none before Paygate knows the account, then its balance and history", async () => {
    const cookie = await w.signIn(ADMIN);
    answer = () => Response.json({ error: { code: "not_found" } }, { status: 404 });
    const none = await w.call("/billing/credits", { method: "GET", cookie });
    assert.equal(none.status, 200);
    assert.deepEqual(none.body, { credit: 0, currency: null, history: [] });
    assert.equal(w.paygateCalls[0].path, `/v1/customers/${await userId(ADMIN)}/credits`);

    answer = () =>
      Response.json({
        credit: 2500,
        balance: -2500,
        currency: "usd",
        transactions: [{ id: "cbtxn_1", amount: -2500, currency: "usd", description: "Launch thanks", created: "2026-11-14T10:00:00Z" }],
      });
    const some = (await w.call("/billing/credits", { method: "GET", cookie })).body;
    assert.deepEqual(some, {
      credit: 2500,
      currency: "usd",
      history: [{ amount: 2500, description: "Launch thanks", created: "2026-11-14T10:00:00Z" }],
    });
    assert.equal((await w.call("/billing/credits", { method: "GET" })).status, 401);
  });

  test("an admin gives credit: the customer with its email, then the grant, keyed for retries", async () => {
    const cookie = await w.signIn(ADMIN);
    await w.signIn("ada@example.com");
    const ada = await userId("ada@example.com");
    answer = (call) =>
      call.method === "PUT"
        ? Response.json({ id: "cus_1", external_id: ada })
        : Response.json({ credit: 5000, balance: -5000, currency: "usd", transaction: {} }, { status: 201 });
    const r = await w.call("/admin/credit", {
      body: { email: "Ada@Example.com", dollars: 50, note: "Sorry for the outage", requestId: "req-12345678" },
      cookie,
    });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { granted: 5000, credit: 5000, currency: "usd" });

    const [put, post] = w.paygateCalls;
    assert.equal(put.method, "PUT");
    assert.equal(put.path, `/v1/customers/${ada}`);
    assert.deepEqual(put.body, { email: "ada@example.com" });
    assert.equal(post.path, `/v1/customers/${ada}/credits`);
    assert.deepEqual(post.body, { amount: 5000, currency: "usd", description: "Sorry for the outage" });
    assert.equal(post.headers["idempotency-key"], "credit:req-12345678");
  });

  test("credit is refused to non-admins, bad amounts and unknown accounts", async () => {
    const member = await w.signIn("ada@example.com");
    const body = { email: ADMIN, dollars: 10, requestId: "req-12345678" };
    assert.equal((await w.call("/admin/credit", { body, cookie: member })).status, 403);
    const cookie = await w.signIn(ADMIN);
    for (const dollars of [0, -5, 1.5, 10_001, "10", undefined]) {
      assert.equal((await w.call("/admin/credit", { body: { ...body, dollars }, cookie })).status, 400, String(dollars));
    }
    assert.equal((await w.call("/admin/credit", { body: { ...body, requestId: undefined }, cookie })).status, 400);
    assert.equal((await w.call("/admin/credit", { body: { ...body, email: "nobody@example.com" }, cookie })).status, 404);
    assert.equal(w.paygateCalls.length, 0);
  });
});
