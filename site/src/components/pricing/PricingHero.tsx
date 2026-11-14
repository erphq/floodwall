import { ArrowRight02Icon, GithubIcon } from "@hugeicons/core-free-icons";
import { EARLY_ACCESS_URL, REPO_URL } from "../../constants/links";
import { ENTERPRISE_PLAN, PRICING_PLANS } from "../../constants/pricing";
import { LandingSectionHeading } from "../landing/LandingSectionHeading";
import { Icon } from "../shared/Icon";
import { CONSOLE_PATHS } from "../../constants/console";
import { BILLING_COPY } from "../../constants/billing";
import { useEffect } from "react";
import { codeFromPage } from "../../helpers/billing";
import { useBilling } from "../../hooks/useBilling";
import { useSession } from "../../hooks/useSession";
import type { PricingPlan } from "../../constants/pricing";
import { DiscountCodeField } from "../billing/DiscountCodeField";
import { type PlanAction, PricingPlanCard } from "./PricingPlanCard";

const SETTINGS_PLAN = `${CONSOLE_PATHS.settings}#plan`;

/** The opening sheet: the offer, the four plans in one ruled rail, and Enterprise across their foot. */
export function PricingHero() {
  const { session } = useSession();
  const member = session.status === "signedIn" && !session.user.waiting;
  const billing = useBilling(member);
  // A link like /pricing?code=LAUNCH20 keeps its code for the tab, through sign-up and sign-in, until
  // checkout; a signed-in account on Free sees it applied below the plans.
  useEffect(() => void codeFromPage(), []);

  // Signed out, or in the demo, every card keeps its link (Get started opens sign-up). A
  // signed-in account sees its own plan marked and can buy the others.
  function actionFor(plan: PricingPlan): PlanAction {
    if (!member || !billing.plan) return { kind: "link" };
    const current = billing.plan.plan;
    if (plan.planKey === current || (plan.name === "Free" && current === "free")) return { kind: "current" };
    // Already paying: switching plan or cancelling happens in the console's settings.
    if (current !== "free") {
      if (plan.planKey) return { kind: "link", cta: { label: BILLING_COPY.switchTo(plan.planKey), href: SETTINGS_PLAN } };
      if (plan.name === "Free") return { kind: "link", cta: { label: BILLING_COPY.manage, href: SETTINGS_PLAN } };
      return { kind: "link" };
    }
    if (!plan.planKey) return { kind: "link" };
    const key = plan.planKey;
    return { kind: "buy", busy: billing.busy === `${key}:month`, onBuy: () => void billing.checkout(key) };
  }

  return (
    <section className="section pricing-intro" aria-labelledby="pricing-title">
      <div className="section-drawing">
        <LandingSectionHeading id="pricing-title" kicker="Pricing" level={1}>
          Free to self-host. <strong>Pay as you grow on Floodwall Cloud.</strong>
        </LandingSectionHeading>
        <div className="pricing-lead">
          <p className="feature-copy">
            The crate is open source and always free to run yourself. Floodwall Cloud hosts the ledger, approvals
            and console for you: a monthly price that includes a generous number of decisions, then a small
            charge for each thousand more.
          </p>
          <div className="pricing-actions">
            <p className="pricing-note">Start on Free. Upgrade when you need more</p>
            <div className="pricing-buttons">
              <a className="button button-lg" href={EARLY_ACCESS_URL}>
                Get started free <Icon icon={ArrowRight02Icon} className="button-arrow" />
              </a>
              <a className="hero-link" href={REPO_URL}>
                <Icon icon={GithubIcon} /> View the Crate <Icon icon={ArrowRight02Icon} />
              </a>
            </div>
          </div>
        </div>
        <ol className="plan-rail" aria-label="Plans">
          {PRICING_PLANS.map((plan) => (
            <PricingPlanCard key={plan.name} plan={plan} action={actionFor(plan)} />
          ))}
        </ol>
        {member && billing.plan?.plan === "free" && (
          <div className="pricing-code">
            <DiscountCodeField
              code={billing.code}
              error={billing.codeError}
              checking={billing.checkingCode}
              onApply={(typed) => void billing.applyCode(typed)}
              onRemove={billing.clearCode}
            />
          </div>
        )}
        <p role="status" aria-live="polite" className="pricing-note empty:hidden">
          {billing.error}
        </p>
        <div className="plan-enterprise">
          <div>
            <h2 className="tag">{ENTERPRISE_PLAN.name}</h2>
            <p className="card-copy">{ENTERPRISE_PLAN.copy}</p>
          </div>
          <a className="hero-link" href={ENTERPRISE_PLAN.cta.href}>
            {ENTERPRISE_PLAN.cta.label} <Icon icon={ArrowRight02Icon} />
          </a>
        </div>
      </div>
    </section>
  );
}
