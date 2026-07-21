"use client";

import { useMemo, useState } from "react";

import { FoInventoryQuoteDrawer } from "@/components/front-office/pipeline-studio/fo-inventory-quote-drawer";
import { FoInventoryStateDetail } from "@/components/front-office/pipeline-studio/fo-inventory-state-detail";
import { FoTerritoryMap } from "@/components/front-office/pipeline-studio/fo-territory-map";
import {
  formatCount,
  fulfillmentLabel,
} from "@/lib/front-office/pipeline-studio/inventory-display";
import {
  INVENTORY_EXPLORER_SAFETY_LINE,
  UNMAPPED_GEOGRAPHY_DISCLOSURE,
  type DerivedStateInventory,
  type InventoryExplorerReadModel,
  type InventoryNicheKey,
  type InventorySnapshotProvenance,
  type TimezoneKey,
  type TopStateIndicator,
} from "@/lib/front-office/pipeline-studio/inventory-types";
import { useInventoryExplorerState } from "@/lib/front-office/pipeline-studio/use-inventory-explorer-state";
import { cn } from "@/lib/utils";

const RANKED_PREVIEW_COUNT = 12;

export function FoInventoryExplorerContent({
  model,
}: {
  model: InventoryExplorerReadModel;
}) {
  const state = useInventoryExplorerState(model);
  const { filters, derived, capabilities } = state;
  const snapshot = derived.activeNiche.snapshot;
  const [showAllStates, setShowAllStates] = useState(false);
  const [stateSearch, setStateSearch] = useState("");

  const reportDate = new Date(snapshot.completedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const verificationLabel =
    snapshot.completeness === "COMPLETE"
      ? "Snapshot verified"
      : snapshot.completeness === "COMPLETE_WITH_WARNINGS"
        ? "Verified with geography notes"
        : snapshot.completeness === "PARTIAL"
          ? "Partial snapshot"
          : "Validation warning";

  const reconciliationLabel = snapshot.reconciledNationalTotals
    ? "Reconciled"
    : "Unreconciled";

  const filteredRanked = useMemo(() => {
    const q = stateSearch.trim().toLowerCase();
    const searched = q
      ? derived.rankedStates.filter(
          (row) =>
            row.stateName.toLowerCase().includes(q) ||
            row.stateCode.toLowerCase().includes(q)
        )
      : derived.rankedStates;

    if (q || showAllStates) return searched;

    return searched
      .filter((row) => row.dataStatus === "known")
      .slice(0, RANKED_PREVIEW_COUNT);
  }, [derived.rankedStates, showAllStates, stateSearch]);

  const totalKnown = derived.rankedStates.filter(
    (r) => r.dataStatus === "known"
  ).length;

  return (
    <div
      className="pipeline-studio -m-4 min-h-[calc(100dvh-5.5rem)] overflow-x-hidden rounded-none sm:-m-6"
      data-testid="inventory-explorer"
      data-niche={snapshot.nicheKey}
    >
      <div className="flex flex-col gap-2.5 p-3 sm:gap-3 sm:p-4">
        <SnapshotStrip
          nicheLabel={derived.activeNiche.label}
          reportDate={reportDate}
          completedAt={snapshot.completedAt}
          verificationLabel={verificationLabel}
          completeness={snapshot.completeness}
          publishedTotal={snapshot.publishedTotals.combined}
          mappedTotal={snapshot.mappedTotals.combined}
          unmappedTotal={snapshot.unmappedTotals.combined}
          reconciliationLabel={reconciliationLabel}
          sourceSheet={snapshot.sourceSheet}
          reportVersion={snapshot.reportVersion}
          reportLabel={snapshot.reportLabel}
          validationErrors={snapshot.validationErrors}
          snapshotUnverified={snapshot.snapshotUnverified}
          provenance={model.provenance}
        />

        <section
          className="ps-card grid gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-5"
          aria-label="Inventory filters"
          data-testid="inventory-filters"
        >
          <label className="flex flex-col gap-1 text-xs text-[var(--ps-muted)]">
            Niche
            <select
              className="ps-focus-ring rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-2 text-sm text-[var(--ps-text)]"
              value={filters.nicheKey}
              onChange={(e) =>
                state.setNiche(e.target.value as InventoryNicheKey)
              }
              data-testid="filter-niche"
            >
              {model.availableNiches.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="flex flex-col gap-1 text-xs text-[var(--ps-muted)]">
            <legend>Lead age</legend>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {model.availableAgeBuckets.map((bucket) => {
                const active = filters.selectedAgeBuckets.includes(bucket.key);
                return (
                  <button
                    key={bucket.key}
                    type="button"
                    className={cn(
                      "ps-focus-ring rounded-md border px-2.5 py-1.5 text-xs",
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

          <label className="flex flex-col gap-1 text-xs text-[var(--ps-muted)]">
            Timezone
            <select
              className="ps-focus-ring rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-2 text-sm text-[var(--ps-text)]"
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

          <label className="flex flex-col gap-1 text-xs text-[var(--ps-muted)]">
            Requested quantity
            <input
              type="number"
              min={1}
              max={5000}
              step={1}
              className="ps-focus-ring rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-2 text-sm text-[var(--ps-text)]"
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
              className="ps-focus-ring w-full rounded-md border border-[var(--ps-border)] px-2.5 py-2 text-sm text-[var(--ps-muted)] hover:border-[var(--ps-border-strong)] hover:text-[var(--ps-text)]"
              onClick={state.resetFilters}
              data-testid="filter-reset"
            >
              Reset filters
            </button>
          </div>
        </section>

        <section
          className="grid grid-cols-2 gap-2 lg:grid-cols-4"
          aria-label="Inventory KPIs"
          data-testid="inventory-kpis"
        >
          <Kpi
            label="Matching inventory"
            value={formatCount(derived.kpis.totalMatching)}
            dataTestId="kpi-matching-inventory"
          />
          <Kpi
            label="States able to fulfill"
            value={formatCount(derived.kpis.statesThatCanFulfill)}
            dataTestId="kpi-states-fulfill"
          />
          <Kpi
            label="Requested quantity"
            value={formatCount(filters.requestedQuantity)}
            dataTestId="kpi-requested-quantity"
          />
          <Kpi
            label="Snapshot status"
            value={reconciliationLabel}
            dataTestId="inventory-reconciliation-status"
          />
        </section>

        <TopOpportunities
          topOverall={snapshot.topInventoryState}
          strongest13={snapshot.strongestByAgeBucket["1_3"]}
          strongest36={snapshot.strongestByAgeBucket["3_6"]}
          strongest6={snapshot.strongestByAgeBucket["6_plus"]}
          onSelectState={state.focusState}
        />

        <div className="grid gap-2.5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <FoTerritoryMap
            states={derived.states}
            focusedStateCode={state.focusedStateCode}
            onFocusState={state.focusState}
          />
          <FoInventoryStateDetail state={state} />
        </div>

        <RankedStateSection
          rows={filteredRanked}
          totalKnown={totalKnown}
          previewCount={RANKED_PREVIEW_COUNT}
          showAll={showAllStates}
          search={stateSearch}
          nicheLabel={derived.activeNiche.label}
          focusedStateCode={state.focusedStateCode}
          onSearchChange={setStateSearch}
          onToggleShowAll={() => setShowAllStates((v) => !v)}
          onFocusState={state.focusState}
        />

        <p
          className="text-[11px] text-[var(--ps-muted)]"
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

function provenanceSourceLabel(source: InventorySnapshotProvenance["source"]): string {
  switch (source) {
    case "google_sheets":
      return "Live sheet snapshot";
    case "cached_google_sheets":
      return "Cached snapshot";
    case "fixture_csv":
    default:
      return "Fixture fallback";
  }
}

function SnapshotStrip({
  nicheLabel,
  reportDate,
  completedAt,
  verificationLabel,
  completeness,
  publishedTotal,
  mappedTotal,
  unmappedTotal,
  reconciliationLabel,
  sourceSheet,
  reportVersion,
  reportLabel,
  validationErrors,
  snapshotUnverified,
  provenance,
}: {
  nicheLabel: string;
  reportDate: string;
  completedAt: string;
  verificationLabel: string;
  completeness: string;
  publishedTotal: number;
  mappedTotal: number;
  unmappedTotal: number;
  reconciliationLabel: string;
  sourceSheet: string;
  reportVersion: string;
  reportLabel: string;
  validationErrors: string[];
  snapshotUnverified: boolean;
  provenance: InventorySnapshotProvenance;
}) {
  const warningTone =
    completeness === "INVALID" ||
    completeness === "PARTIAL" ||
    snapshotUnverified ||
    reconciliationLabel === "Unreconciled";

  return (
    <section
      className={cn(
        "rounded-md border px-3 py-2.5",
        warningTone
          ? "border-[var(--ps-amber)]/45 bg-[var(--ps-amber)]/10"
          : "border-[var(--ps-border)] bg-[var(--ps-bg-elevated)]/60"
      )}
      aria-label="Inventory snapshot status"
      data-testid="inventory-report-status-banner"
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <p
            className="text-sm font-semibold text-[var(--ps-text)]"
            data-testid="active-niche-label"
          >
            Inventory snapshot: {nicheLabel}
          </p>
          <p className="text-xs text-[var(--ps-muted)]">
            Updated{" "}
            <time dateTime={completedAt}>{reportDate}</time>
            {" · "}
            <span data-testid="inventory-completeness-label">
              {verificationLabel}
            </span>
          </p>
          <p className="text-sm text-[var(--ps-text)]">
            <span className="font-semibold tabular-nums">
              {formatCount(publishedTotal)}
            </span>{" "}
            leads reported
            {unmappedTotal > 0 ? (
              <>
                {" · "}
                <span
                  className="tabular-nums"
                  data-testid="unmapped-geography-summary"
                >
                  {formatCount(unmappedTotal)} outside the supported map
                </span>
              </>
            ) : null}
          </p>
          <p
            className="text-xs text-[var(--ps-blue)]"
            data-testid="inventory-explorer-notice"
          >
            {INVENTORY_EXPLORER_SAFETY_LINE}
          </p>
          {validationErrors.slice(0, 2).map((e) => (
            <p key={e} className="text-xs text-[var(--ps-amber)]">
              {e}
            </p>
          ))}
        </div>

        <details
          className="min-w-0 shrink-0 text-xs text-[var(--ps-muted)] lg:max-w-sm"
          data-testid="unmapped-geography-disclosure"
        >
          <summary className="cursor-pointer font-medium text-[var(--ps-text)]">
            Snapshot details
          </summary>
          <div className="mt-1.5 space-y-1 leading-snug">
            <p data-testid="inventory-source-sheet">
              Source sheet: {sourceSheet} · v{reportVersion}
            </p>
            <p data-testid="inventory-snapshot-provenance">
              {provenanceSourceLabel(provenance.source)}
              {" · "}
              {provenance.freshness}
              {provenance.fetchedAt ? (
                <>
                  {" · "}
                  <time dateTime={provenance.fetchedAt}>
                    fetched {new Date(provenance.fetchedAt).toLocaleString()}
                  </time>
                </>
              ) : null}
            </p>
            <p data-testid="inventory-report-label">{reportLabel}</p>
            <p data-testid="kpi-published-total">
              Reported inventory:{" "}
              <span className="tabular-nums text-[var(--ps-text)]">
                {formatCount(publishedTotal)}
              </span>
            </p>
            <p data-testid="kpi-mapped-total">
              Mapped state inventory:{" "}
              <span className="tabular-nums text-[var(--ps-text)]">
                {formatCount(mappedTotal)}
              </span>
            </p>
            <p data-testid="kpi-unmapped-total">
              Unmapped geography:{" "}
              <span className="tabular-nums text-[var(--ps-text)]">
                {formatCount(unmappedTotal)}
              </span>
            </p>
            <p>
              Reconciliation:{" "}
              <span className="text-[var(--ps-text)]">{reconciliationLabel}</span>
            </p>
            {unmappedTotal > 0 ? (
              <p data-testid="unmapped-geography-help">
                {UNMAPPED_GEOGRAPHY_DISCLOSURE}
              </p>
            ) : null}
          </div>
        </details>
      </div>
    </section>
  );
}

function TopOpportunities({
  topOverall,
  strongest13,
  strongest36,
  strongest6,
  onSelectState,
}: {
  topOverall: TopStateIndicator | null;
  strongest13: TopStateIndicator | null;
  strongest36: TopStateIndicator | null;
  strongest6: TopStateIndicator | null;
  onSelectState: (code: string) => void;
}) {
  const chips: { label: string; indicator: TopStateIndicator | null }[] = [
    { label: "Top overall", indicator: topOverall },
    { label: "Strongest 1–3 mo", indicator: strongest13 },
    { label: "Strongest 3–6 mo", indicator: strongest36 },
    { label: "Strongest 6+ mo", indicator: strongest6 },
  ];

  return (
    <section
      className="flex flex-wrap items-center gap-1.5"
      aria-label="Top opportunities"
      data-testid="inventory-top-states"
    >
      <span className="mr-1 text-xs font-medium text-[var(--ps-muted)]">
        Top opportunities
      </span>
      {chips.map(({ label, indicator }) => (
        <button
          key={label}
          type="button"
          disabled={!indicator}
          onClick={() => indicator && onSelectState(indicator.stateCode)}
          className={cn(
            "ps-focus-ring inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
            indicator
              ? "border-[var(--ps-border)] bg-[var(--ps-bg)]/50 text-[var(--ps-text)] hover:border-[var(--ps-blue)]/50"
              : "cursor-default border-[var(--ps-border)] text-[var(--ps-muted)] opacity-60"
          )}
        >
          <span className="text-[var(--ps-muted)]">{label}</span>
          <span className="font-medium tabular-nums">
            {indicator
              ? `${indicator.stateCode} · ${formatCount(indicator.value)}`
              : "—"}
          </span>
        </button>
      ))}
    </section>
  );
}

function RankedStateSection({
  rows,
  totalKnown,
  previewCount,
  showAll,
  search,
  nicheLabel,
  focusedStateCode,
  onSearchChange,
  onToggleShowAll,
  onFocusState,
}: {
  rows: DerivedStateInventory[];
  totalKnown: number;
  previewCount: number;
  showAll: boolean;
  search: string;
  nicheLabel: string;
  focusedStateCode: string | null;
  onSearchChange: (value: string) => void;
  onToggleShowAll: () => void;
  onFocusState: (code: string) => void;
}) {
  return (
    <section
      className="ps-card overflow-hidden"
      aria-label="Ranked state inventory"
      data-testid="inventory-ranked-list"
    >
      <div className="flex flex-col gap-2 border-b border-[var(--ps-border)] px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-[var(--ps-text)]">
            Ranked state inventory
          </h3>
          <p className="text-xs text-[var(--ps-muted)]">
            {showAll || search.trim()
              ? `Showing ${rows.length} states · ${nicheLabel}`
              : `Top ${Math.min(previewCount, totalKnown)} of ${totalKnown} known · ${nicheLabel}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="ie-state-search">
            Search states
          </label>
          <input
            id="ie-state-search"
            type="search"
            placeholder="Search states…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="ps-focus-ring w-full min-w-[10rem] rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-sm text-[var(--ps-text)] sm:w-44"
            data-testid="ranked-state-search"
          />
          <button
            type="button"
            className="ps-focus-ring rounded-md border border-[var(--ps-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--ps-text)] hover:border-[var(--ps-border-strong)]"
            onClick={onToggleShowAll}
            data-testid="ranked-toggle-all"
          >
            {showAll ? "Show fewer" : "Show all states"}
          </button>
        </div>
      </div>

      {/* Mobile / narrow: compact cards */}
      <ul className="divide-y divide-[var(--ps-border)] md:hidden" data-testid="ranked-mobile-list">
        {rows.map((row) => (
          <li key={row.stateCode}>
            <button
              type="button"
              className={cn(
                "flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left",
                focusedStateCode === row.stateCode && "bg-[var(--ps-blue)]/10"
              )}
              onClick={() => onFocusState(row.stateCode)}
              data-testid={`ranked-row-${row.stateCode}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ps-text)]">
                  {row.stateName}{" "}
                  <span className="text-[var(--ps-muted)]">({row.stateCode})</span>
                </p>
                <p className="mt-0.5 text-xs text-[var(--ps-muted)]">
                  {row.timezoneStatus === "mixed" ? "Mixed TZ" : row.timezones[0]}
                  {" · "}
                  {fulfillmentLabel(row.fulfillmentStatus)}
                </p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--ps-text)]">
                {row.dataStatus === "unknown"
                  ? "—"
                  : formatCount(row.filteredAvailable)}
              </p>
            </button>
          </li>
        ))}
      </ul>

      {/* Desktop table */}
      <div className="hidden max-h-[28rem] overflow-auto md:block">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--ps-bg-elevated)] text-xs uppercase tracking-wide text-[var(--ps-muted)] shadow-[0_1px_0_0_var(--ps-border)]">
            <tr>
              <th className="px-3 py-2.5 font-medium">State</th>
              <th className="px-3 py-2.5 font-medium">Timezone</th>
              <th className="px-3 py-2.5 font-medium">Available</th>
              <th className="px-3 py-2.5 font-medium">Fit</th>
              <th className="px-3 py-2.5 font-medium">Orders</th>
              <th className="px-3 py-2.5 font-medium">Data</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.stateCode}
                className={cn(
                  "cursor-pointer border-t border-[var(--ps-border)] hover:bg-[var(--ps-blue)]/5",
                  focusedStateCode === row.stateCode && "bg-[var(--ps-blue)]/10"
                )}
                onClick={() => onFocusState(row.stateCode)}
                data-testid={`ranked-desk-${row.stateCode}`}
              >
                <td className="px-3 py-2.5 font-medium">
                  {row.stateName}{" "}
                  <span className="text-[var(--ps-muted)]">({row.stateCode})</span>
                  {row.selected ? (
                    <span className="ml-1 text-xs text-[var(--ps-green)]">
                      · in preview
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-[var(--ps-muted)]">
                  {row.timezoneStatus === "mixed" ? "Mixed" : row.timezones[0]}
                </td>
                <td className="px-3 py-2.5 tabular-nums font-medium">
                  {row.dataStatus === "unknown"
                    ? "—"
                    : formatCount(row.filteredAvailable)}
                </td>
                <td className="px-3 py-2.5">
                  {fulfillmentLabel(row.fulfillmentStatus)}
                </td>
                <td className="px-3 py-2.5 tabular-nums">
                  {row.dataStatus === "unknown"
                    ? "—"
                    : formatCount(row.fullOrdersPossible)}
                </td>
                <td className="px-3 py-2.5 capitalize text-[var(--ps-muted)]">
                  {row.dataStatus}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Kpi({
  label,
  value,
  className,
  dataTestId,
}: {
  label: string;
  value: string;
  className?: string;
  dataTestId?: string;
}) {
  return (
    <div className={cn("ps-card px-3 py-2.5", className)} data-testid={dataTestId}>
      <p className="text-xs text-[var(--ps-muted)]">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-[var(--ps-text)]">
        {value}
      </p>
    </div>
  );
}

/** Route entry alias — Inventory Explorer is served at /front-office/pipeline-studio. */
export { FoInventoryExplorerContent as FoPipelineStudioContent };
