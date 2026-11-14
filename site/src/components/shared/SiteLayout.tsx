import { Outlet, useLocation } from "react-router";
import { PRICING_PATH } from "../../constants/links";
import { useScrollToHash } from "../../hooks/useScrollToHash";
import { useSiteDocument } from "../../hooks/useSiteDocument";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

/**
 * The shell around /pricing and the legal pages: the landing page's header, deck and footer, in its
 * light and dark themes. The header marks Pricing on /pricing, and nothing on the legal pages.
 */
export function SiteLayout() {
  useScrollToHash();
  useSiteDocument();
  const { pathname } = useLocation();

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <SiteHeader onLanding={false} page={pathname === PRICING_PATH ? "pricing" : undefined} />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <SiteFooter onLanding={false} />
    </>
  );
}
