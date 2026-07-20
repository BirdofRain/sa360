"use client";

import { FoInventoryQuoteDrawer } from "@/components/front-office/pipeline-studio/fo-inventory-quote-drawer";
import { FoInventoryStateDetail } from "@/components/front-office/pipeline-studio/fo-inventory-state-detail";
import { FoTerritoryMap } from "@/components/front-office/pipeline-studio/fo-territory-map";
import {
  formatCount,
  fulfillmentLabel,
} from "@/lib/front-office/pipeline-studio/inventory-display";
import {
  INVENTORY_EXPLORER_NOTICE,
  type InventoryExplorerReadModel,
  type TimezoneKey,
} from "@/lib/front-office/pipeline-studio/inventory-types";
import { useInventoryExplorerState } from "@/lib/front-office/pipeline-studio/use-inventory-explorer-state";
import { cn } from "@/lib/utils";

export function FoInventoryExplorerContent({
  model,
}: {
  model: InventoryExplorerReadModel;
}) {
  const state = useInventoryExplorerState(model);
  const { filters, derived, capabilities } = state;

  const ranked = [...derived.states]
    .filter((s) => s.dataStatus === "known" || s.fulfillmentStatus === "unknown")
    .sort((a, b) => {
      if (a.dataStatus !== b.dataStatus) {
        return a.dataStatus === "known" ? -1 : 1;
      }
      return b.filteredAvailable - a.filteredAvailable;
    });

  const snapshotStamp = new Date(model.snapshot.completedAt).toLocaleString(
    "en-US",
    { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }
  );

  return (
    <div
      className="pipeline-studio -m-4 min-h-[calc(100dvh-5.5rem)] overflow-x-hidden rounded-none sm:-m-6"
      data-testid="inventory-explorer"
    >
      <div className="flex flex-col gap-3 p-3 sm:gap-3.5 sm:p-4">
        <div
          className="rounded-md border border-[var(--ps-border-strong)] bg-[var(--ps-blue)]/10 px-2.5 py-1.5 text-center text-[11px] leading-snug text-[var(--ps-blue)] sm:text-xs"
          role="status"
          data-testid="inventory-explorer-notice"
        >
          {INVENTORY_EXPLORER_NOTICE}
        </div>

        <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-[var(--ps-text)] sm:text-lg">
              Lead Inventory Explorer
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--ps-muted)] sm:text-xs">
              Explore available lead inventory by niche, age, state, and
              timezone.
            </p>
          </div>
          <div className="text-[10px] leading-relaxed text-[var(--ps-muted)] sm:text-right">
            <p>
              Snapshot{" "}
              <time dateTime={model.snapshot.completedAt}>{snapshotStamp}</time>{" "}
              UTC
            </p>
            <p data-testid="inventory-report-label">{model.snapshot.reportLabel}</p>
            <p>
              Fixture preview · {model.dataSource}
              {model.snapshot.isPartialReport ? " · partial report" : ""}
            </p>
          </div>
        </header>

        <section
          className="ps-card grid gap-2 p-2.5 sm:grid-cols-2 lg:grid-cols-5"
          aria-label="Inventory filters"
          data-testid="inventory-filters"
        >
          <label className="flex flex-col gap-1 text-[10px] text-[var(--ps-muted)]">
            Niche
            <select
              className="ps-focus-ring rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1.5 text-xs text-[var(--ps-text)]"
              value={filters.nicheKey}
              onChange={(e) => state.setNiche(e.target.value)}
              data-testid="filter-niche"
            >
              {model.availableNiches.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1 text-[10px] text-[var(--ps-muted)] sm:col-span-1 lg:col-span-1">
            <legend>Lead age</legend>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {model.availableAgeBuckets.map((bucket) => {
                const active = filters.selectedAgeBuckets.includes(bucket.key);
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    className={cn(
                      "ps-focus-ring rounded-md border px-2 py-1 text-[11px]",
                      active
                        ? "border-[var(--ps-blue)] bg-[var(--ps-blue)]/15 text-[var(--ps-text)]"
                        : "border-[var(--ps-border)] text-[var(--ps-muted)]"
                    )}
                    aria-pressed={active}
                    data-testid={`filter-age-${bucket.key}`}
                    onClick={() => state.toggleAgeBucket(bucket.key)}
                  >
                    {bucket.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1 text-[10px] text-[var(--ps-muted)]">
            Timezone
            <select
              className="ps-focus-ring rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1.5 text-xs text-[var(--ps-text)]"
              value={filters.selectedTimezone ?? ""}
              onChange={(e) =>
                state.setTimezone(
                  e.target.value ? (e.target.value as TimezoneKey) : null
                )
              }
              data-testid="filter-timezone"
            >
              <option value="">All timezones</option>
              {model.availableTimezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[10px] text-[var(--ps-muted)]">
            Requested quantity
            <input
              type="number"
              min={1}
              max={5000}
              step={1}
              className="ps-focus-ring rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1.5 text-xs text-[var(--ps-text)]"
              value={filters.requestedQuantity}
              onChange={(e) =>
                state.setRequestedQuantity(Number(e.target.value))
              }
              data-testid="filter-quantity"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              className="ps-focus-ring w-full rounded-md border border-[var(--ps-border)] px-2 py-1.5 text-xs text-[var(--ps-muted)] hover:border-[var(--ps-border-strong)] hover:text-[var(--ps-text)]"
              onClick={state.resetFilters}
              data-testid="filter-reset"
            >
              Reset filters
            </button>
          </div>
        </section>

        <section
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5"
          aria-label="Inventory KPIs"
          data-testid="inventory-kpis"
        >
          <Kpi
            label="Matching inventory"
            value={formatCount(derived.kpis.totalMatching)}
          />
          <Kpi
            label="States with inventory"
            value={formatCount(derived.kpis.statesWithInventory)}
          />
          <Kpi
            label="States that can fulfill"
            value={formatCount(derived.kpis.statesThatCanFulfill)}
          />
          <Kpi
            label="Est. shortfall (selection)"
            value={formatCount(derived.kpis.estimatedShortfall)}
          />
          <Kpi
            label="Snapshot freshness"
            value={derived.kpis.snapshotFreshnessLabel}
            className="col-span-2 sm:col-span-1 lg:col-span-1"
          />
        </section>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
          <FoTerritoryMap
            states={derived.states}
            focusedStateCode={state.focusedStateCode}
            onFocusState={state.focusState}
          />
          <FoInventoryStateDetail state={state} />
        </div>

        <section
          className="ps-card overflow-hidden"
          aria-label="Ranked state inventory"
          data-testid="inventory-ranked-list"
        >
          <div className="flex items-center justify-between border-b border-[var(--ps-border)] px-3 py-2">
            <h3 className="text-xs font-semibold text-[var(--ps-text)]">
              Ranked state inventory
            </h3>
            <p className="text-[10px] text-[var(--ps-muted)]">
              Known states first · unknown never shown as zero
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="bg-[var(--ps-bg)]/50 text-[10px] uppercase tracking-wide text-[var(--ps-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">State</th>
                  <th className="px-3 py-2 font-medium">Timezone</th>
                  <th className="px-3 py-2 font-medium">Available</th>
                  <th className="px-3 py-2 font-medium">Fit</th>
                  <th className="px-3 py-2 font-medium">Orders</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((row) => (
                  <tr
                    key={row.stateCode}
                    className={cn(
                      "cursor-pointer border-t border-[var(--ps-border)] hover:bg-[var(--ps-blue)]/5",
                      state.focusedStateCode === row.stateCode &&
                        "bg-[var(--ps-blue)]/10"
                    )}
                    onClick={() => state.focusState(row.stateCode)}
                    data-testid={`ranked-row-${row.stateCode}`}
                  >
                    <td className="px-3 py-2 font-medium">
                      {row.stateName}{" "}
                      <span className="text-[var(--ps-muted)]">
                        ({row.stateCode})
                      </span>
                      {row.selected ? (
                        <span className="ml-1 text-[10px] text-[var(--ps-green)]">
                          · selected
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-[var(--ps-muted)]">
                      {row.timezoneStatus === "mixed"
                        ? "Mixed"
                        : row.timezones[0]}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.dataStatus === "unknown"
                        ? "—"
                        : formatCount(row.filteredAvailable)}
                    </td>
                    <td className="px-3 py-2">
                      {fulfillmentLabel(row.fulfillmentStatus)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.dataStatus === "unknown"
                        ? "—"
                        : formatCount(row.fullOrdersPossible)}
                    </td>
                    <td className="px-3 py-2 capitalize text-[var(--ps-muted)]">
                      {row.dataStatus}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p
          className="text-[10px] text-[var(--ps-muted)]"
          data-testid="inventory-capabilities"
        >
          Capabilities: create order{" "}
          {String(capabilities.canCreateOrder)} · reserve{" "}
          {String(capabilities.canReserveInventory)} · quote API{" "}
          {String(capabilities.canRequestQuote)} · review demo{" "}
          {String(capabilities.canReviewAdditionalInventory)}
        </p>
      </div>

      <FoInventoryQuoteDrawer state={state} />
    </div>
  );
}

function Kpi({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("ps-card px-2.5 py-2", className)}>
      <p className="text-[10px] text-[var(--ps-muted)]">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ps-text)]">
        {value}
      </p>
    </div>
  );
}

/** Route entry alias — Inventory Explorer is served at /front-office/pipeline-studio. */
export { FoInventoryExplorerContent as FoPipelineStudioContent };
