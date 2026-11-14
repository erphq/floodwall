import { useEffect, useState } from "react";
import { BILLING_COPY, BILLING_RETURN_PARAM, PLAN_NAMES } from "../../constants/billing";
import { PRICING_PATH } from "../../constants/pricing";
import { billingAvailable, formatCredit, saveCode } from "../../helpers/billing";
import { useBilling } from "../../hooks/useBilling";
import { authCard, monoLabel, pillOutline, pillSolid } from "../../styles/classes";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { DiscountCodeField } from "./DiscountCodeField";

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The account's plan, with the way to upgrade on Free (and a discount code to take off), and
 * Paygate's billing page (invoices, card, cancelling) on a paid plan. Any credit the account holds
 * shows beside the plan. Coming back from Stripe Checkout (?billing=success) it asks Paygate for the
 * plan, since the webhook may not have landed yet.
 */
export function BillingCard() {
  const [returning] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get(BILLING_RETURN_PARAM) === "success",
  );
  const billing = useBilling(billingAvailable, { refreshFirst: returning });
  const [notice, setNotice] = useState(returning ? BILLING_COPY.checking : "");

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

  if (!billingAvailable) {
    return (
      <Card className={authCard}>
        <h2 className={monoLabel}>{BILLING_COPY.title}</h2>
        <p className="text-sm text-muted">{BILLING_COPY.demo}</p>
      </Card>
    );
  }

  const plan = billing.plan;
  const paid = !!plan && plan.plan !== "free";

  return (
    <Card className={authCard} aria-busy={!plan && !billing.error}>
      <h2 className={monoLabel}>{BILLING_COPY.title}</h2>
      {plan && (
        <>
          <p>
            {BILLING_COPY.plan} <strong className="text-ink">{PLAN_NAMES[plan.plan] ?? plan.plan}</strong>
            {paid && plan.periodEnd && (
              <span className="text-muted">
                {" · "}
                {plan.cancelAtPeriodEnd ? BILLING_COPY.ends : BILLING_COPY.renews} {dateFormat.format(plan.periodEnd)}
              </span>
            )}
          </p>
          {plan.status === "past_due" && <p className="text-sm text-ink">{BILLING_COPY.pastDue}</p>}
          {!!billing.credit?.credit && (
            <p>
              {BILLING_COPY.credit(formatCredit(billing.credit.credit, billing.credit.currency))}
              <span className="block text-sm text-muted">{BILLING_COPY.creditNote}</span>
            </p>
          )}
          {!paid && <p className="text-sm text-muted">{BILLING_COPY.free}</p>}
          {!paid && (
            <DiscountCodeField
              code={billing.code}
              error={billing.codeError}
              checking={billing.checkingCode}
              onApply={(typed) => void billing.applyCode(typed)}
              onRemove={billing.clearCode}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {paid ? (
              <Button type="button" className={pillSolid} disabled={!!billing.busy} onClick={() => void billing.manage()}>
                {billing.busy === "manage" ? BILLING_COPY.openingBilling : BILLING_COPY.manage}
              </Button>
            ) : (
              <>
                <Button type="button" className={pillSolid} disabled={!!billing.busy} onClick={() => void billing.checkout("team")}>
                  {billing.busy === "team:month" ? BILLING_COPY.opening : BILLING_COPY.upgrade("team")}
                </Button>
                <Button
                  type="button"
                  className={pillOutline}
                  disabled={!!billing.busy}
                  onClick={() => void billing.checkout("team", "year")}
                >
                  {billing.busy === "team:year" ? BILLING_COPY.opening : BILLING_COPY.upgradeYearly}
                </Button>
              </>
            )}
            <a className="self-center text-sm text-muted underline underline-offset-4 hover:text-ink" href={PRICING_PATH}>
              {BILLING_COPY.compare}
            </a>
          </div>
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm text-muted empty:hidden">
        {billing.error || notice}
      </p>
    </Card>
  );
}
