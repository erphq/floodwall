import { useEffect, useState } from "react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { BILLING_COPY, BILLING_RETURN_PARAM, PLAN_NAMES, PLAN_PRICES } from "../../constants/billing";
import { ENTERPRISE_PLAN, PRICING_PATH, PRICING_PLANS, type BillingInterval, type PaidPlanKey } from "../../constants/pricing";
import { billingDemo, formatCredit, resetDemoPlan, saveCode } from "../../helpers/billing";
import { cx } from "../../helpers/cx";
import { useBilling } from "../../hooks/useBilling";
import { consoleLink } from "../../styles/classes";
import { ConsoleButton } from "../console/ConsoleButton";
import { Icon } from "../shared/Icon";
import { DiscountCodeField } from "./DiscountCodeField";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** The hosted plans, in order: Free, Team, Business (Self-host is the crate, not an account plan). */
const ACCOUNT_PLANS = PRICING_PLANS.filter((p) => p.name === "Free" || p.planKey);
const RANK: Record<string, number> = { free: 0, team: 1, business: 2 };

const planKeyOf = (name: string) => name.toLowerCase();

function price(key: string, interval: BillingInterval) {
  if (key === "free") return { amount: "$0", per: BILLING_COPY.perMonth };
  const cents = PLAN_PRICES[key as PaidPlanKey][interval];
  return {
    amount: formatCredit(cents, "usd").replace(/\.00$/, ""),
    per: interval === "year" ? BILLING_COPY.perYear : BILLING_COPY.perMonth,
  };
}

/**
 * The account's plan and every plan it could be on, side by side. Free buys a paid plan through
 * Stripe Checkout (monthly or yearly, with a discount code); a paid plan switches to the other paid
 * plan here, after seeing what the switch charges now, and goes to Paygate's billing page for
 * invoices, card and cancelling. Coming back from Checkout (?billing=success) it asks Paygate for the
 * plan, since the webhook may not have landed yet.
 */
