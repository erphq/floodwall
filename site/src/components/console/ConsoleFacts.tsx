import type { ReactNode } from "react";
import { cx } from "../../helpers/cx";
import { monoLabel } from "../../styles/classes";

type ConsoleFactsProps = {
  facts: { label: string; value: ReactNode }[];
  /** Names the strip for assistive technology when no heading does. */
  label?: string;
  /** Grid columns in place of the default auto-filled 160px cells, for facts of uneven width. */
  columns?: string;
};

/**
 * Facts in one ruled frame, the Overview figures' title-block cells. Each cell draws its own right
 * and bottom rule and the frame clips the outermost, so a short last row leaves no gap.
 */
export function ConsoleFacts({ facts, label, columns }: ConsoleFactsProps) {
  return (
    <div className="overflow-hidden border border-line bg-surface">
      <dl
        aria-label={label}
        className={cx("-me-px -mb-px grid", columns ?? "grid-cols-[repeat(auto-fit,minmax(160px,1fr))]")}
      >
        {facts.map(({ label: name, value }) => (
          <div key={name} className="flex min-w-0 flex-col gap-2 border-e border-b border-line px-5 py-4 console-narrow:px-4">
            <dt className={monoLabel}>{name}</dt>
            <dd className="min-w-0 text-[15px] font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
