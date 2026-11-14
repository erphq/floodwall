import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Link } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleIntentSteps } from "../../components/console/ConsoleIntentSteps";
import { ConsoleOpenIntent } from "../../components/console/ConsoleOpenIntent";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { ConsoleStats } from "../../components/console/ConsoleStats";
import { Icon } from "../../components/shared/Icon";
import { CONSOLE_PATHS, OVERVIEW_STATS } from "../../constants/console";
import { GETTING_STARTED } from "../../constants/console-pages";
import { REPO_URL } from "../../constants/links";
import { deferral, describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleGrow, consoleLink, consoleList, consoleMono, consoleRow, consoleSub } from "../../styles/classes";

export function OverviewPage() {
  const { state, dispatch } = usePlane();
  const hasQueued = state.intents.some((i) => i.status === "queued");
  const held = state.intents.filter((i) => i.status === "held");
  const recent = state.ledger.slice(-5).reverse();
  const tracked = GETTING_STARTED.filter((s) => s.done);
  const doneCount = tracked.filter((s) => s.done?.(state)).length;

  // Where each getting-started step is done from.
  const stepAction = [
    <Link key="submit" className={consoleLink} to={CONSOLE_PATHS.newIntent}>
      Submit intent
    </Link>,
    <button key="tick" type="button" className={cx(consoleLink, "disabled:text-muted disabled:no-underline")} onClick={() => dispatch({ type: "tick" })} disabled={!hasQueued}>
      Run tick
    </button>,
    <Link key="hold" className={consoleLink} to={CONSOLE_PATHS.hold}>
      Open hold queue
    </Link>,
    <Link key="ledger" className={consoleLink} to={CONSOLE_PATHS.ledger}>
      Open ledger
    </Link>,
  ];

  return (
    <>
      <ConsolePageHeader
        title="Overview"
        description={`Logical tick ${state.tick}. Run a tick to gate everything in the queue.`}
        actions={
          <>
            <ConsoleButton variant="secondary" to={CONSOLE_PATHS.newIntent}>
              Submit intent
            </ConsoleButton>
            <ConsoleButton onClick={() => dispatch({ type: "tick" })} disabled={!hasQueued}>
              Run tick
            </ConsoleButton>
          </>
        }
      />

      <ConsoleStats
        label="Plane state"
        stats={OVERVIEW_STATS.map(({ label, hint, value }) => ({ label, hint, value: value(state) }))}
      />

      {held.length > 0 && (
        <ConsolePanel
          title="Needs attention"
          flush
          action={
            <Link className={consoleLink} to={CONSOLE_PATHS.hold}>
              Open hold queue
            </Link>
          }
        >
          <ul className={consoleList}>
            {held.map((intent) => {
              const deferred = deferral(intent);
              return (
                <li key={intent.id} className={cx(consoleRow, "flex-wrap")}>
                  <span className={cx(consoleGrow, "min-w-60")}>
                    <Link className={consoleLink} to={CONSOLE_PATHS.intent(intent.id)}>
                      <span className={consoleMono}>#{intent.id}</span> {describeAction(intent.action)}
                    </Link>
                    <span className={consoleSub}>
                      {intent.agent} · on hold: {deferred?.reason ?? "deferred by a policy"}
                    </span>
                  </span>
                  <ConsoleIntentSteps intent={intent} />
                </li>
              );
            })}
          </ul>
        </ConsolePanel>
      )}

      <ConsolePanel
        title="Recent decisions"
        flush
        action={
          <Link className={consoleLink} to={CONSOLE_PATHS.ledger}>
            Open ledger
          </Link>
        }
      >
        {recent.length === 0 ? (
          <ConsoleEmpty title="Nothing recorded yet">Decisions appear here as the gate rules on intents.</ConsoleEmpty>
        ) : (
          <ul className={consoleList}>
            {recent.map((record) => (
              <li key={record.seq} className={consoleRow}>
                <span className={cx(consoleMono, "w-8 shrink-0 text-muted")}>#{record.seq}</span>
                <span className={consoleGrow}>
                  <span className="font-medium text-ink">{record.agent}</span>
                  <span className="text-muted"> · {record.summary}</span>
                </span>
                {record.verdict ? (
                  <ConsoleBadge value={record.verdict} />
                ) : (
                  <span className="font-mono text-[11px] text-muted">{record.kind}</span>
                )}
                {/* The decision's intent as a chip: the way into it from here. */}
                <ConsoleOpenIntent id={record.intentId}>
                  <span className={consoleMono}>#{record.intentId}</span>
                </ConsoleOpenIntent>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>

      <ConsolePanel title="Try the console" flush action={`${doneCount} of ${tracked.length} done`}>
        <ol className={consoleList}>
          {GETTING_STARTED.map((step, i) => {
            const done = step.done?.(state) ?? false;
            return (
              <li key={step.title} className={cx(consoleRow, "flex-wrap")}>
                <span
                  className={cx(
                    "flex size-7 shrink-0 items-center justify-center border font-mono text-[12px]",
                    done ? "border-ink bg-ink text-paper" : "border-line text-muted",
                  )}
                >
                  {done ? <Icon icon={CheckmarkCircle02Icon} size={16} /> : i + 1}
                </span>
                <span className={cx(consoleGrow, "min-w-52")}>
                  <span className={cx("font-medium", done ? "text-muted" : "text-ink")}>
                    {step.title}
                    {done && <span className="sr-only"> (done)</span>}
                  </span>
                  <span className={consoleSub}>{step.detail}</span>
                </span>
                <span className="text-sm">{stepAction[i]}</span>
              </li>
            );
          })}
        </ol>
        <p className="border-t border-line px-5 py-3 text-sm leading-normal text-muted console-narrow:px-4">
          This console runs on demo data and starts over when you reload. Floodwall itself is a Rust crate:{" "}
          <a className={consoleLink} href={REPO_URL} target="_blank" rel="noreferrer">
            use it in your own control plane
          </a>
          .
        </p>
      </ConsolePanel>
    </>
  );
}