export function BillingCard() {
  const [returning] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get(BILLING_RETURN_PARAM) === "success",
  );
  const billing = useBilling(true, { refreshFirst: returning });
  const [notice, setNotice] = useState(returning ? BILLING_COPY.checking : "");
  const [interval, setBillingInterval] = useState<BillingInterval>("month");

  useEffect(() => {
    if (!returning || !billing.plan) return;
    setNotice(billing.plan.plan === "free" ? BILLING_COPY.stillProcessing : BILLING_COPY.thanks);
    // The code was spent on that checkout.
    saveCode("");
    // Drop the parameter so a reload doesn't say it again.
    const url = new URL(window.location.href);
    url.searchParams.delete(BILLING_RETURN_PARAM);
    window.history.replaceState(window.history.state, "", url);
  }, [returning, billing.plan]);

  const plan = billing.plan;
  const current = plan?.plan ?? null;
  const paid = !!current && current !== "free";
  // A paid plan is shown at its own billing period; Free picks the period it would buy.
  const shownInterval: BillingInterval = paid ? (plan?.interval ?? "month") : interval;

  if (!plan) {
    return (
      <div className="px-5 py-6 text-sm text-muted console-narrow:px-4" aria-busy={!billing.error}>
        <p role="status" aria-live="polite">{billing.error || "Loading your plan…"}</p>
      </div>
    );
  }

  const currentPrice = price(plan.plan, shownInterval);

  return (
    <div className="flex flex-col">
      {/* The plan the account is on, and the way to its invoices. */}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-4 console-narrow:px-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-[15px] text-ink">
            You're on <strong className="font-semibold">{PLAN_NAMES[plan.plan] ?? plan.plan}</strong>
            <span className="text-muted">
              {" "}
              · {currentPrice.amount} {currentPrice.per}
            </span>
          </p>
          {paid && plan.periodEnd && (
            <p className="text-sm text-muted">
              {plan.cancelAtPeriodEnd ? BILLING_COPY.ends : BILLING_COPY.renews} {dateFormat.format(plan.periodEnd)}
              {plan.cancelAtPeriodEnd && ", then you move to Free"}.
            </p>
          )}
          {!paid && <p className="text-sm text-muted">{BILLING_COPY.free}</p>}
          {plan.status === "past_due" && <p className="text-sm font-medium text-warn">{BILLING_COPY.pastDue}</p>}
          {!!billing.credit?.credit && (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">{BILLING_COPY.credit(formatCredit(billing.credit.credit, billing.credit.currency))}</span>
              {". "}
              {BILLING_COPY.creditNote}
            </p>
          )}
        </div>
        {paid && (
          <ConsoleButton variant="secondary" disabled={!!billing.busy} onClick={() => void billing.manage()}>
            {billing.busy === "manage" ? BILLING_COPY.openingBilling : BILLING_COPY.manage}
          </ConsoleButton>
        )}
      </div>

      {/* Free chooses how often it would pay; a paid plan keeps its own period. */}
      {!paid && (
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 console-narrow:px-4">
          <span className="text-sm text-muted" id="billing-interval">
            Pay
          </span>
          <div role="radiogroup" aria-labelledby="billing-interval" className="inline-flex border border-line">
            {(["month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={interval === value}
                onClick={() => setBillingInterval(value)}
                className={cx(
                  "h-8 px-3 text-sm transition-colors duration-150",
                  interval === value ? "bg-action font-medium text-action-text" : "text-muted hover:text-ink",
                )}
              >
                {value === "month" ? BILLING_COPY.monthly : BILLING_COPY.yearly}
              </button>
            ))}
          </div>
          <span className="text-sm text-muted">Yearly is {BILLING_COPY.yearlyNote}.</span>
        </div>
      )}

      {/* The three hosted plans as one ruled row of cells. */}
      <ul className="grid grid-cols-3 border-t border-line console-narrow:grid-cols-1" aria-label="Plans">
        {ACCOUNT_PLANS.map((p) => {
          const key = planKeyOf(p.name);
          const isCurrent = key === current;
          const { amount, per } = price(key, shownInterval);
          return (
            <li
              key={key}
              aria-current={isCurrent || undefined}
              className={cx(
                "flex min-w-0 flex-col gap-3 px-5 py-5 console-narrow:px-4",
                "[&+&]:border-l [&+&]:border-line console-narrow:[&+&]:border-l-0 console-narrow:[&+&]:border-t",
                isCurrent && "bg-subtle",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold text-ink">{p.name}</h3>
                {isCurrent && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
                    <Icon icon={CheckmarkCircle02Icon} size={14} />
                    {BILLING_COPY.currentBadge}
                  </span>
                )}
              </div>
              <p className="text-ink">
                <span className="text-[26px] leading-none font-[550] tracking-[-0.03em] tabular-nums">{amount}</span>{" "}
                <span className="text-sm text-muted">{per}</span>
              </p>
              <p className="text-sm leading-normal text-muted">{p.summary}</p>
              <ul className="flex flex-col gap-1.5 text-sm text-ink-soft">
                {[...(p.typical ? [p.typical.spend] : []), ...p.features.slice(0, 3)].map((feature) => (
                  <li key={feature} className="flex gap-2">
                    <span aria-hidden="true" className="mt-[9px] size-1 shrink-0 bg-muted" />
                    {feature}
                  </li>
                ))}
              </ul>
              <div className="mt-auto pt-2">
                <PlanAction planKey={key} current={current} interval={interval} billing={billing} />
              </div>
            </li>
          );
        })}
      </ul>

      {/* A switch between paid plans, priced before it happens. */}
      {billing.pending && current && (
        <div className="flex flex-col gap-3 border-t border-line bg-subtle px-5 py-4 console-narrow:px-4" role="group" aria-label="Confirm plan switch">
          <p className="text-sm text-ink">
            <strong className="font-semibold">
              {PLAN_NAMES[current]} to {PLAN_NAMES[billing.pending.plan]}.
            </strong>{" "}
            {billing.pending.amountDue > 0
              ? BILLING_COPY.chargeNow(formatCredit(billing.pending.amountDue, billing.pending.currency))
              : BILLING_COPY.noChargeNow}
          </p>
          <div className="flex flex-wrap gap-2">
            <ConsoleButton
              disabled={!!billing.busy}
              onClick={() => {
                const to = billing.pending!.plan;
                void billing.confirmSwitch().then((ok) => ok && setNotice(BILLING_COPY.switched(to)));
              }}
            >
              {billing.busy?.startsWith("switch:") ? BILLING_COPY.switching : BILLING_COPY.confirmSwitch(billing.pending.plan)}
            </ConsoleButton>
            <ConsoleButton variant="secondary" disabled={!!billing.busy} onClick={billing.cancelSwitch}>
              {BILLING_COPY.keep(current)}
            </ConsoleButton>
          </div>
        </div>
      )}

      {!paid && (
        <div className="border-t border-line px-5 py-4 console-narrow:px-4">
          <DiscountCodeField
            code={billing.code}
            error={billing.codeError}
            checking={billing.checkingCode}
            onApply={(typed) => void billing.applyCode(typed)}
            onRemove={billing.clearCode}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line px-5 py-3 text-sm text-muted console-narrow:px-4">
        <p>
          {BILLING_COPY.enterprise}{" "}
          <a className={consoleLink} href={ENTERPRISE_PLAN.cta.href}>
            {BILLING_COPY.enterpriseLink}
          </a>
          .
        </p>
        <a className={consoleLink} href={PRICING_PATH}>
          {BILLING_COPY.compare}
        </a>
      </div>

      {billingDemo && (
        <p className="border-t border-line bg-subtle px-5 py-3 font-mono text-xs leading-normal text-ink-soft console-narrow:px-4">
          {BILLING_COPY.demo}
          {paid && (
            <>
              {" "}
              <button
                type="button"
                className="underline underline-offset-4 hover:text-ink"
                onClick={() => {
                  resetDemoPlan();
                  window.location.reload();
                }}
              >
                {BILLING_COPY.demoCancel}
              </button>
            </>
          )}
        </p>
      )}

      <p role="status" aria-live="polite" className="border-t border-line px-5 py-3 text-sm text-ink empty:hidden console-narrow:px-4">
        {billing.error || notice}
      </p>
    </div>
  );
}

type Billing = ReturnType<typeof useBilling>;

/** What a plan's cell offers: nothing for the current plan, checkout from Free, a priced switch between paid plans. */
function PlanAction({ planKey, current, interval, billing }: { planKey: string; current: string | null; interval: BillingInterval; billing: Billing }) {
  if (!current || planKey === current) return null;
  if (planKey === "free") return <p className="text-sm text-muted">{BILLING_COPY.toFree}</p>;
  const key = planKey as PaidPlanKey;
  const up = RANK[planKey] > RANK[current];
  if (current === "free") {
    return (
      <ConsoleButton disabled={!!billing.busy} onClick={() => void billing.checkout(key, interval)}>
        {billing.busy === `${key}:${interval}` ? BILLING_COPY.opening : BILLING_COPY.upgrade(key)}
      </ConsoleButton>
    );
  }
  return (
    <ConsoleButton
      variant={up ? "primary" : "secondary"}
      disabled={!!billing.busy || billing.pending?.plan === key}
      onClick={() => void billing.previewSwitch(key)}
    >
      {billing.busy === `preview:${key}` ? BILLING_COPY.previewing : BILLING_COPY.switchTo(key)}
    </ConsoleButton>
  );
}
