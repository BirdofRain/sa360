"use client";

import { Search } from "lucide-react";

import {
  formatLeadsPerDay,
  isTerritoryInteractive,
  PS_PRIORITY_DISPLAY,
} from "@/lib/front-office/pipeline-studio/display";
import type { PipelineStudioLocalState } from "@/lib/front-office/pipeline-studio/use-pipeline-studio-state";
import { cn } from "@/lib/utils";

export function FoTerritoryBar({ state }: { state: PipelineStudioLocalState }) {
  return (
    <section className="ps-card p-2.5" aria-label="Territory selection">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-[var(--ps-text)]">
          Territory Selection
        </p>
        <div className="relative min-w-[160px] flex-1 sm:max-w-[220px]">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--ps-muted)]"
            aria-hidden
          />
          <input
            type="search"
            value={state.territoryQuery}
            onChange={(e) => state.setTerritoryQuery(e.target.value)}
            placeholder="Search states…"
            className="ps-focus-ring h-8 w-full rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] py-1 pl-7 pr-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-muted)]"
            aria-label="Search territories"
          />
        </div>
        <button
          type="button"
          onClick={state.selectAllEnabled}
          className="ps-focus-ring h-8 rounded-md border border-[var(--ps-border)] px-2.5 text-xs text-[var(--ps-text)] hover:bg-white/5"
        >
          Select All
        </button>
        <span className="rounded-full border border-[var(--ps-border-strong)] bg-[var(--ps-blue)]/10 px-2 py-1 text-[11px] font-medium text-[var(--ps-blue)]">
          {state.selectedCount} Selected
        </span>
      </div>

      <div className="mt-2 flex gap-2 overflow-x-auto pb-0.5">
        {state.filteredTerritories.map((t) => {
          const priority = PS_PRIORITY_DISPLAY[t.priority];
          const interactive = isTerritoryInteractive(t);
          return (
            <button
              key={t.stateCode}
              type="button"
              disabled={!interactive}
              onClick={() => {
                state.setSelectedTerritoryCode(t.stateCode);
                if (interactive) state.toggleTerritory(t.stateCode);
              }}
              className={cn(
                "ps-focus-ring min-h-11 min-w-[118px] shrink-0 rounded-lg border px-2.5 py-2 text-left transition-colors",
                !interactive && "cursor-not-allowed opacity-45",
                interactive &&
                  t.selected &&
                  "ps-card-priority border-[var(--ps-purple)]/50 bg-[var(--ps-bg-elevated)]",
                interactive &&
                  !t.selected &&
                  "border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] hover:border-[var(--ps-blue)]/40",
                state.selectedTerritoryCode === t.stateCode &&
                  interactive &&
                  "ring-1 ring-[var(--ps-blue)]/50"
              )}
              aria-pressed={t.selected}
              aria-label={`${t.stateName} ${t.selected ? "selected" : "not selected"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold tracking-wide">
                  {t.stateCode}
                </span>
                <span
                  className={cn(
                    "relative h-4 w-7 rounded-full",
                    t.selected && interactive ? "bg-[var(--ps-blue)]" : "bg-slate-600"
                  )}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "absolute top-0.5 size-3 rounded-full bg-white transition-transform",
                      t.selected && interactive ? "left-3.5" : "left-0.5"
                    )}
                  />
                </span>
              </div>
              <p className="mt-0.5 truncate text-[10px] text-[var(--ps-muted)]">
                {t.stateName}
              </p>
              <p className={cn("mt-0.5 text-[10px] font-medium", priority.className)}>
                {priority.label}
              </p>
              <p className="mt-0.5 text-[10px] text-[var(--ps-muted)]">
                {formatLeadsPerDay(t.estimatedLeadsPerDay)} / day · {t.health}
              </p>
            </button>
          );
        })}
        {state.filteredTerritories.length === 0 ? (
          <p className="px-2 py-4 text-sm text-[var(--ps-muted)]">
            No territories match your search.
          </p>
        ) : null}
      </div>
    </section>
  );
}
