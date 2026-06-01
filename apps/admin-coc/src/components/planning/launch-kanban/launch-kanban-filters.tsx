"use client";

import { Check, CircleAlert, Loader2, Pencil, Plus, RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import {
  DEFAULT_LAUNCH_KANBAN_FILTERS,
  OWNER_FILTER_UNASSIGNED,
  LAUNCH_KANBAN_COLUMNS,
  launchKanbanColumnLabel,
  LAUNCH_KANBAN_PRIORITIES,
  LAUNCH_KANBAN_SORT_OPTIONS,
  LAUNCH_KANBAN_WORKSTREAMS,
  type KanbanPriority,
  type KanbanStatus,
  type LaunchKanbanFilters,
  type LaunchKanbanSort,
  type SaveState,
} from "./launch-kanban-types";

const selectClass =
  "h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 shadow-[0_1px_0_rgba(15,23,42,0.02)] focus:outline-none focus:ring-2 focus:ring-slate-300";

const SORT_LABEL: Record<LaunchKanbanSort, string> = {
  manual: "Manual Order",
  priority: "Priority",
  due_date: "Due Date",
  workstream: "Workstream",
  recently_updated: "Recently Updated",
};

function PillToggle({
  active,
  onClick,
  children,
  label,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors",
        active
          ? "bg-slate-900 text-white shadow-[0_1px_0_rgba(15,23,42,0.1)]"
          : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
      )}
    >
      {children}
    </button>
  );
}

function SaveChip({ state }: { state: SaveState }) {
  if (state.kind === "idle") {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-500">
        <Check className="size-3 text-slate-400" aria-hidden />
        Saved
      </span>
    );
  }
  if (state.kind === "saving") {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-600">
        <Loader2 className="size-3 animate-spin text-slate-500" aria-hidden />
        Saving…
      </span>
    );
  }
  if (state.kind === "saved") {
    return (
      <span className="inline-flex h-6 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-[11px] text-emerald-700">
        <Check className="size-3" aria-hidden />
        Saved
      </span>
    );
  }
  return (
    <span
      className="inline-flex h-6 items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-[11px] text-red-700"
      title={state.message}
    >
      <CircleAlert className="size-3" aria-hidden />
      Save failed
    </span>
  );
}

