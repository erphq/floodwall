import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { MOCK_ALLOWLIST, MOCK_POLICIES } from "../../constants/console-mock";
import { POLICY_SOURCE, POLICY_SOURCE_PATH, POLICY_SOURCE_URL } from "../../constants/console-pages";
import { cx } from "../../helpers/cx";
import { policyActivity } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { consoleGrow, consoleLink, consoleList, consoleMono, consoleRow, consoleSub } from "../../styles/classes";
import type { Verdict } from "../../types";

const VERDICTS: Verdict[] = ["admit", "defer", "reject"];

const COMBINE_STEPS: { verdict: Verdict; text: string }[] = [
  { verdict: "reject", text: "If any policy rejects, the intent is rejected. No other verdict can override it." },
  { verdict: "defer", text: "Otherwise, if any policy defers, the intent goes to the hold queue for a person to decide." },
  { verdict: "admit", text: "Otherwise every policy admitted it, and the intent is admitted to run." },
];

export function PoliciesPage() {
  const { state } = usePlane();
  const activity = policyActivity(state.intents);
  const gated = state.intents.filter((i) => i.verdicts).length;

  return (
    <>
      <ConsolePageHeader
        title="Policies"
        description="Every intent runs through each policy below; their verdicts combine into one."
      />

      <ConsolePanel title="Policy stack" flush action={`Across ${gated} gated intents`}>
        <ul className={consoleList}>
          {MOCK_POLICIES.map((p) => {
            const counts = activity[p.name] ?? { admit: 0, defer: 0, reject: 0 };
            return (
              <li key={p.name} className={cx(consoleRow, "flex-wrap")}>
                <span className={cx(consoleGrow, "min-w-60")}>
                  <code className="text-ink">{p.name}</code>
                  <span className={consoleSub}>{p.rule}</span>
                </span>
                <dl className="flex flex-wrap items-center gap-x-4 gap-y-1" aria-label={`${p.name} activity`}>
                  {VERDICTS.map((v) => (
                    <div key={v} className="flex items-center gap-1.5">
                      <dt>
                        <ConsoleBadge value={v} />
                      </dt>
                      <dd className={cx(consoleMono, "w-6 text-ink")}>{counts[v]}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      </ConsolePanel>

      <ConsolePanel title="How verdicts combine" action="Deny-overrides">
        <ol className="grid gap-3 text-sm leading-normal">
          {COMBINE_STEPS.map(({ verdict, text }) => (
            <li key={verdict} className="flex items-start gap-3">
              <ConsoleBadge value={verdict} />
              <span className="pt-0.5 text-ink-soft">{text}</span>
            </li>
          ))}
        </ol>
      </ConsolePanel>

      <ConsolePanel title="Resource allowlist">
        <ul className="flex flex-wrap gap-2">
          {MOCK_ALLOWLIST.map((r) => (
            <li key={r} className="border border-line px-2.5 py-1 font-mono text-[13px] text-ink">
              {r}
            </li>
          ))}
        </ul>
      </ConsolePanel>

      <ConsolePanel
        title="Rules file"
        flush
        action={
          <a className={consoleLink} href={POLICY_SOURCE_URL} target="_blank" rel="noreferrer">
            {POLICY_SOURCE_PATH}
          </a>
        }
      >
        <p className="border-b border-line px-5 py-3 text-sm leading-normal text-muted console-narrow:px-4">
          The console shows policies but doesn't edit them. To change one, edit the rules file in your repo.
        </p>
        <pre className="overflow-x-auto bg-subtle px-5 py-4 font-mono text-[13px] leading-relaxed text-ink console-narrow:px-4">
          <code>{POLICY_SOURCE}</code>
        </pre>
      </ConsolePanel>
    </>
  );
}
