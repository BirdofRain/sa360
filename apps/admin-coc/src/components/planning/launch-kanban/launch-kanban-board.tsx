"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import {
  reorderLaunchKanbanBoardAction,
  updateLaunchKanbanCardAction,
} from "@/app/actions/launch-kanban";
import type { AdminKanbanCardUpdate } from "@/lib/admin-api/types";

import { LaunchKanbanColumn } from "./launch-kanban-column";
import { LaunchKanbanDetailSheet } from "./launch-kanban-detail-sheet";
import { LaunchKanbanFilters } from "./launch-kanban-filters";
import {
  DEFAULT_LAUNCH_KANBAN_FILTERS,
  LAUNCH_KANBAN_BOARD_KEY,
  LAUNCH_KANBAN_COLUMNS,
  LAUNCH_KANBAN_PRIORITIES,
  isBetaMvpCard,
  type KanbanStatus,
  type LaunchKanbanCard,
  type LaunchKanbanFilters as Filters,
  type SaveState,
} from "./launch-kanban-types";

const COLUMN_ACCENT: Record<KanbanStatus, string> = {
  BCKLG: "bg-slate-400",
  SPRINT: "bg-sky-500",
  "TO DO": "bg-indigo-500",
  DOING: "bg-amber-500",
  VERIFY: "bg-violet-500",
  DONE: "bg-emerald-500",
};

function priorityRank(p: string): number {
  const idx = (LAUNCH_KANBAN_PRIORITIES as readonly string[]).indexOf(p);
  return idx === -1 ? LAUNCH_KANBAN_PRIORITIES.length : idx;
}

