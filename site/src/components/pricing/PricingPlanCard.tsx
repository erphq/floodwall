import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { BILLING_COPY } from "../../constants/billing";
import type { PricingPlan } from "../../constants/pricing";
import { Icon } from "../shared/Icon";

/**
 * What the card's button does for this reader: a link (signed out, or a plan that isn't sold), the
 * reader's own plan, or checkout for a signed-in account.
 */
export type PlanAction =
  | { kind: "link"; cta?: { label: string; href: string } }
  | { kind: "current" }
  | { kind: "buy"; busy: boolean; onBuy: () => void };

/**
 * One plan in the rail: its price, who it's for, what it includes, and how to start. The plan most
 * teams start on is marked in its title band and carries the one filled button.
 */
export function PricingPlanCard({ plan, action = { kind: "link" } }: { plan: PricingPlan; action?: PlanAction }) {
  const { name, price, priceNote, summary, typical, features, featured } = plan;
  const cta = (action.kind === "link" && action.cta) || plan.cta;

  return (
    <li className="plan" data-featured={featured || undefined}>
      <div className="plan-head">
        <h2 className="tag">{name}</h2>
        {featured && <span className="plan-mark">Most teams</span>}
      </div>
      <p className="plan-price">
        <span className="plan-amount">{price}</span>
        <span className="plan-unit">{priceNote}</span>
      </p>
      <div className="plan-body">
        <p className="card-copy">{summary}</p>
        {typical && (
          <p className="plan-typical">
            <strong>{typical.spend}</strong>, {typical.basis}
          </p>
        )}
      </div>
      <ul className="plan-features">
        {features.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>
      <div className="plan-cta">
        {action.kind === "current" ? (
          <p className="plan-unit">{BILLING_COPY.current}</p>
        ) : action.kind === "buy" ? (
          <button
            type="button"
            className={featured ? "button button-lg" : "hero-link"}
            disabled={action.busy}
            onClick={action.onBuy}
          >
            {action.busy ? BILLING_COPY.opening : BILLING_COPY.upgrade(plan.planKey!)}{" "}
            <Icon icon={ArrowRight02Icon} className={featured ? "button-arrow" : undefined} />
          </button>
        ) : featured ? (
          <a className="button button-lg" href={cta.href}>
            {cta.label} <Icon icon={ArrowRight02Icon} className="button-arrow" />
          </a>
        ) : (
          <a className="hero-link" href={cta.href}>
            {cta.label} <Icon icon={ArrowRight02Icon} />
          </a>
        )}
      </div>
    </li>
  );
}
