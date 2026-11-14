# Testing Floodwall

Three parts, each tested on its own, then together on the preview site.

| Part | Where | What it is |
|---|---|---|
| Crate | `src/`, `tests/` | The Rust library: admission, scheduler, gate, hold queue, ledger |
| Sign-in and billing service | `api/` | Cloudflare Worker at `api.floodwall.ai`, D1 `floodwall-auth`, Paygate for payments |
| Site | `site/` → `docs/` | React + Vite: floodwall.ai (from `main`), preview.floodwall.ai (from `preview`) |

Run one test command at a time.

## 1. Crate

```sh
cargo test
cargo clippy --all-targets -- -D warnings
cargo run --example production          # the OPA/Rego-style guardrails at the gate
node --test tools/verify-ledger.test.mjs # the independent ledger verifier
```

## 2. Service, locally

```sh
cd api
npm ci
npm run check                 # typecheck, bundle, Miniflare tests (Resend and Paygate stood in)
cp .dev.vars.example .dev.vars   # Resend key, AUTH_SECRET, your address in ADMIN_EMAILS, Paygate test key
npm run migrate:local
npm run dev                   # http://127.0.0.1:8787
```

And the site against it, in another terminal:

```sh
echo VITE_AUTH_API_URL=http://127.0.0.1:8787 > site/.env.development.local
npm --prefix site run dev     # open http://127.0.0.1:5173 (not localhost: the cookie is SameSite=Strict)
```

Without `VITE_AUTH_API_URL` the site runs an in-browser demo: the code is shown on the page and
billing says it needs the service.

### Billing end to end, locally

Paygate has to reach the local Worker for webhooks:

```sh
cloudflared tunnel --url http://127.0.0.1:8787
```

In Paygate (test mode), set the floodwall app's webhook URL to `<tunnel>/billing/webhook` and
send a test webhook. Then:

1. Sign in, open `/account`, choose **Move to Team**.
2. Pay with `4242 4242 4242 4242`, any future date, any CVC.
3. Back on `/account?billing=success`: it says the plan is active and shows **Team** with its
   renewal date. In D1: `npx wrangler d1 execute floodwall-auth --local --command "SELECT email, plan, plan_status FROM users"`.
4. **Invoices, card and cancelling** opens Paygate's billing page. Cancel: the account shows
   **Ends <date>** and returns to Free when the period ends (advance a test clock on Paygate's
   **Testing** page to see it).
5. A declined card (`4000 0000 0000 0002`) sends `payment.failed`: the owner gets an email.
6. Paygate's **Webhooks to apps** shows every delivery and lets you resend one; a resend is
   answered `duplicate: true` and changes nothing.

## 3. Site

```sh
npm --prefix site test
npm --prefix site run build    # writes docs/; add `-- --outDir <dir>` to build elsewhere
```

## 4. Live, on preview.floodwall.ai

Pushing to `preview` deploys the site (`.github/workflows/preview.yml`). The Worker deploys by hand:

```sh
cd api && npm run migrate:remote && npm run deploy
npx wrangler tail floodwall-api      # live logs while you test
curl -i https://api.floodwall.ai/auth/session   # 200 { "user": null }
```

Smoke test, in a private window:

1. `/signup` with an address you can read → six-digit code by email → `/waitlist`.
2. As an admin (`ADMIN_EMAILS`), `/app/admin` → **Approve** → the "You're in" email → `/app`.
3. `/account` → **Plan and billing** shows **Free**.
4. `/pricing` signed in: Free is marked **Your plan**; **Move to Team** opens Stripe Checkout.
5. Pay with the 4242 test card (the service holds a `pg_sk_test_…` key, so nothing is charged),
   come back to `/account`, see **Team**.
6. Open the billing page, cancel, check the account shows the end date.
7. Sign out; `/account` sends you to `/login`.

Going live is swapping the Worker's Paygate key and webhook secret for live ones
(`npx wrangler secret put …`), after the Terms, Privacy and Refund pages are up (FW-605).
