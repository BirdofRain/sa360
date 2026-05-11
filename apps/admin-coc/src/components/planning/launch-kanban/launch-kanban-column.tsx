"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { cn } from "@/lib/utils";

import { LaunchKanbanCard } from "./launch-kanban-card";
import type { LaunchKanbanCard as KanbanCardModel } from "./launch-kanban-types";

type LaunchKanbanColumnProps = {
  /** Stable identifier used by dnd-kit to address this column. Usually the status string. */
  columnId: string;
  title: string;
  count: number;
  cards: KanbanCardModel[];
  density: "compact" | "comfortable";
  onSelectCard: (id: string) => void;
  headerAccent?: string;
  emptyHint?: ReactNode;
};

export function LaunchKanbanColumn({
  columnId,
  title,
  count,
  cards,
  density,
  onSelectCard,
  headerAccent,
  emptyHint,
}: LaunchKanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${columnId}` });
  const items = cards.map((c) => c.id);

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-slate-50/60 transition-colors",
        isOver && "border-slate-400 bg-slate-100"
      )}
      aria-label={`${title} column`}
      data-kanban-column={columnId}
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
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

      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <ul className="flex min-h-[120px] flex-1 flex-col gap-2 overflow-y-auto p-2">
          {cards.length === 0 ? (
            <li className="select-none px-1 py-6 text-center text-[11px] text-slate-400">
              {emptyHint ?? "No cards here yet — drop one in."}
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
      </SortableContext>
    </section>
  );
}
