import { PricingCompareSection } from "../components/pricing/PricingCompareSection";
import { PricingFaqSection } from "../components/pricing/PricingFaqSection";
import { PricingHero } from "../components/pricing/PricingHero";
import { PricingIncludedSection } from "../components/pricing/PricingIncludedSection";
import { PricingProgramsSection } from "../components/pricing/PricingProgramsSection";

/** Floodwall's plans: free to self-host, a base price plus overage on Floodwall Cloud. */
export function PricingPage() {
  return (
    <>
      <PricingHero />
      <PricingIncludedSection />
      <PricingCompareSection />
      <PricingProgramsSection />
      <PricingFaqSection />
    </>
  );
}
