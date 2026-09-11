"use client";

import { useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type TabItem = {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
};

/**
 * Arrow keys move between tabs and Home/End jump to the ends, which is what a
 * screen reader user expects from a tablist.
 */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === active);
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;

    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    listRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`${baseId}-tab-${target.id}`)}`)
      ?.focus();
  };

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div
        ref={listRef}
        role="tablist"
        aria-label="Kit sections"
        onKeyDown={onKeyDown}
        className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0"
      >
        {tabs.map((tab) => {
          const selected = tab.id === current?.id;
          return (
            <button
              key={tab.id}
              id={`${baseId}-tab-${tab.id}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              className={cn(
                "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
                selected
                  ? "border-brand-600 font-medium text-brand-700"
                  : "border-transparent text-zinc-600 hover:text-zinc-900",
              )}
            >
              {tab.label}
              {typeof tab.count === "number" ? (
                <span className="ml-1.5 text-xs text-muted">{tab.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {current ? (
        <div
          id={`${baseId}-panel-${current.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${current.id}`}
          tabIndex={0}
          className="pt-5 focus:outline-none"
        >
          {current.content}
        </div>
      ) : null}
    </div>
  );
}
