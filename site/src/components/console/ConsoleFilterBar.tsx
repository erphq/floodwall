import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

type ConsoleFilterBarProps = {
  /** Names the tab list, e.g. "Filter by status". */
  label: string;
  filters: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  /** More controls beside the tabs, such as a search box. */
  children?: ReactNode;
};

/** The ruled band atop a flush table panel: a row of filter tabs, and any other controls after it. */
export function ConsoleFilterBar({ label, filters, value, onChange, children }: ConsoleFilterBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3 console-narrow:px-4">
      <Tabs value={value} onValueChange={(key) => onChange(String(key))} className="min-w-0 max-w-full">
        {/* 36px, like the console's buttons; shadcn's default is 32px. */}
        <TabsList aria-label={label} className="scroll-fade-x max-w-full overflow-x-auto group-data-horizontal/tabs:h-9">
          {filters.map((f) => (
            <TabsTrigger key={f.key} value={f.key} className="px-3">
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  );
}
