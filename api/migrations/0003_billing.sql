-- Billing through Paygate (pay.erpai.studio), which runs Stripe for us. An
-- account's plan is copied here from Paygate's entitlement.changed webhook,
-- so pages can read it without calling Paygate. Every account starts on Free.

ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
-- Paygate's subscription status: active, trialing, past_due, canceled, or null on Free.
ALTER TABLE users ADD COLUMN plan_status TEXT;
-- The plan's limits as JSON (planes, decisions_included, retention_days, ...).
ALTER TABLE users ADD COLUMN plan_features TEXT;
ALTER TABLE users ADD COLUMN plan_period_end INTEGER;
ALTER TABLE users ADD COLUMN plan_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
-- When the state copied here was true. Webhooks can arrive out of order, so
-- an older one never overwrites a newer one.
ALTER TABLE users ADD COLUMN plan_updated_at INTEGER NOT NULL DEFAULT 0;

-- Webhooks already handled, by Paygate's event id: delivery is at least once.
CREATE TABLE billing_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at INTEGER NOT NULL
);

CREATE INDEX billing_events_received ON billing_events (received_at);
