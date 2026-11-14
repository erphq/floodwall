import { LandingSectionHeading } from "../components/landing/LandingSectionHeading";
import { LEGAL_DOCUMENTS, LEGAL_UPDATED, type LegalKey } from "../constants/legal";

/**
 * One of the Terms, Privacy and Refund pages, in the landing page's frame: its heading band, then
 * numbered sections of plain paragraphs. Linked from the footer of every site page.
 */
export function LegalPage({ page }: { page: LegalKey }) {
  const doc = LEGAL_DOCUMENTS[page];
  return (
    <section className="section legal" aria-labelledby="legal-title">
      <title>{`${doc.name} · Floodwall`}</title>
      <meta name="description" content={doc.description} />
      <div className="section-drawing">
        <LandingSectionHeading id="legal-title" kicker={doc.name} level={1}>
          {doc.title[0]} <strong>{doc.title[1]}</strong>
        </LandingSectionHeading>
        <div className="legal-body">
          <p className="legal-updated">Last updated {LEGAL_UPDATED}</p>
          <p className="legal-intro">{doc.intro}</p>
          <ol className="legal-sections">
            {doc.sections.map(({ heading, paragraphs, items }) => (
              <li key={heading}>
                <h2 className="legal-heading">{heading}</h2>
                {items && (
                  <ul className="legal-list">
                    {items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
                {paragraphs?.map((text) => (
                  <p key={text}>{text}</p>
                ))}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
