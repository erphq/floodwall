import { Link } from "react-router";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleIntentSteps } from "../../components/console/ConsoleIntentSteps";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { CONSOLE_PATHS } from "../../constants/console";
import { deferral, describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { consoleGrow, consoleLink, consoleList, consoleMono, consoleRow, consoleSub } from "../../styles/classes";

export function HoldPage() {
  const { state } = usePlane();
  const held = state.intents.filter((i) => i.status === "held");

  return (
    <>
      <ConsolePageHeader
        title="Hold queue"
        description="Intents a policy deferred wait here for a person to decide. Nothing on hold reaches production."
      />

      <ConsolePanel title={`${held.length} on hold`} flush>
        {held.length === 0 ? (
          <ConsoleEmpty
            title="Nothing on hold"
            action={
              <Link className={consoleLink} to={CONSOLE_PATHS.intents}>
                See all intents
              </Link>
            }
          >
            When a policy defers an intent, it waits here until a person releases or expires it.
          </ConsoleEmpty>
        ) : (
          <ul className={consoleList}>
            {held.map((intent) => {
              const deferred = deferral(intent);
              return (
                <li key={intent.id} className={`${consoleRow} flex-wrap`}>
                  <span className={`${consoleGrow} min-w-60`}>
                    <Link className={consoleLink} to={CONSOLE_PATHS.intent(intent.id)}>
                      <span className={consoleMono}>#{intent.id}</span> {describeAction(intent.action)}
                    </Link>
                    <span className={consoleSub}>
                      {deferred ? (
                        <>
                          Deferred by <code className="text-ink">{deferred.policy}</code>: {deferred.reason}
                        </>
                      ) : (
                        "Deferred"
                      )}
                    </span>
                    <span className={consoleSub}>
                      {intent.agent} · {intent.priority} priority · {intent.blast} blast radius · submitted at tick{" "}
                      {intent.submittedAt}
                    </span>
                  </span>
                  <ConsoleIntentSteps intent={intent} />
                </li>
              );
            })}
          </ul>
        )}
      </ConsolePanel>

      <ConsolePanel title="Release or expire">
        <dl className="grid gap-4 text-sm leading-normal sm:grid-cols-2">
          <div className="grid gap-1">
            <dt className="font-medium text-ink">Release</dt>
            <dd className="text-muted">
              Waives the intent's deferrals and sends it back through the gate on the next tick (in this demo, straight
              away). It is admitted unless a policy rejects it; rejections still apply.
            </dd>
          </div>
          <div className="grid gap-1">
            <dt className="font-medium text-ink">Expire</dt>
            <dd className="text-muted">
              Drops the intent without running it and records the expiry on the ledger, with who expired it.
            </dd>
          </div>
        </dl>
      </ConsolePanel>
    </>
  );
}
