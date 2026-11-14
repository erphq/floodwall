// The waitlist, for the admins named in ADMIN_EMAILS. Every call needs an
// admin's session; the site shows these at /app/admin.
//
//   GET  /admin/users              every account, the waiting ones first
//   POST /admin/approve  { email } lets a waiting account in and emails it
//   POST /admin/remove   { email } deletes an account and its sessions
//   POST /admin/credit   { email, dollars, note?, requestId } gives an account credit through Paygate

import { adminEmails, isOpen, normalizeEmail, sessionUser } from "./auth";
import type { Env } from "./env";
import { paygate, paygateFailed } from "./billing";
import { HttpError, json, readJson } from "./http";
import { approvedEmail, sendEmail } from "./mail";
import { MESSAGES } from "./rules";

/** The most accounts one listing returns. */
const LIST_LIMIT = 1000;

async function requireAdmin(request: Request, env: Env, now: number) {
  const user = await sessionUser(request, env, now);
  if (!user) throw new HttpError(401, MESSAGES.signedOut);
  if (!user.admin) throw new HttpError(403, MESSAGES.notAdmin);
  return user;
}

async function emailFrom(request: Request) {
  const email = normalizeEmail((await readJson(request)).email);
  if (!email) throw new HttpError(400, MESSAGES.badEmail);
  return email;
}

type AccountRow = {
  email: string;
  status: string;
  created_at: number;
  last_sign_in_at: number;
  approved_at: number | null;
  approved_by: string | null;
};

export async function listUsers(request: Request, env: Env, now: number) {
  await requireAdmin(request, env, now);
  const admins = adminEmails(env);
  const { results } = await env.DB.prepare(
    `SELECT email, status, created_at, last_sign_in_at, approved_at, approved_by FROM users
     ORDER BY status = 'waiting' DESC, created_at DESC LIMIT ?`,
  )
    .bind(LIST_LIMIT)
    .all<AccountRow>();
  const open = isOpen(env);
  const users = results.map((row) => ({
    email: row.email,
    // The status the account has now: an admin never waits, even one added to
    // ADMIN_EMAILS after joining the waitlist, and nobody waits while sign-up
    // is open. A row stored as waiting waits again if the waitlist comes back.
    status: open || admins.has(row.email) ? "approved" : row.status,
    admin: admins.has(row.email),
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
  }));
  // Sorting is stable, so each group stays newest first.
  users.sort((a, b) => Number(b.status === "waiting") - Number(a.status === "waiting"));
  return json({ signup: open ? "open" : "waitlist", users });
}

/** Approves a waiting account and tells its owner. `origin` is the site the admin is on. */
export async function approveUser(request: Request, env: Env, now: number, origin: string) {
  const admin = await requireAdmin(request, env, now);
  const email = await emailFrom(request);
  const approved = await env.DB.prepare(
    `UPDATE users SET status = 'approved', approved_at = ?2, approved_by = ?3
     WHERE email = ?1 AND status != 'approved' RETURNING email`,
  )
    .bind(email, now, admin.email)
    .first();
  if (!approved) {
    const exists = await env.DB.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first();
    if (!exists) throw new HttpError(404, MESSAGES.noSuchUser);
    // Already approved, by another admin or an earlier click: nothing to send,
    // and nothing failed.
    return json({ approved: true, emailed: false, alreadyApproved: true });
  }
  // The approval stands even if the email doesn't go: the account works the
  // next time its owner opens the site, and the admin is told.
  let emailed = true;
  try {
    await sendEmail(env, email, approvedEmail(`${origin}/app`));
  } catch {
    emailed = false;
  }
  return json({ approved: true, emailed });
}

/** Deletes an account and signs it out everywhere. Signing in again puts it back on the waitlist. */
export async function removeUser(request: Request, env: Env, now: number) {
  await requireAdmin(request, env, now);
  const email = await emailFrom(request);
  if (adminEmails(env).has(email)) throw new HttpError(400, MESSAGES.adminStays);
  const db = env.DB;
  const [, , removed] = await db.batch([
    db.prepare("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)").bind(email),
    db.prepare("DELETE FROM sign_in_codes WHERE email = ?").bind(email),
    db.prepare("DELETE FROM users WHERE email = ?").bind(email),
  ]);
  if (!removed.meta.changes) throw new HttpError(404, MESSAGES.noSuchUser);
  return json({ removed: true });
}

/** The most credit one grant gives, in dollars. */
const MAX_CREDIT_DOLLARS = 10_000;

/**
 * Gives an account credit, which Stripe spends on its next invoices before charging its card. The
 * page sends a `requestId` per grant and repeats it on a retry, so a grant whose answer was lost
 * isn't given twice.
 */
export async function grantCredit(request: Request, env: Env, now: number) {
  const admin = await requireAdmin(request, env, now);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, MESSAGES.badEmail);
  const dollars = body.dollars;
  if (typeof dollars !== "number" || !Number.isInteger(dollars) || dollars < 1 || dollars > MAX_CREDIT_DOLLARS) {
    throw new HttpError(400, MESSAGES.badCredit);
  }
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
  const requestId = typeof body.requestId === "string" && /^[\w-]{8,64}$/.test(body.requestId) ? body.requestId : null;
  if (!requestId) throw new HttpError(400, MESSAGES.badRequest);

  const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
  if (!user) throw new HttpError(404, MESSAGES.noSuchUser);
  const path = `/customers/${encodeURIComponent(user.id)}`;

  // The customer first, with its email, so the Stripe customer the credit sits on carries it.
  const customer = await paygate(env, "PUT", path, { email }, `credit-customer:${requestId}`);
  if (customer.status !== 200) paygateFailed("customer", customer);
  const answer = await paygate(
    env,
    "POST",
    `${path}/credits`,
    { amount: dollars * 100, currency: "usd", description: note || `Credit from Floodwall (${admin.email})` },
    `credit:${requestId}`,
  );
  if (answer.status === 400 && answer.body?.error?.code === "currency_mismatch") {
    throw new HttpError(400, answer.body.error.message ?? MESSAGES.badCredit);
  }
  if (answer.status !== 200 && answer.status !== 201) paygateFailed("credit", answer);
  return json({ granted: dollars * 100, credit: Number(answer.body.credit) || 0, currency: answer.body.currency ?? "usd" });
}
