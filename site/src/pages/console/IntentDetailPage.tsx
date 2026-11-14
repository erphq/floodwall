import { Link, useParams } from "react-router";
import { ConsoleBackLink } from "../../components/console/ConsoleBackLink";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleFacts } from "../../components/console/ConsoleFacts";
import { ConsoleIntentSteps } from "../../components/console/ConsoleIntentSteps";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { CONSOLE_PATHS } from "../../constants/console";
import { describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleGrow, consoleLink, consoleList, consoleMono, consoleRow, monoLabel } from "../../styles/classes";
import type { Action } from "../../types/console";

/** What an action's detail means for its kind: a manifest name for apply, a replica count for scale. */
const DETAIL_LABEL: Partial<Record<Action["kind"], string>> = { apply: "Manifest", scale: "Replicas" };

export function IntentDetailPage() {
  const { id } = useParams();
  const { state } = usePlane();
  const intent = state.intents.find((i) => String(i.id) === id);

  if (!intent) {
    return (
      <>
        <ConsoleBackLink to={CONSOLE_PATHS.intents}>Intents</ConsoleBackLink>
        <ConsolePageHeader title="Intent not found" description={`No intent has the id ${id}. It may be from another plane.`} />
        <ConsolePanel>
          <Link className={consoleLink} to={CONSOLE_PATHS.intents}>
            See all intents
          </Link>
        </ConsolePanel>
      </>
    );
  }

  const history = state.ledger.filter((r) => r.intentId === intent.id);
  const facts = [
    { label: "Status", value: <ConsoleBadge value={intent.status} /> },
    { label: "Agent", value: intent.agent },
    { label: "Priority", value: intent.priority },
    { label: "Blast radius", value: intent.blast },
    { label: "Submitted", value: `tick ${intent.submittedAt}` },
    ...(intent.releasedBy ? [{ label: "Released by", value: intent.releasedBy }] : []),
  ];
  const detailLabel = DETAIL_LABEL[intent.action.kind];
  const action = [
    { label: "Kind", value: intent.action.kind },
    { label: "Resource", value: intent.action.resource },
    ...(detailLabel ? [{ label: detailLabel, value: intent.action.detail ?? "not set" }] : []),
  ];

  return (
    <>
      <ConsoleBackLink to={CONSOLE_PATHS.intents}>Intents</ConsoleBackLink>
      <ConsolePageHeader
        title={`Intent #${intent.id}`}
        description={describeAction(intent.action)}
        actions={<ConsoleIntentSteps intent={intent} />}
      />

      <ConsoleFacts facts={facts} />

      <ConsolePanel title="Action" flush>
        <dl className="divide-y divide-line">
          {action.map(({ label, value }) => (
            <div key={label} className={consoleRow}>
              <dt className={cx(monoLabel, "w-28 shrink-0")}>{label}</dt>
              <dd className={cx(consoleGrow, consoleMono, "text-ink")}>{value}</dd>
            </div>
          ))}
        </dl>
      </ConsolePanel>

      <ConsolePanel title="Gate verdicts" flush action="Harshest verdict wins">
        {intent.verdicts ? (
          <ul className={consoleList}>
            {intent.verdicts.map((v) => (
              <li key={v.policy} className={consoleRow}>
                <span className={consoleGrow}>
                  <code className="text-ink">{v.policy}</code>
                  {v.reason && <span className="text-muted"> · {v.reason}</span>}
                </span>
                <ConsoleBadge value={v.verdict} />
              </li>
            ))}
          </ul>
        ) : (
          <ConsoleEmpty title="Not gated yet">Run a tick to send it through the gate.</ConsoleEmpty>
        )}
      </ConsolePanel>

      <ConsolePanel
        title="Timeline"
        flush
        action={
          <Link className={consoleLink} to={CONSOLE_PATHS.ledger}>
            Open ledger
          </Link>
        }
      >
        <ol className={consoleList}>
          <li className={consoleRow}>
            <span className={cx(consoleMono, "w-10 shrink-0 text-muted")} aria-hidden="true" />
            <span className={consoleGrow}>
              <span className="font-medium text-ink">Submitted at tick {intent.submittedAt}</span>
              <span className="text-muted"> · by {intent.agent}</span>
            </span>
          </li>
          {history.map((r) => (
            <li key={r.seq} className={consoleRow}>
              <span className={cx(consoleMono, "w-10 shrink-0 text-muted")}>#{r.seq}</span>
              <span className={consoleGrow}>
                <span className="font-medium text-ink">{TIMELINE_LABEL[r.kind]}</span>
                <span className="text-muted"> · {r.summary}</span>
              </span>
              {r.verdict && <ConsoleBadge value={r.verdict} />}
              <span className={cx(consoleMono, "text-muted")}>tick {r.tick}</span>
            </li>
          ))}
          {history.length === 0 && (
            <li className={cx(consoleRow, "text-sm text-muted")}>
              <span className="w-10 shrink-0" aria-hidden="true" />
              <span className={consoleGrow}>Nothing on the ledger yet. It records this intent once the gate rules on it.</span>
            </li>
          )}
        </ol>
      </ConsolePanel>
    </>
  );
}

const TIMELINE_LABEL = { decision: "Gate decision", release: "Released", expiry: "Expired", outcome: "Outcome reported" } as const;
