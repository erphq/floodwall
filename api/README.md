# Sign-in service

A Cloudflare Worker, at `api.floodwall.ai`, behind the site's `/login`,
`/signup`, `/account`, `/waitlist` and `/app` pages. You sign in with a
six-digit code emailed through [Resend](https://resend.com). There is no
password, and the first sign-in with an address makes the account. During the
beta, new accounts wait for an admin to approve them.

The site uses the service when it is built with `VITE_AUTH_API_URL` set
(`site/.env.production`). Without it, the site runs the same flow as an
in-browser demo that shows the code on the page instead of emailing it.

## How it works

1. **Ask for a code.** The page sends the address. The service makes a random
   six-digit code, stores an HMAC of it (keyed with `AUTH_SECRET`), and emails
   the code. A new code replaces the last one.
2. **Check the code.** The page sends the address and the code. If it matches,
   the service deletes the code, makes the account if there isn't one yet, and
   starts a session.
3. **Stay signed in.** The session is a random token in a cookie that page
   scripts can't read. The service keeps only the token's SHA-256.
4. **Wait, during the beta.** While `SIGNUP_MODE` is `waitlist`, a new account
   is signed in but waiting: the site shows it `/waitlist` instead of the
   console. An admin approves it at `/app/admin`, which emails its owner
   "You're in", and the console opens for them from then on.

### The waitlist and the flag

`SIGNUP_MODE` in `wrangler.jsonc` decides who gets in:

| `SIGNUP_MODE` | A new account | Accounts already waiting |
|---|---|---|
| `waitlist` (deployed) | waits for an admin | wait for an admin |
| `open` | goes straight to the console | go straight to the console too |

Any value but `open` keeps the waitlist, so a typo can't open sign-up. To open
it once the beta is over, set `"SIGNUP_MODE": "open"` and deploy. Setting it
back to `waitlist` closes it again: approved accounts keep their access, and
accounts that joined while it was open stay approved.

The admins are the addresses in the `ADMIN_EMAILS` secret, comma-separated
(kept out of the repository). They never wait, and only they can use
`/app/admin`. On that page they can:

- **Approve** a waiting account. Its owner gets an email that links to the
  console on the site the admin approved from. If that email can't be sent,
  the approval still stands and the page says so.
- **Remove** an account. It is deleted and signed out everywhere; signing in
  again puts it back on the waitlist. Admins can't be removed there.

| Rule | |
|---|---|
| A code lasts | 10 minutes, and works once |
| Tries per code | 5; the fifth wrong one uses the code up |
| New codes | one a minute per address, 5 an hour, 20 a day |
| Per network (IP address) | 30 codes and 60 checks an hour |
| A session lasts | 30 days, or until you sign out |

With five tries a code and twenty codes a day, someone guessing another
person's code gets at most 100 tries a day out of a million codes, and that
person receives every one of those emails.

### What is stored

The D1 database `floodwall-auth` (schema in [`migrations/`](migrations)):

- `users`: the address, when the account was made, the latest sign-in, and
  whether it is `waiting` or `approved` (with when, and by which admin).
- `sign_in_codes`: one live code per address, as an HMAC, with its send time,
  expiry and tries.
- `sessions`: the SHA-256 of each session token, its account and its expiry.
- `rate_limits`: request counts per address and per network, per window.

A daily cron job deletes expired codes, expired sessions and counts from
ended windows. Accounts stay.

### Who may call it

- **Sites.** Only the origins in `ALLOWED_ORIGINS` can read the service's
  answers or send cookies with their requests. A POST from any other origin,
  or with none (`curl`, for one), is refused unread.
- **The cookie.** It's `__Host-floodwall_session`: `HttpOnly`, `Secure`,
  `SameSite=Strict`, host-only for `api.floodwall.ai`. Browsers count
  `floodwall.ai`, `preview.floodwall.ai` and `api.floodwall.ai` as one site,
  so the cookie goes with the site's requests and with nobody else's. Over
  plain HTTP, in local development, it's `floodwall_session` without
  `Secure`.

## API

Every answer is JSON. A refusal is `{ "error": "<a sentence for the reader>" }`,
which the site shows as it is.

| Request | Body | Answer |
|---|---|---|
| `POST /auth/code` | `{ "email": "ada@example.com" }` | `200 { "sent": true }`; `400` not an address; `429` too soon or too many, with `Retry-After`; `502` the email couldn't be sent |
| `POST /auth/verify` | `{ "email": "...", "code": "123456", "name"?: "..." }` | `200 { "user": <user> }` and the session cookie; `400` or `401` wrong or expired code, or `400` a name that can't be kept; `429` too many checks |
| `GET /auth/session` | | `200 { "user": <user> }`, or `{ "user": null }` when signed out |
| `POST /auth/profile` | `{ "name": "..." }` | `200 { "user": <user> }`; an empty name clears it; `400` a name that can't be kept; `401` signed out |
| `POST /auth/signout` | `{}` | `200 { "signedOut": true }`, and the cookie is cleared |
| `GET /admin/users` | | `200 { "signup": "waitlist" \| "open", "users": [...] }`, the waiting ones first; `401` signed out; `403` not an admin |
| `POST /admin/approve` | `{ "email": "..." }` | `200 { "approved": true, "emailed": true \| false }`; `404` no such account; `401`, `403` as above |
| `POST /admin/remove` | `{ "email": "..." }` | `200 { "removed": true }`; `400` an admin; `404` no such account; `401`, `403` as above |

| `GET /billing` | | `200 <plan>`; `?refresh=1` asks Paygate first; `401` signed out; `403` waiting |
| `POST /billing/checkout` | `{ "plan": "team" \| "business", "interval": "month" \| "year" }` | `200 { "url": "<Stripe Checkout>" }`; `400` unknown plan; `409` already on a plan; `502` Paygate failed; `503` no key |
| `POST /billing/manage` | `{}` | `200 { "url": "<Paygate billing page>" }`; `404` never checked out |
| `POST /billing/webhook` | Paygate's event, signed | `200 { "received": true }`; `400` bad or stale signature. Called by Paygate, not the site: no origin check, no session |

`<plan>` is `{ "plan": "free" | "team" | "business", "status", "features", "periodEnd", "cancelAtPeriodEnd" }`.

`<user>` is `{ "email": "...", "name": "..." | null, "waiting": false, "admin": false }`.
`waiting` is true while the account is on the waitlist; the site then shows
`/waitlist` instead of the console. Anything added to the service later that
only approved accounts may use should check `waiting` the same way.

`name` is what the account goes by, or `null` until one is given. Sign-up can
send it with the code (`/auth/verify`): it names a new account, or one with no
name yet, and never replaces a name the account has. `/auth/profile` changes
it. A name is trimmed and its runs of spaces made one; it can be up to 80
characters, and can't hold control characters or the bidirectional overrides
that would make it display as something else. The admin listing carries each
account's `name` too.

Without `RESEND_API_KEY`, or an `AUTH_SECRET` of at least 32 characters,
`/auth/code` and `/auth/verify` answer `503`.

## Billing

Plans are sold through [Paygate](https://pay.erpai.studio), our Stripe hub
(`~/code/v2/payment-gateway`). The Worker never sees a card or a Stripe key:

1. **Upgrade.** `POST /billing/checkout` asks Paygate for a Stripe Checkout
   page for the account (`external_id` = the account's id) and the site goes
   there. Stripe returns to `/account?billing=success`, or `/pricing` if
   cancelled.
2. **Paid.** Paygate sends a signed `entitlement.changed` webhook to
   `POST /billing/webhook`. The Worker checks the signature
   (HMAC-SHA256 with `PAYGATE_WEBHOOK_SECRET`, 5-minute tolerance), skips an
   event id it has seen, and copies the plan, status, limits (`features`) and
   period end onto the account. An older event never overwrites a newer one.
   `payment.failed` emails the owner. Coming back from checkout, the account
   page also asks for `?refresh=1`, in case the webhook is still on its way.
3. **Manage.** `POST /billing/manage` opens Paygate's hosted billing page:
   invoices, card, cancel and resume.

Every account starts on `free`. Plan changes between Team and Business, and
usage-based overage (metered `decisions`, FW-704), come later.

**Paygate setup** (dashboard → Apps → `floodwall`, test mode first): plans
`team` ($49/mo, $490/yr) and `business` ($399/mo, $3,990/yr) with these
features JSON, success and cancel URLs as above, webhook URL
`https://api.floodwall.ai/billing/webhook`, and allowed origins
`https://floodwall.ai`, `https://preview.floodwall.ai`.

```json
{ "planes": 5, "decisions_included": 250000, "retention_days": 90, "approvers": null, "slack": true, "sso": false }
{ "planes": null, "decisions_included": 2500000, "retention_days": 365, "approvers": null, "slack": true, "sso": true, "sla": "99.9" }
```

**Secrets:** `npx wrangler secret put PAYGATE_SECRET_KEY` and
`npx wrangler secret put PAYGATE_WEBHOOK_SECRET`. A `pg_sk_test_…` key keeps
everything in Stripe test mode; going live is swapping in the live key and
live webhook secret, no code change. Run `npm run migrate:remote` for
`0003_billing.sql` before deploying.

## Local development

```sh
cd api
npm ci
cp .dev.vars.example .dev.vars   # add a Resend key, an AUTH_SECRET and your address as an admin
npm run migrate:local
npm run dev                      # http://127.0.0.1:8787
```

Then point the site at it and start the site in another terminal:

```sh
echo VITE_AUTH_API_URL=http://127.0.0.1:8787 > site/.env.development.local
npm --prefix site run dev        # http://127.0.0.1:5173/login
```

Open the site at `127.0.0.1`, not `localhost`. The session cookie is
`SameSite=Strict` on the service's host, `127.0.0.1`, and browsers count
`localhost` as another site, so the cookie would never be sent back.

The codes are real emails, so use an address you can read. Resend only
sends from a domain that's verified in the account the key belongs to.

## Tests

```sh
npm run check   # typecheck, bundle, then the tests
```

The tests run the bundle that `wrangler deploy` would upload in the Workers
runtime (Miniflare), with an empty D1 database and a stand-in for Resend that
keeps every email. A stand-in for Paygate answers the billing calls. They cover the whole flow
and each rule above, including
requests that race each other, a Resend that refuses, a missing secret, the
cookie's attributes, origin checks, the daily sweep, the waitlist, the admin
calls, both settings of `SIGNUP_MODE`, and billing: checkout, the billing
page, signed and replayed webhooks, and webhooks out of order. CI runs them on every pull request.

## Deploying

Once, by someone with access to the Cloudflare account that has the
`floodwall.ai` zone:

1. **Sign in and make the database.**

   ```sh
   cd api
   npx wrangler login
   npx wrangler d1 create floodwall-auth
   ```

   Put the `database_id` it prints into `wrangler.jsonc`, then create the
   tables:

   ```sh
   npm run migrate:remote
   ```

2. **Add the secrets.** None goes in a file that is committed.

   ```sh
   npx wrangler secret put RESEND_API_KEY
   openssl rand -base64 32 | npx wrangler secret put AUTH_SECRET
   npx wrangler secret put ADMIN_EMAILS     # e.g. you@deskera.com,teammate@deskera.com
   ```

3. **Check Resend.** `floodwall.ai` must show as verified in the Resend
   account that issued the key, since `MAIL_FROM`
   (`notifications@floodwall.ai`) is on it. It is: a real code was sent from
   it while building this. Its DNS records are `resend._domainkey` and
   `send.floodwall.ai`.

4. **Deploy.**

   ```sh
   npm run deploy
   ```

   The `api.floodwall.ai` custom domain in `wrangler.jsonc` makes the DNS
   record and the certificate.

5. **Switch the site over.** In `site/.env.production`, uncomment
   `VITE_AUTH_API_URL=https://api.floodwall.ai`, run
   `npm --prefix site run build` to rebuild `docs/`, and commit both. The
   preview workflow builds from the same file, so preview.floodwall.ai switches
   when that commit reaches `preview`.

6. **Try it.** Sign in at `https://preview.floodwall.ai/login` with an
   admin's address: the console opens, with Admin in the menu. Sign up with
   another address you can read: it lands on the waitlist and shows up at
   `/app/admin` to approve.

Later deploys are `npm run deploy`. To change who is an admin, run
`npx wrangler secret put ADMIN_EMAILS` again; it takes effect at once. To
change the schema, add a migration (`migrations/0003_….sql`) and run `npm run migrate:remote` before deploying
code that needs it. Changing `AUTH_SECRET` only invalidates codes sent in the
last ten minutes; sessions don't depend on it.
