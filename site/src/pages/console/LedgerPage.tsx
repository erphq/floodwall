import { Fragment, useState } from "react";
import { Alert02Icon, ArrowDown01Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { Link, useSearchParams } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleFacts } from "../../components/console/ConsoleFacts";
import { ConsoleFilterBar } from "../../components/console/ConsoleFilterBar";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { ConsoleTable } from "../../components/console/ConsoleTable";
import { Icon } from "../../components/shared/Icon";
import { TableCell, TableRow } from "../../components/ui/table";
import { CONSOLE_PATHS, LEDGER_COLUMNS } from "../../constants/console";
import { LEDGER_FILTERS } from "../../constants/console-pages";
import { chainIntact, shortDigest } from "../../helpers/ledger";
import { usePlane } from "../../hooks/usePlane";
import { cx } from "../../helpers/cx";
import { consoleLink, consoleMono, consoleTone, consoleWideOnly, monoLabel } from "../../styles/classes";

export function LedgerPage() {
  const { state } = usePlane();
  const [params, setParams] = useSearchParams();
  const [verified, setVerified] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const head = state.ledger.at(-1);
  const genesis = state.ledger.at(0);
  const intact = chainIntact(state.ledger);
  const active = LEDGER_FILTERS.find((f) => f.key === params.get("kind")) ?? LEDGER_FILTERS[0];
  const records = state.ledger.filter((r) => !active.kind || r.kind === active.kind).reverse();

  const summary = [
    { label: "Records", value: <span className={consoleMono}>{state.ledger.length}</span> },
    { label: "Head digest", value: head ? <Digest value={head.digest} /> : "none yet" },
    {
      label: "Genesis",
      value: genesis ? (
        <span className="text-ink-soft">
          Record #{genesis.seq} at tick {genesis.tick}, linked to <span className={consoleMono}>{shortDigest(genesis.prev)}</span>
        </span>
      ) : (
        "none yet"
      ),
    },
  ];

  return (
    <>
      <ConsolePageHeader
        title="Ledger"
        description="Every decision, release, expiry and outcome, each record linked to the digest of the one before it."
        actions={<ConsoleButton onClick={() => setVerified(state.ledger.length)}>Verify chain</ConsoleButton>}
      />

      {/* Mounted empty, so the result is announced when it arrives. The icon and the words carry it; the
          tone repeats it. */}
      <div role="status" className="empty:hidden">
        {verified !== null && (
          <p className={cx("flex items-center gap-2.5 border border-current/25 px-4 py-3 text-sm font-medium", consoleTone[intact ? "good" : "bad"])}>
            <Icon icon={intact ? CheckmarkCircle02Icon : Alert02Icon} size={18} />
            {intact ? `Chain intact: ${verified} records verified from genesis.` : "Chain broken: a record no longer matches its digest."}
          </p>
        )}
      </div>

      <ConsoleFacts label="Chain summary" facts={summary} columns="grid-cols-[minmax(7rem,0.6fr)_minmax(0,2fr)_minmax(0,1.4fr)] console-narrow:grid-cols-1" />

      <ConsolePanel flush>
        <ConsoleFilterBar
          label="Filter by record kind"
          filters={LEDGER_FILTERS}
          value={active.key}
          onChange={(key) => setParams(key === "all" ? {} : { kind: key })}
        />
        {records.length === 0 ? (
          <ConsoleEmpty
            title={`No ${active.label.toLowerCase()} yet`}
            action={
              <Link className={consoleLink} to={CONSOLE_PATHS.ledger}>
                Show all records
              </Link>
            }
          >
            {active.kind === "release" || active.kind === "expiry"
              ? "These are recorded when someone releases or expires an intent in the hold queue."
              : active.kind === "outcome"
                ? "These are recorded when an admitted intent is reported as succeeded or failed."
                : "Records appear here as the gate rules on intents."}
          </ConsoleEmpty>
        ) : (
          <ConsoleTable columns={LEDGER_COLUMNS}>
            {records.map((r) => {
              const expanded = open === r.seq;
              const detailId = `ledger-record-${r.seq}`;
              return (
                <Fragment key={r.seq}>
                  <TableRow className={expanded ? "border-b-0" : undefined}>
                    <TableCell className="w-0">
                      <button
                        type="button"
                        aria-expanded={expanded}
                        aria-controls={expanded ? detailId : undefined}
                        aria-label={`Record #${r.seq} details`}
                        onClick={() => setOpen(expanded ? null : r.seq)}
                        className="-mx-1.5 inline-flex h-8 items-center gap-1.5 px-1.5 text-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                      >
                        <Icon icon={ArrowDown01Icon} size={14} className={expanded ? "rotate-180" : undefined} />
                        <span className={consoleMono}>{r.seq}</span>
                      </button>
                    </TableCell>
                    <TableCell className={cx(consoleMono, consoleWideOnly)}>{r.tick}</TableCell>
                    <TableCell className={consoleMono}>
                      <Link to={CONSOLE_PATHS.intent(r.intentId)}>#{r.intentId}</Link>
                    </TableCell>
                    <TableCell>
                      {r.verdict ? <ConsoleBadge value={r.verdict} /> : <span className="font-mono text-[11px] text-muted">{r.kind}</span>}
                    </TableCell>
                    <TableCell className="text-ink-soft">{r.summary}</TableCell>
                    <TableCell className={cx(consoleMono, "text-muted")}>{shortDigest(r.digest)}</TableCell>
                  </TableRow>
                  {expanded && (
                    <TableRow id={detailId} className="hover:bg-transparent">
                      <TableCell colSpan={LEDGER_COLUMNS.length} className="h-auto! py-0! whitespace-normal">
                        <dl className="grid gap-3 border-t border-dashed border-line py-4">
                          <div className="grid gap-1">
                            <dt className={monoLabel}>Prev</dt>
                            <dd>
                              <Digest value={r.prev} />
                            </dd>
                          </div>
                          <div className="grid gap-1">
                            <dt className={monoLabel}>Digest</dt>
                            <dd>
                              <Digest value={r.digest} />
                            </dd>
                          </div>
                          <div className="grid gap-1">
                            <dt className={monoLabel}>Recorded</dt>
                            <dd className="text-ink-soft">
                              Tick {r.tick}, a {r.kind} on intent #{r.intentId} from {r.agent}
                            </dd>
                          </div>
                        </dl>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </ConsoleTable>
        )}
      </ConsolePanel>
    </>
  );
}

/** A full 64-character digest, breaking anywhere so it never widens the page. */
function Digest({ value }: { value: string }) {
  return <code className={cx(consoleMono, "block break-all text-ink")}>{value}</code>;
}