export function LaunchKanbanFilters({
  filters,
  setFilters,
  totalCards,
  visibleCards,
  onBulkEdit,
  onAddTask,
  saveState,
  knownWorkstreams,
  knownOwners,
}: {
  filters: LaunchKanbanFilters;
  setFilters: (updater: (prev: LaunchKanbanFilters) => LaunchKanbanFilters) => void;
  totalCards: number;
  visibleCards: number;
  onBulkEdit: () => void;
  /** Opens the create-task sheet (launch kanban only). */
  onAddTask?: () => void;
  saveState: SaveState;
  /** Discovered workstream strings present on the current board, used alongside the canonical list. */
  knownWorkstreams: string[];
  /** Distinct non-empty owner names on the board (sorted). */
  knownOwners: string[];
}) {
  function reset() {
    setFilters(() => ({ ...DEFAULT_LAUNCH_KANBAN_FILTERS }));
  }

  const dropdownWorkstreams = [
    ...new Set<string>([...LAUNCH_KANBAN_WORKSTREAMS, ...knownWorkstreams]),
  ].sort();

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-[220px] flex-1 gap-1.5">
          <Label htmlFor="lk-search" className="text-[11px] text-slate-500">
            Search
          </Label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <Input
              id="lk-search"
              value={filters.search}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, search: e.currentTarget.value }))
              }
              placeholder="Search title, description, owner…"
              className="h-8 pl-7 text-xs"
            />
          </div>
        </div>

        <div className="grid min-w-[180px] gap-1.5">
          <Label htmlFor="lk-workstream" className="text-[11px] text-slate-500">
            Workstream
          </Label>
          <select
            id="lk-workstream"
            value={filters.workstream}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                workstream: e.currentTarget.value,
              }))
            }
            className={selectClass}
          >
            <option value="ALL">All workstreams</option>
            {dropdownWorkstreams.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>

        <div className="grid min-w-[120px] gap-1.5">
          <Label htmlFor="lk-priority" className="text-[11px] text-slate-500">
            Priority
          </Label>
          <select
            id="lk-priority"
            value={filters.priority}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                priority: e.currentTarget.value as KanbanPriority | "ALL",
              }))
            }
            className={selectClass}
          >
            <option value="ALL">All priorities</option>
            {LAUNCH_KANBAN_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div className="grid min-w-[140px] gap-1.5">
          <Label htmlFor="lk-status" className="text-[11px] text-slate-500">
            Status
          </Label>
          <select
            id="lk-status"
            value={filters.status}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                status: e.currentTarget.value as KanbanStatus | "ALL",
              }))
            }
            className={selectClass}
          >
            <option value="ALL">All statuses</option>
            {LAUNCH_KANBAN_COLUMNS.map((s) => (
              <option key={s} value={s}>
                {launchKanbanColumnLabel(s)}
              </option>
            ))}
          </select>
        </div>

        <div className="grid min-w-[140px] gap-1.5">
          <Label htmlFor="lk-owner" className="text-[11px] text-slate-500">
            Owner
          </Label>
          <select
            id="lk-owner"
            value={filters.owner}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                owner: e.currentTarget.value,
              }))
            }
            className={selectClass}
          >
            <option value="ALL">All owners</option>
            <option value={OWNER_FILTER_UNASSIGNED}>Unassigned</option>
            {knownOwners.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid min-w-[170px] gap-1.5">
          <Label htmlFor="lk-sort" className="text-[11px] text-slate-500">
            Sort
          </Label>
          <select
            id="lk-sort"
            value={filters.sort}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                sort: e.currentTarget.value as LaunchKanbanSort,
              }))
            }
            className={selectClass}
          >
            {LAUNCH_KANBAN_SORT_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {SORT_LABEL[opt]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-slate-400">View</span>
        <PillToggle
          active={filters.density === "compact"}
          onClick={() =>
            setFilters((prev) => ({
              ...prev,
              density: prev.density === "compact" ? "comfortable" : "compact",
            }))
          }
          label="Toggle density"
        >
          {filters.density === "compact" ? "Compact" : "Comfortable"}
        </PillToggle>
        <PillToggle
          active={filters.groupBy === "workstream"}
          onClick={() =>
            setFilters((prev) => ({
              ...prev,
              groupBy: prev.groupBy === "status" ? "workstream" : "status",
            }))
          }
          label="Group by"
        >
          Group by {filters.groupBy === "status" ? "Status" : "Workstream"}
        </PillToggle>

        <span className="ml-3 text-[11px] uppercase tracking-wider text-slate-400">Quick filters</span>
        <PillToggle
          active={filters.p0Only}
          onClick={() => setFilters((prev) => ({ ...prev, p0Only: !prev.p0Only }))}
        >
          P0 Only
        </PillToggle>
        <PillToggle
          active={filters.blockedOnly}
          onClick={() => setFilters((prev) => ({ ...prev, blockedOnly: !prev.blockedOnly }))}
        >
          Blocked Only
        </PillToggle>
        <PillToggle
          active={filters.dueThisWeekOnly}
          onClick={() =>
            setFilters((prev) => ({ ...prev, dueThisWeekOnly: !prev.dueThisWeekOnly }))
          }
          label="Due this calendar week (Mon–Sun)"
        >
          Due this week
        </PillToggle>
        <PillToggle
          active={filters.betaMvpOnly}
          onClick={() => setFilters((prev) => ({ ...prev, betaMvpOnly: !prev.betaMvpOnly }))}
        >
          Beta MVP Only
        </PillToggle>

        <div className="ml-auto flex items-center gap-2">
          <SaveChip state={saveState} />
          <span className="text-[11px] text-slate-400">
            {visibleCards} / {totalCards} cards
          </span>
          <Button type="button" variant="outline" size="sm" onClick={reset}>
            <RotateCcw className="size-3.5" aria-hidden />
            Reset
          </Button>
          {onAddTask ? (
            <Button type="button" size="sm" onClick={onAddTask} className="gap-1">
              <Plus className="size-3.5" aria-hidden />
              Add task
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onBulkEdit}>
            <Pencil className="size-3.5" aria-hidden />
            Bulk Edit
          </Button>
        </div>
      </div>
    </div>
  );
}
