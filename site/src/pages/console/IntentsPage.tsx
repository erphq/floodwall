import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ConsoleBadge } from "../../components/console/ConsoleBadge";
import { ConsoleButton } from "../../components/console/ConsoleButton";
import { ConsoleEmpty } from "../../components/console/ConsoleEmpty";
import { ConsoleFilterBar } from "../../components/console/ConsoleFilterBar";
import { ConsoleOpenIntent } from "../../components/console/ConsoleOpenIntent";
import { ConsolePageHeader } from "../../components/console/ConsolePageHeader";
import { ConsolePanel } from "../../components/console/ConsolePanel";
import { ConsoleTable } from "../../components/console/ConsoleTable";
import { Input } from "../../components/ui/input";
import { TableCell, TableRow } from "../../components/ui/table";
import { CONSOLE_PATHS, INTENT_COLUMNS, INTENT_FILTERS } from "../../constants/console";
import { describeAction } from "../../helpers/gate";
import { usePlane } from "../../hooks/usePlane";
import { consoleLink, consoleMono, consoleWideOnly } from "../../styles/classes";

export function IntentsPage() {
  const { state } = usePlane();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const active = INTENT_FILTERS.find((f) => f.key === params.get("status")) ?? INTENT_FILTERS[0];
  const needle = query.trim().toLowerCase();
  const inStatus = state.intents.filter((i) => !active.statuses || active.statuses.includes(i.status));
  const intents = inStatus
    .filter((i) => !needle || i.agent.toLowerCase().includes(needle) || i.action.resource.toLowerCase().includes(needle))
    .sort((a, b) => b.id - a.id);

  return (
    <>
      <ConsolePageHeader
        title="Intents"
        description="Every change an agent has asked to make."
        actions={<ConsoleButton to={CONSOLE_PATHS.newIntent}>Submit intent</ConsoleButton>}
      />

      <ConsolePanel flush>
        <ConsoleFilterBar
          label="Filter by status"
          filters={INTENT_FILTERS}
          value={active.key}
          onChange={(key) => setParams(key === "all" ? {} : { status: key })}
        >
          <Input
            type="search"
            aria-label="Search intents by agent or resource"
            placeholder="Search agent or resource"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 w-64 max-w-full console-narrow:w-full"
          />
        </ConsoleFilterBar>
        {intents.length === 0 ? (
          needle && inStatus.length > 0 ? (
            <ConsoleEmpty
              title={`Nothing matches "${query.trim()}"`}
              action={
                <button type="button" className={consoleLink} onClick={() => setQuery("")}>
                  Clear search
                </button>
              }
            >
              The search looks at each intent's agent and resource. Try part of a name, like "web" or "deployer".
            </ConsoleEmpty>
          ) : (
            <ConsoleEmpty
              title={`No ${active.label.toLowerCase()} intents`}
              action={
                <Link className={consoleLink} to={CONSOLE_PATHS.intents} onClick={() => setQuery("")}>
                  Show all intents
                </Link>
              }
            >
              Intents move between these views as the gate rules on them and you report outcomes.
            </ConsoleEmpty>
          )
        ) : (
          <ConsoleTable columns={INTENT_COLUMNS}>
            {intents.map((intent) => (
              <TableRow key={intent.id} className="group/row">
                {/* w-0: the column shrinks to its content instead of taking a share of the spare width. */}
                <TableCell className="w-0">
                  <span className="flex items-center gap-2">
                    <span className={consoleMono}>#{intent.id}</span>
                    {/* With a hovering pointer, hidden until the row is hovered or holds keyboard focus;
                        on touch, always shown, since there is no hover to reveal it. */}
                    <ConsoleOpenIntent
                      id={intent.id}
                      className="transition-opacity duration-150 [@media(hover:hover)]:opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100"
                    >
                      Open
                    </ConsoleOpenIntent>
                  </span>
                </TableCell>
                <TableCell className="font-medium">{intent.agent}</TableCell>
                <TableCell className="text-ink-soft">{describeAction(intent.action)}</TableCell>
                <TableCell className={consoleWideOnly}>{intent.priority}</TableCell>
                <TableCell className={consoleWideOnly}>{intent.blast}</TableCell>
                <TableCell>
                  <ConsoleBadge value={intent.status} />
                </TableCell>
              </TableRow>
            ))}
          </ConsoleTable>
        )}
      </ConsolePanel>
    </>
  );
}
