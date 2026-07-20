"use client";

import {
  formatCount,
  formatPercentRatio,
  fulfillmentLabel,
} from "@/lib/front-office/pipeline-studio/inventory-display";
import type { DerivedStateInventory } from "@/lib/front-office/pipeline-studio/inventory-types";
import type { InventoryExplorerLocalState } from "@/lib/front-office/pipeline-studio/use-inventory-explorer-state";
import { cn } from "@/lib/utils";

export function FoInventoryStateDetail({
  state,
}: {
  state: InventoryExplorerLocalState;
}) {
  const focused = state.focusedState;
  const niche =
    state.model.availableNiches.find((n) => n.key === state.filters.nicheKey)
      ?.label ?? state.filters.nicheKey;

  return (
    <aside
      className="ps-card flex flex-col gap-3 p-3 lg:min-h-[520px]"
      aria-label="Selected state detail"
      data-testid="inventory-state-detail"
    >
      {!focused ? (
        <p className="text-sm text-[var(--ps-muted)]">
          Select a state on the map to inspect inventory fit.
        </p>
      ) : (
        <>
          <header>
            <p className="text-[10px] uppercase tracking-wide text-[var(--ps-muted)]">
              Selected state
            </p>
            <h3 className="text-base font-semibold text-[var(--ps-text)]">
              {focused.stateName}{" "}
              <span className="text-[var(--ps-muted)]">({focused.stateCode})</span>
            </h3>
            {state.derived.activeNiche.snapshot.snapshotUnverified ? (
              <p
                className="mt-1 text-[10px] text-[var(--ps-amber)]"
                data-testid="state-detail-unverified"
              >
                Snapshot unverified — not purchasable inventory capacity
              </p>
            ) : null}
            {focused.timezoneStatus === "mixed" ? (
              <span
                className="mt-1 inline-flex rounded border border-[var(--ps-amber)]/40 bg-[var(--ps-amber)]/10 px-1.5 py-0.5 text-[10px] font-medium text-[var(--ps-amber)]"
                title="State spans multiple timezones. Counts are state aggregates only — not timezone-precise."
                data-testid="mixed-timezone-badge"
              >
                Mixed timezone
              </span>
            ) : (
              <p className="mt-1 text-[11px] text-[var(--ps-muted)]">
                {focused.timezones.join(", ")}
              </p>
            )}
          </header>

          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Stat label="Niche" value={niche} />
            <Stat
              label="Age buckets"
              value={state.filters.selectedAgeBuckets
                .map(
                  (k) =>
                    state.model.availableAgeBuckets.find((b) => b.key === k)
                      ?.label ?? k
                )
                .join(", ")}
            />
            <Stat
              label="Filtered availability"
              value={
                focused.dataStatus === "unknown"
                  ? "Unknown"
                  : formatCount(focused.filteredAvailable)
              }
            />
            <Stat
              label="Requested qty"
              value={formatCount(state.filters.requestedQuantity)}
            />
            <Stat
              label="Fulfillment %"
              value={
                focused.dataStatus === "unknown"
                  ? "—"
                  : formatPercentRatio(focused.fulfillmentRatio)
              }
            />
            <Stat
              label="Full orders possible"
              value={
                focused.dataStatus === "unknown"
                  ? "—"
                  : formatCount(focused.fullOrdersPossible)
              }
            />
            <Stat
              label="Inventory status"
              value={fulfillmentLabel(focused.fulfillmentStatus)}
              className="col-span-2"
            />
          </dl>

          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wide text-[var(--ps-muted)]">
              Counts by age bucket
            </p>
            <ul className="space-y-1 text-xs">
              {state.model.availableAgeBuckets.map((bucket) => (
                <li
                  key={bucket.key}
                  className="flex justify-between rounded border border-[var(--ps-border)] px-2 py-1"
                >
                  <span className="text-[var(--ps-muted)]">{bucket.label}</span>
                  <span className="font-medium tabular-nums">
                    {focused.dataStatus === "unknown"
                      ? "—"
                      : formatCount(focused.countsByAgeBucket[bucket.key])}
                  </span>
                </li>
              ))}
            </ul>
            {focused.dataStatus === "unknown" ? (
              <p className="mt-2 text-[11px] leading-snug text-[var(--ps-muted)]">
                This state is omitted from the partial snapshot and is not treated
                as zero inventory.
              </p>
            ) : null}
            {focused.timezoneStatus === "mixed" ? (
              <p className="mt-2 text-[11px] leading-snug text-[var(--ps-muted)]">
                Mixed-timezone states use geographic labels only. Precise
                timezone-level counts are not available from state aggregates.
              </p>
            ) : null}
          </div>

          <StateActions focused={focused} state={state} />
        </>
      )}
    </aside>
  );
}

function Stat({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)]/40 px-2 py-1.5",
        className
      )}
    >
      <dt className="text-[10px] text-[var(--ps-muted)]">{label}</dt>
      <dd className="mt-0.5 font-medium text-[var(--ps-text)]">{value}</dd>
    </div>
  );
}

function StateActions({
  focused,
  state,
}: {
  focused: DerivedStateInventory;
  state: InventoryExplorerLocalState;
}) {
  if (focused.dataStatus === "unknown") {
    return (
      <button
        type="button"
        className="ps-focus-ring rounded-md border border-[var(--ps-purple)]/40 bg-[var(--ps-purple)]/15 px-3 py-2 text-xs font-medium text-[var(--ps-text)] hover:bg-[var(--ps-purple)]/25"
        data-testid="action-request-inventory-review"
        onClick={() => state.openQuote("inventory_review")}
      >
        Request inventory review
      </button>
    );
  }

  if (
    focused.fulfillmentStatus === "strong" ||
    focused.fulfillmentStatus === "available"
  ) {
    return (
      <button
        type="button"
        className="ps-focus-ring rounded-md border border-[var(--ps-green)]/40 bg-[var(--ps-green)]/15 px-3 py-2 text-xs font-medium text-[var(--ps-text)] hover:bg-[var(--ps-green)]/25"
        data-testid="action-add-to-selection"
        onClick={() => state.toggleSelection(focused.stateCode)}
      >
        {focused.selected ? "Remove from selection" : "Add to selection"}
        <span className="mt-0.5 block text-[10px] font-normal text-[var(--ps-muted)]">
          Local only — no reservation
        </span>
      </button>
    );
  }

  if (focused.fulfillmentStatus === "partial") {
    return (
      <button
        type="button"
        className="ps-focus-ring rounded-md border border-[var(--ps-amber)]/40 bg-[var(--ps-amber)]/15 px-3 py-2 text-xs font-medium text-[var(--ps-text)] hover:bg-[var(--ps-amber)]/25"
        data-testid="action-add-partial"
        onClick={() => state.toggleSelection(focused.stateCode)}
      >
        {focused.selected ? "Remove partial selection" : "Add partial quantity"}
        <span className="mt-0.5 block text-[10px] font-normal text-[var(--ps-muted)]">
          Local only — no reservation
        </span>
      </button>
    );
  }

  if (
    focused.fulfillmentStatus === "custom_review" ||
    focused.fulfillmentStatus === "unavailable"
  ) {
    return (
      <button
        type="button"
        className="ps-focus-ring rounded-md border border-[var(--ps-purple)]/40 bg-[var(--ps-purple)]/15 px-3 py-2 text-xs font-medium text-[var(--ps-text)] hover:bg-[var(--ps-purple)]/25"
        data-testid="action-request-custom-fulfillment"
        onClick={() => state.openQuote("custom_fulfillment")}
      >
        Request custom fulfillment
      </button>
    );
  }

  return null;
}
