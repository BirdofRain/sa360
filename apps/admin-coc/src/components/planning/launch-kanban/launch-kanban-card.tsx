"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertOctagon, Calendar, GitBranch, GripVertical, User2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { localeFormatCalendarDayFromIso } from "@/lib/date-local";

import type { KanbanPriority, LaunchKanbanCard as KanbanCardModel } from "./launch-kanban-types";
import { isCardDone, isDueOverdue, isDueSoon } from "./launch-kanban-metrics";

const PRIORITY_TONE: Record<KanbanPriority, string> = {
  P0: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200",
  P1: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  P2: "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200",
};

function formatDueDate(iso: string | null | undefined): string | null {
  return localeFormatCalendarDayFromIso(iso, { month: "short", day: "numeric" });
}

export function LaunchKanbanCard({
  card,
  density,
  onSelect,
}: {
  card: KanbanCardModel;
  density: "compact" | "comfortable";
  onSelect: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : undefined,
  };

  const compact = density === "compact";
  const due = formatDueDate(card.dueDate);
  const depCount = card.dependencyCount ?? card.dependencies?.length ?? 0;
  const priority = (card.priority as KanbanPriority) ?? "P2";
  const now = new Date();
  const done = isCardDone(card);
  const overdue = isDueOverdue(card, now);
  const soon = isDueSoon(card, now);

  return (
    <li
      ref={setNodeRef}
      style={style}
      data-card-id={card.id}
      data-status={card.status}
      className={cn(
        "group/card relative rounded-lg border bg-white text-left shadow-[0_1px_0_rgba(15,23,42,0.03)] transition-colors",
        done
          ? "border-slate-200/80 bg-slate-50/90 opacity-[0.92]"
          : "border-slate-200 hover:border-slate-300 hover:bg-slate-50",
        !done && overdue && "border-red-200 bg-red-50/35",
        !done && soon && !overdue && "border-amber-200/90 bg-amber-50/25",
        isDragging && "z-10 ring-2 ring-slate-400/40"
      )}
    >
      <div className={cn("flex items-start gap-2", compact ? "p-3" : "p-3.5")}>
        <button
          type="button"
          aria-label="Drag to reorder"
          className="mt-0.5 grid size-5 shrink-0 cursor-grab touch-none place-items-center rounded text-slate-300 hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
          data-drag-handle
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => onSelect(card.id)}
          className="min-w-0 flex-1 cursor-pointer text-left focus:outline-none"
          aria-label={`Open ${card.title}`}
        >
          <div className="flex items-start justify-between gap-2">
            <h4
              className={cn(
                "line-clamp-2 text-[13.5px] font-medium leading-snug",
                done ? "text-slate-500 line-through decoration-slate-300" : "text-slate-900"
              )}
            >
              {card.title}
            </h4>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide",
                PRIORITY_TONE[priority] ?? PRIORITY_TONE.P2
              )}
            >
              {priority}
            </span>
          </div>

          {!compact ? (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500">{card.description}</p>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
              {card.workstream}
            </span>
            {card.blocked ? (
              <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700 ring-1 ring-inset ring-red-200">
                <AlertOctagon className="size-3" aria-hidden />
                Blocked
              </span>
            ) : null}
            {depCount > 0 ? (
              <span
                className="inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-slate-500 ring-1 ring-inset ring-slate-200"
                title={`${depCount} dependency${depCount === 1 ? "" : "ies"}`}
              >
                <GitBranch className="size-3" aria-hidden />
                {depCount}
              </span>
            ) : null}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1 truncate">
              <User2 className="size-3 text-slate-400" aria-hidden />
              <span className="truncate">{card.owner ?? "Unassigned"}</span>
            </span>
            {due ? (
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 font-medium",
                  done && "text-slate-400",
                  !done && overdue && "bg-red-100/80 text-red-800",
                  !done && soon && !overdue && "bg-amber-100/80 text-amber-900",
                  !done && !overdue && !soon && "text-slate-500"
                )}
              >
                <Calendar className="size-3 opacity-80" aria-hidden />
                {due}
                {!done && overdue ? <span className="sr-only">(overdue)</span> : null}
                {!done && soon && !overdue ? <span className="sr-only">(due soon)</span> : null}
              </span>
            ) : null}
          </div>
        </button>
      </div>
    </li>
  );
}
