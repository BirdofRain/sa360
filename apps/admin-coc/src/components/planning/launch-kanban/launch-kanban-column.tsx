"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { LaunchKanbanCard } from "./launch-kanban-card";
import type { LaunchKanbanCard as KanbanCardModel } from "./launch-kanban-types";

type LaunchKanbanColumnProps = {
  title: string;
  count: number;
  cards: KanbanCardModel[];
  density: "compact" | "comfortable";
  onSelectCard: (id: string) => void;
  headerAccent?: string;
  emptyHint?: ReactNode;
};

export function LaunchKanbanColumn({
  title,
  count,
  cards,
  density,
  onSelectCard,
  headerAccent,
  emptyHint,
}: LaunchKanbanColumnProps) {
  return (
    <section
      className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-slate-50/60"
      aria-label={`${title} column`}
      data-kanban-column={title}
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={cn("size-1.5 shrink-0 rounded-full", headerAccent ?? "bg-slate-400")}
            aria-hidden
          />
          <h3 className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-700">
            {title}
          </h3>
        </div>
        <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-200">
          {count}
        </span>
      </header>

      <ul className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2">
        {cards.length === 0 ? (
          <li className="select-none px-1 py-6 text-center text-[11px] text-slate-400">
            {emptyHint ?? "No cards match the current filters."}
          </li>
        ) : (
          cards.map((card) => (
            <LaunchKanbanCard
              key={card.id}
              card={card}
              density={density}
              onSelect={onSelectCard}
            />
          ))
        )}
      </ul>
    </section>
  );
}
