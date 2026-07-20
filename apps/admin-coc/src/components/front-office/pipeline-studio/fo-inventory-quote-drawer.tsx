"use client";

import {
  formatCount,
  fulfillmentLabel,
} from "@/lib/front-office/pipeline-studio/inventory-display";
import type { InventoryExplorerLocalState } from "@/lib/front-office/pipeline-studio/use-inventory-explorer-state";
import { cn } from "@/lib/utils";

const QUOTE_OPTIONS = [
  { id: "partial_now", label: "Partial fill now" },
  { id: "review_additional", label: "Review additional/unlisted inventory" },
  { id: "generate_fresh", label: "Generate fresh leads" },
  { id: "broaden_age", label: "Broaden age range" },
  { id: "nearby_states", label: "Include nearby states" },
] as const;

export function FoInventoryQuoteDrawer({
  state,
}: {
  state: InventoryExplorerLocalState;
}) {
  if (!state.quoteMode) return null;

  const focused = state.focusedState;
  const niche =
    state.model.availableNiches.find((n) => n.key === state.filters.nicheKey)
      ?.label ?? state.filters.nicheKey;
  const ageLabels = state.filters.selectedAgeBuckets
    .map(
      (k) =>
        state.model.availableAgeBuckets.find((b) => b.key === k)?.label ?? k
    )
    .join(", ");
  const visible = focused?.filteredAvailable ?? 0;
  const shortfall = Math.max(0, state.filters.requestedQuantity - visible);
  const title =
    state.quoteMode === "inventory_review"
      ? "Request inventory review"
      : "Custom fulfillment request";

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ie-quote-title"
      data-testid="inventory-quote-drawer"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close drawer backdrop"
        onClick={state.closeQuote}
      />
      <aside className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] px-4 py-3">
          <div>
            <h2
              id="ie-quote-title"
              className="text-sm font-semibold text-[var(--ps-text)]"
            >
              {title}
            </h2>
            <p className="mt-1 text-[11px] leading-snug text-[var(--ps-muted)]">
              Additional inventory may be available through manual stock review
              or new lead generation.
            </p>
          </div>
          <button
            type="button"
            className="ps-focus-ring rounded-md px-2 py-1 text-xs text-[var(--ps-muted)] hover:text-[var(--ps-text)]"
            onClick={state.closeQuote}
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-xs">
          <Field label="Niche" value={niche} />
          <Field
            label="State"
            value={
              focused
                ? `${focused.stateName} (${focused.stateCode})`
                : "—"
            }
          />
          <Field label="Age buckets" value={ageLabels || "—"} />
          <Field
            label="Requested quantity"
            value={formatCount(state.filters.requestedQuantity)}
          />
          <Field
            label="Currently visible inventory"
            value={
              focused?.dataStatus === "unknown"
                ? "Unknown (not in snapshot)"
                : formatCount(visible)
            }
          />
          <Field label="Shortfall" value={formatCount(shortfall)} />
          {focused ? (
            <Field
              label="Inventory status"
              value={fulfillmentLabel(focused.fulfillmentStatus)}
            />
          ) : null}

          <label className="block space-y-1">
            <span className="text-[var(--ps-muted)]">Requested fulfillment date</span>
            <input
              type="date"
              className="ps-focus-ring w-full rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg-card)] px-2 py-1.5 text-[var(--ps-text)]"
              value={state.requestedDate}
              onChange={(e) => state.setRequestedDate(e.target.value)}
              data-testid="quote-fulfillment-date"
            />
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-[var(--ps-muted)]">Options</legend>
            {QUOTE_OPTIONS.map((opt) => (
              <label
                key={opt.id}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-[var(--ps-border)] px-2 py-1.5 hover:border-[var(--ps-border-strong)]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={state.quoteOptions.includes(opt.id)}
                  onChange={() => state.toggleQuoteOption(opt.id)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </fieldset>

          <label className="block space-y-1">
            <span className="text-[var(--ps-muted)]">Notes</span>
            <textarea
              className="ps-focus-ring min-h-[88px] w-full rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg-card)] px-2 py-1.5 text-[var(--ps-text)]"
              value={state.quoteNotes}
              onChange={(e) => state.setQuoteNotes(e.target.value)}
              placeholder="Context for the fulfillment team…"
              data-testid="quote-notes"
            />
          </label>
        </div>

        <footer className="space-y-2 border-t border-[var(--ps-border)] px-4 py-3">
          <button
            type="button"
            disabled
            className={cn("ps-btn-disabled w-full rounded-md px-3 py-2 text-xs")}
            data-testid="quote-submit-demo"
            title="Production request workflow is not connected yet"
          >
            Submit request (demo only — not connected)
          </button>
          <p className="text-center text-[10px] leading-snug text-[var(--ps-muted)]">
            Demo only: no network request is made. The production request
            workflow is not connected yet.
          </p>
        </footer>
      </aside>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg-card)] px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--ps-muted)]">
        {label}
      </p>
      <p className="mt-0.5 font-medium text-[var(--ps-text)]">{value}</p>
    </div>
  );
}