function sortCards(cards: LaunchKanbanCard[], sort: Filters["sort"]): LaunchKanbanCard[] {
  if (sort === "manual") {
    return [...cards].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  const copy = [...cards];
  switch (sort) {
    case "priority":
      copy.sort(
        (a, b) =>
          priorityRank(a.priority) - priorityRank(b.priority) ||
          a.sortOrder - b.sortOrder
      );
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
  if (filters.betaMvpOnly && !isBetaMvpCard(card)) return false;
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

function parseColumnId(maybeId: string | number | null | undefined): string | null {
  if (typeof maybeId !== "string") return null;
  if (!maybeId.startsWith("column:")) return null;
  return maybeId.slice("column:".length);
}

/** Map of status → array of card ids in order; mirrors the visual layout for dnd. */
function groupCardIdsByStatus(cards: LaunchKanbanCard[]): Record<KanbanStatus, string[]> {
  const out: Record<KanbanStatus, string[]> = {
    BCKLG: [],
    SPRINT: [],
    "TO DO": [],
    DOING: [],
    VERIFY: [],
    DONE: [],
  };
  for (const status of LAUNCH_KANBAN_COLUMNS) {
    const list = cards
      .filter((c) => c.status === status)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    out[status] = list.map((c) => c.id);
  }
  return out;
}

export function LaunchKanbanBoard({
  initialCards,
  boardKey = LAUNCH_KANBAN_BOARD_KEY,
}: {
  initialCards: LaunchKanbanCard[];
  boardKey?: string;
}) {
  const [cards, setCards] = useState<LaunchKanbanCard[]>(initialCards);
  const [filters, setFilters] = useState<Filters>(DEFAULT_LAUNCH_KANBAN_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const lastFullSnapshot = useRef<LaunchKanbanCard[]>(initialCards);

  useEffect(() => {
    setCards(initialCards);
    lastFullSnapshot.current = initialCards;
  }, [initialCards]);

  const cardsById = useMemo(() => {
    const m = new Map<string, LaunchKanbanCard>();
    for (const c of cards) m.set(c.id, c);
    return m;
  }, [cards]);

  const filteredCards = useMemo(
    () => cards.filter((c) => matchesFilters(c, filters)),
    [cards, filters]
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
    for (const c of filteredCards) groups[c.status as KanbanStatus]?.push(c);
    for (const k of LAUNCH_KANBAN_COLUMNS) {
      groups[k] = sortCards(groups[k], filters.sort);
    }
    return groups;
  }, [filteredCards, filters.sort]);

  const groupedByWorkstream = useMemo(() => {
    const groups = new Map<string, LaunchKanbanCard[]>();
    for (const c of filteredCards) {
      const arr = groups.get(c.workstream) ?? [];
      arr.push(c);
      groups.set(c.workstream, arr);
    }
    for (const [k, arr] of groups) groups.set(k, sortCards(arr, filters.sort));
    return groups;
  }, [filteredCards, filters.sort]);

  const knownWorkstreams = useMemo(
    () => [...new Set(cards.map((c) => c.workstream))],
    [cards]
  );

  function openCard(id: string) {
    setSelectedId(id);
    setDrawerOpen(true);
  }

  // ── Autosave plumbing ───────────────────────────────────────────────────

  const flashSaved = useCallback(() => {
    setSaveState({ kind: "saved", at: Date.now() });
    // Soft-revert to idle after a short visible window.
    setTimeout(() => {
      setSaveState((s) => (s.kind === "saved" ? { kind: "idle" } : s));
    }, 1600);
  }, []);

  const handleSavePatch = useCallback(
    async (id: string, patch: AdminKanbanCardUpdate) => {
      const before = cards;
      // Optimistic local merge.
      setCards((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                ...patch,
                acceptanceCriteria:
                  patch.acceptanceCriteria === undefined
                    ? c.acceptanceCriteria
                    : patch.acceptanceCriteria,
                dependencies:
                  patch.dependencies === undefined ? c.dependencies : patch.dependencies,
              }
            : c
        )
      );
      setSaveState({ kind: "saving" });
      const result = await updateLaunchKanbanCardAction(id, patch);
      if (!result.ok) {
        setCards(before);
        setSaveState({ kind: "failed", message: result.error });
        return;
      }
      setCards((prev) => prev.map((c) => (c.id === id ? result.data : c)));
      lastFullSnapshot.current = lastFullSnapshot.current.map((c) =>
        c.id === id ? result.data : c
      );
      flashSaved();
    },
    [cards, flashSaved]
  );

  // ── Drag/drop ───────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [activeCardId, setActiveCardId] = useState<string | null>(null);

  function findStatusForOver(overId: string | number | null | undefined): KanbanStatus | null {
    if (overId == null) return null;
    const col = parseColumnId(String(overId));
    if (col && (LAUNCH_KANBAN_COLUMNS as readonly string[]).includes(col)) {
      return col as KanbanStatus;
    }
    const c = cardsById.get(String(overId));
    if (c && (LAUNCH_KANBAN_COLUMNS as readonly string[]).includes(c.status)) {
      return c.status as KanbanStatus;
    }
    return null;
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveCardId(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const overStatus = findStatusForOver(over.id);
    if (!overStatus) return;

    setCards((prev) => {
      const moving = prev.find((c) => c.id === active.id);
      if (!moving) return prev;
      if (moving.status === overStatus) return prev;
      return prev.map((c) =>
        c.id === active.id ? { ...c, status: overStatus } : c
      );
    });
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveCardId(null);
    const { active, over } = e;
    if (!over) return;

    const overStatus = findStatusForOver(over.id);
    if (!overStatus) return;

    const moving = cards.find((c) => c.id === active.id);
    if (!moving) return;

    // Compute the new ordering inside the destination column.
    const before = lastFullSnapshot.current;
    const grouped = groupCardIdsByStatus(
      cards.map((c) => (c.id === active.id ? { ...c, status: overStatus } : c))
    );
    let columnIds = grouped[overStatus];

    const overIsColumn = parseColumnId(String(over.id)) !== null;
    if (!overIsColumn && over.id !== active.id) {
      const fromIdx = columnIds.indexOf(String(active.id));
      const toIdx = columnIds.indexOf(String(over.id));
      if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
        columnIds = arrayMove(columnIds, fromIdx, toIdx);
      }
    }

    // Optimistic local commit with new sortOrder values.
    const renumbered: LaunchKanbanCard[] = cards.map((c) => {
      if (c.id === active.id) {
        const idx = columnIds.indexOf(c.id);
        return { ...c, status: overStatus, sortOrder: (idx + 1) * 10 };
      }
      if (c.status === overStatus) {
        const idx = columnIds.indexOf(c.id);
        if (idx !== -1) return { ...c, sortOrder: (idx + 1) * 10 };
      }
      return c;
    });
    setCards(renumbered);

    // Persist the whole destination column so sortOrder is consistent.
    const items = renumbered
      .filter((c) => c.status === overStatus || c.id === active.id)
      .map((c) => ({ id: c.id, status: c.status, sortOrder: c.sortOrder }));

    setSaveState({ kind: "saving" });
    const result = await reorderLaunchKanbanBoardAction(boardKey, items);
    if (!result.ok) {
      setCards(before);
      setSaveState({ kind: "failed", message: result.error });
      return;
    }
    setCards(result.data);
    lastFullSnapshot.current = result.data;
    flashSaved();
  }

  const selectedCard = selectedId ? cardsById.get(selectedId) ?? null : null;

  return (
    <div className="space-y-4">
      <LaunchKanbanFilters
        filters={filters}
        setFilters={setFilters}
        totalCards={cards.length}
        visibleCards={filteredCards.length}
        onBulkEdit={() => {
          /* visual-only placeholder per spec */
        }}
        saveState={saveState}
        knownWorkstreams={knownWorkstreams}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {filters.groupBy === "status" ? (
          <div className="flex gap-3.5 overflow-x-auto pb-2 xl:grid xl:grid-cols-6 xl:gap-4 xl:overflow-x-visible">
            {LAUNCH_KANBAN_COLUMNS.map((status) => (
              <div key={status} className="w-[260px] shrink-0 xl:w-auto xl:min-w-0">
                <div className="h-[calc(100vh-300px)] min-h-[420px]">
                  <LaunchKanbanColumn
                    columnId={status}
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
              .map(([workstream, ws]) => (
                <div key={workstream} className="h-[420px]">
                  <LaunchKanbanColumn
                    columnId={`ws:${workstream}`}
                    title={workstream}
                    count={ws.length}
                    cards={ws}
                    density={filters.density}
                    onSelectCard={openCard}
                    emptyHint="No matching cards in this workstream."
                  />
                </div>
              ))}
          </div>
        )}
      </DndContext>

      <LaunchKanbanDetailSheet
        card={selectedCard}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        cardsById={cardsById}
        onSave={handleSavePatch}
      />

      <span className="sr-only" aria-live="polite">
        {activeCardId ? `Dragging card ${activeCardId}` : ""}
      </span>
    </div>
  );
}
