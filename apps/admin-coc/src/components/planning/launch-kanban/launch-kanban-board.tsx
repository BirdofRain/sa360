"use client";

import { useMemo, useState } from "react";

import { LaunchKanbanColumn } from "./launch-kanban-column";
import { LaunchKanbanDetailSheet } from "./launch-kanban-detail-sheet";
import { LaunchKanbanFilters } from "./launch-kanban-filters";
import {
  DEFAULT_LAUNCH_KANBAN_FILTERS,
  LAUNCH_KANBAN_COLUMNS,
  LAUNCH_KANBAN_PRIORITIES,
  type KanbanPriority,
  type KanbanStatus,
  type KanbanWorkstream,
  type LaunchKanbanCard,
  type LaunchKanbanFilters as Filters,
} from "./launch-kanban-types";

/** Soft accent dot per column header. Kept synced with column order. */
const COLUMN_ACCENT: Record<KanbanStatus, string> = {
  BCKLG: "bg-slate-400",
  SPRINT: "bg-sky-500",
  "TO DO": "bg-indigo-500",
  DOING: "bg-amber-500",
  VERIFY: "bg-violet-500",
  DONE: "bg-emerald-500",
};

function priorityRank(p: KanbanPriority): number {
  return LAUNCH_KANBAN_PRIORITIES.indexOf(p);
}

function sortCards(cards: LaunchKanbanCard[], sort: Filters["sort"]): LaunchKanbanCard[] {
  if (sort === "manual") return cards;
  const copy = [...cards];
  switch (sort) {
    case "priority":
      copy.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
      break;
    case "due_date":
      copy.sort((a, b) => {
        const ax = a.dueDate ? Date.parse(a.dueDate) : Number.POSITIVE_INFINITY;
        const bx = b.dueDate ? Date.parse(b.dueDate) : Number.POSITIVE_INFINITY;
        return ax - bx;
      });
      break;
    case "workstream":
      copy.sort((a, b) => a.workstream.localeCompare(b.workstream));
      break;
    case "recently_updated":
      copy.sort((a, b) => {
        const ax = a.updatedAt ? Date.parse(a.updatedAt) : 0;
        const bx = b.updatedAt ? Date.parse(b.updatedAt) : 0;
        return bx - ax;
      });
      break;
  }
  return copy;
}

function matchesFilters(card: LaunchKanbanCard, filters: Filters): boolean {
  if (filters.p0Only && card.priority !== "P0") return false;
  if (filters.blockedOnly && !card.blocked) return false;
  if (filters.betaMvpOnly && !card.betaMvp) return false;
  if (filters.workstream !== "ALL" && card.workstream !== filters.workstream) return false;
  if (filters.priority !== "ALL" && card.priority !== filters.priority) return false;
  if (filters.status !== "ALL" && card.status !== filters.status) return false;
  const q = filters.search.trim().toLowerCase();
  if (q) {
    const hay = [
      card.title,
      card.description,
      card.owner ?? "",
      card.workstream,
      card.id,
    ]
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function LaunchKanbanBoard({ seed }: { seed: LaunchKanbanCard[] }) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_LAUNCH_KANBAN_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  const cardsById = useMemo(() => {
    const m = new Map<string, LaunchKanbanCard>();
    for (const c of seed) m.set(c.id, c);
    return m;
  }, [seed]);

  const filtered = useMemo(
    () => seed.filter((c) => matchesFilters(c, filters)),
    [seed, filters]
  );

  const groupedByStatus = useMemo(() => {
    const groups: Record<KanbanStatus, LaunchKanbanCard[]> = {
      BCKLG: [],
      SPRINT: [],
      "TO DO": [],
      DOING: [],
      VERIFY: [],
      DONE: [],
    };
    for (const c of filtered) groups[c.status].push(c);
    for (const k of LAUNCH_KANBAN_COLUMNS) {
      groups[k] = sortCards(groups[k], filters.sort);
    }
    return groups;
  }, [filtered, filters.sort]);

  const groupedByWorkstream = useMemo(() => {
    const groups = new Map<KanbanWorkstream, LaunchKanbanCard[]>();
    for (const c of filtered) {
      const arr = groups.get(c.workstream) ?? [];
      arr.push(c);
      groups.set(c.workstream, arr);
    }
    for (const [k, arr] of groups) groups.set(k, sortCards(arr, filters.sort));
    return groups;
  }, [filtered, filters.sort]);

  function openCard(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  const selectedCard = selectedId ? cardsById.get(selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      <LaunchKanbanFilters
        filters={filters}
        setFilters={setFilters}
        totalCards={seed.length}
        visibleCards={filtered.length}
        onBulkEdit={() => {
          /* visual-only placeholder per spec */
        }}
      />

      {filters.groupBy === "status" ? (
        <div className="flex gap-3.5 overflow-x-auto pb-2 xl:grid xl:grid-cols-6 xl:gap-4 xl:overflow-x-visible">
          {LAUNCH_KANBAN_COLUMNS.map((status) => (
            <div
              key={status}
              className="w-[260px] shrink-0 xl:w-auto xl:min-w-0"
            >
              <div className="h-[calc(100vh-260px)] min-h-[420px]">
                <LaunchKanbanColumn
                  title={status}
                  count={groupedByStatus[status].length}
                  cards={groupedByStatus[status]}
                  density={filters.density}
                  onSelectCard={openCard}
                  headerAccent={COLUMN_ACCENT[status]}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...groupedByWorkstream.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([workstream, cards]) => (
              <div key={workstream} className="h-[420px]">
                <LaunchKanbanColumn
                  title={workstream}
                  count={cards.length}
                  cards={cards}
                  density={filters.density}
                  onSelectCard={openCard}
                  emptyHint="No matching cards in this workstream."
                />
              </div>
            ))}
        </div>
      )}

      <LaunchKanbanDetailSheet
        card={selectedCard}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        cardsById={cardsById}
      />
    </div>
  );
}
