import { ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { PRICING_PATH } from "../../constants/links";
import { ENTERPRISE_PLAN, PRICING_PLANS } from "../../constants/pricing";
import { PricingPlanCard } from "../pricing/PricingPlanCard";
import { Icon } from "../shared/Icon";
import { LandingSectionHeading } from "./LandingSectionHeading";

/**
 * The plans on the landing page: the same rail as /pricing, with plain links (the landing page is
 * prerendered and has no session), and the way to the full comparison and FAQ.
 */
export function LandingPricingSection() {
  return (
    <section className="section" id="pricing" aria-labelledby="pricing-section-title">
      <div className="section-drawing">
        <LandingSectionHeading id="pricing-section-title" kicker="Pricing">
          Free to self-host. <strong>Simple plans on Floodwall Cloud.</strong>
        </LandingSectionHeading>
        <ol className="plan-rail" aria-label="Plans">
          {PRICING_PLANS.map((plan) => (
            <PricingPlanCard key={plan.name} plan={plan} />
          ))}
        </ol>
        <div className="plan-enterprise">
          <div>
            <h3 className="tag">{ENTERPRISE_PLAN.name}</h3>
            <p className="card-copy">{ENTERPRISE_PLAN.copy}</p>
          </div>
          <a className="hero-link" href={PRICING_PATH}>
            Compare every plan <Icon icon={ArrowRight02Icon} />
          </a>
        </div>
      </div>
    </section>
  );
}
