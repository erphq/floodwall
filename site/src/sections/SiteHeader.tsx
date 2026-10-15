import { NAV_SECTIONS, NAV_SECTION_IDS } from "../content";
import { useActiveSection, useIsScrolled } from "../hooks";
import { BrandMark } from "../components/BrandMark";

export function SiteHeader() {
  const scrolled = useIsScrolled();
  const active = useActiveSection(NAV_SECTION_IDS);

  return (
    <header className="site-header" data-scrolled={scrolled}>
      <nav className="nav-bar page-width" aria-label="Primary">
        <a className="logo" href="#home" aria-label="Floodwall home">
          <BrandMark />
          <span>
            Floodwall<sup>&reg;</sup>
          </span>
        </a>
        <div className="nav-links">
          {NAV_SECTIONS.map(({ id, label }) => (
            <a key={id} href={`#${id}`} aria-current={active === id ? "location" : undefined}>
              {label}
            </a>
          ))}
        </div>
        <a className="button button-sm" href="#waitlist">
          Join the waitlist
        </a>
      </nav>
    </header>
  );
}
