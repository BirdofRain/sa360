"use client";

import { useEffect, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import usStatesGeo from "@/lib/front-office/pipeline-studio/geo/us-states-albers.svg.json";
import {
  type PortalInventoryAvailabilityResponse,
  type PortalInventoryAvailabilityTier,
} from "@/lib/client-portal/portal-inventory-map";
import type { PortalOrderRequestOption } from "@/lib/client-portal/portal-order-request";
import { cn } from "@/lib/utils";

type GeoAsset = {
  viewBox: string;
  states: Array<{ stateCode: string; stateName: string; path: string }>;
};

const GEO = usStatesGeo as GeoAsset;

const TIER_STYLES: Record<
  PortalInventoryAvailabilityTier,
  { fill: string; badge: string; label: string }
> = {
  Available: {
    fill: "#0f9f7a",
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
    label: "Available",
  },
  Limited: {
    fill: "#f59e0b",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    label: "Limited",
  },
  "Currently unavailable": {
    fill: "#cbd5e1",
    badge: "border-slate-200 bg-slate-100 text-slate-600",
    label: "Currently unavailable",
  },
};

export type PortalInventoryAvailabilityLoader = (input: {
  nicheKey: string;
  productType: string;
  requestedAgeBucket: string;
  requestedQuantity: number;
  signal: AbortSignal;
}) => Promise<PortalInventoryAvailabilityResponse>;

async function defaultLoadAvailability(
  input: Parameters<PortalInventoryAvailabilityLoader>[0]
): Promise<PortalInventoryAvailabilityResponse> {
  const params = new URLSearchParams({
    nicheKey: input.nicheKey,
    requestedAgeBucket: input.requestedAgeBucket,
    requestedQuantity: String(input.requestedQuantity),
  });
  if (input.productType) params.set("productType", input.productType);
  const response = await fetch(
    `/api/client-portal/leads-on-demand/availability?${params.toString()}`,
    { headers: { Accept: "application/json" }, signal: input.signal }
  );
  if (!response.ok) throw new Error("Inventory availability is temporarily unavailable.");
  return (await response.json()) as PortalInventoryAvailabilityResponse;
}

export function PortalOrderInventoryMap({
  states,
  selectedStates,
  onToggleState,
  maxSelectedStates,
  nicheKey,
  productType,
  requestedAgeBucket,
  requestedQuantity,
  loadAvailability = defaultLoadAvailability,
}: {
  states: PortalOrderRequestOption[];
  selectedStates: string[];
  onToggleState: (code: string) => void;
  maxSelectedStates: number;
  nicheKey: string;
  productType: string;
  requestedAgeBucket: string | null;
  requestedQuantity: number;
  loadAvailability?: PortalInventoryAvailabilityLoader;
}) {
  const [query, setQuery] = useState("");
  const [focusedState, setFocusedState] = useState<string | null>(null);
  const [availability, setAvailability] =
    useState<PortalInventoryAvailabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!requestedAgeBucket || !nicheKey || requestedQuantity < 1) {
      setAvailability(null);
      setError(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void loadAvailability({
      nicheKey,
      productType,
      requestedAgeBucket,
      requestedQuantity,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted) setAvailability(result);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setAvailability(null);
        setError(
          caught instanceof Error && caught.message
            ? caught.message
            : "Inventory availability is temporarily unavailable."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    loadAvailability,
    nicheKey,
    productType,
    requestedAgeBucket,
    requestedQuantity,
  ]);

  const byState = useMemo(
    () => new Map(availability?.states.map((row) => [row.state, row.availability]) ?? []),
    [availability]
  );
  const visibleStates = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return states;
    return states.filter(
      (state) =>
        state.value.toLowerCase().includes(normalized) ||
        state.label.toLowerCase().includes(normalized)
    );
  }, [query, states]);
  const focusedOption = states.find((state) => state.value === focusedState);
  const focusedTier = focusedState ? byState.get(focusedState) : undefined;
  const atLimit = selectedStates.length >= maxSelectedStates;
  const canShowTiers = availability?.mappingSupported === true && !error;

  function stateDescription(code: string, name: string): string {
    const selected = selectedStates.includes(code);
    const tier = canShowTiers ? byState.get(code) ?? "Currently unavailable" : null;
    return `${name} (${code})${tier ? `: ${tier}` : ": availability unavailable"}${
      selected ? ", selected" : ""
    }`;
  }

  return (
    <section
      className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4"
      aria-labelledby="portal-inventory-map-title"
      data-testid="portal-order-inventory-map"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="portal-inventory-map-title" className="text-base font-semibold text-slate-900">
            Explore availability
          </h3>
          <p className="mt-0.5 text-sm text-slate-600">
            Select up to {maxSelectedStates} states on the map or in the searchable list.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {selectedStates.length} of {maxSelectedStates} selected
        </span>
      </div>

      {!requestedAgeBucket ? (
        <p className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Choose an age bucket to view state availability.
        </p>
      ) : loading ? (
        <p role="status" className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Loading current availability…
        </p>
      ) : error ? (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error} You can still select states manually.
        </p>
      ) : availability && !availability.mappingSupported ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Availability by state is unavailable for this age bucket. {availability.mappingNote}
          {" "}You can still select states manually.
        </p>
      ) : availability?.stale ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Availability may be stale. Select states as a request preference; final availability is confirmed during review.
        </p>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
        <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-2 sm:p-3">
          <svg
            viewBox={GEO.viewBox}
            className="h-auto w-full"
            role="group"
            aria-label="Interactive United States availability map"
          >
            {GEO.states.map((feature) => {
              const selected = selectedStates.includes(feature.stateCode);
              const tier = byState.get(feature.stateCode) ?? "Currently unavailable";
              const disabled = !selected && atLimit;
              return (
                <path
                  key={feature.stateCode}
                  d={feature.path}
                  fill={canShowTiers ? TIER_STYLES[tier].fill : "#e2e8f0"}
                  stroke={selected ? "#0f172a" : "#ffffff"}
                  strokeWidth={selected ? 3.5 : 1.5}
                  tabIndex={disabled ? -1 : 0}
                  role="button"
                  aria-label={stateDescription(
                    feature.stateCode,
                    feature.stateName
                  )}
                  aria-pressed={selected}
                  aria-disabled={disabled}
                  data-testid={`portal-map-state-${feature.stateCode}`}
                  className={cn(
                    "transition-[filter,stroke-width] duration-150",
                    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:brightness-95"
                  )}
                  onMouseEnter={() => setFocusedState(feature.stateCode)}
                  onFocus={() => setFocusedState(feature.stateCode)}
                  onClick={() => {
                    if (!disabled) onToggleState(feature.stateCode);
                  }}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      onToggleState(feature.stateCode);
                    }
                  }}
                >
                  <title>{stateDescription(feature.stateCode, feature.stateName)}</title>
                </path>
              );
            })}
          </svg>

          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
            {(Object.keys(TIER_STYLES) as PortalInventoryAvailabilityTier[]).map((tier) => (
              <span key={tier} className="inline-flex items-center gap-1.5">
                <span
                  className="size-3 rounded-sm"
                  style={{ backgroundColor: TIER_STYLES[tier].fill }}
                />
                {TIER_STYLES[tier].label}
              </span>
            ))}
          </div>
          <div className="mt-2 min-h-10 rounded-lg bg-white px-3 py-2 text-sm text-slate-700">
            {focusedOption ? (
              <>
                <span className="font-medium text-slate-900">{focusedOption.label}</span>
                {" · "}
                {focusedTier ?? "Availability unavailable"}
                {selectedStates.includes(focusedOption.value) ? " · Selected" : ""}
              </>
            ) : (
              "Hover or focus a state for details."
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-2">
          <label htmlFor="portal-inventory-state-search" className="text-sm font-medium text-slate-900">
            Search states
          </label>
          <Input
            id="portal-inventory-state-search"
            value={query}
            placeholder="Find a state"
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-1">
            {visibleStates.map((state) => {
              const selected = selectedStates.includes(state.value);
              const disabled = !selected && atLimit;
              const tier = byState.get(state.value) ?? "Currently unavailable";
              return (
                <label
                  key={state.value}
                  className={cn(
                    "flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs",
                    selected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-800",
                    disabled && "cursor-not-allowed opacity-50"
                  )}
                  onMouseEnter={() => setFocusedState(state.value)}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected}
                    disabled={disabled}
                    aria-label={state.label}
                    onChange={() => onToggleState(state.value)}
                  />
                  <span className="min-w-0 flex-1 truncate">{state.label}</span>
                  {canShowTiers ? (
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full border",
                        selected ? "border-white" : TIER_STYLES[tier].badge
                      )}
                      style={{ backgroundColor: TIER_STYLES[tier].fill }}
                      title={tier}
                    />
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-1 border-t border-slate-200 pt-3 text-xs text-slate-500">
        {availability?.mappingSupported ? <p>{availability.mappingNote}</p> : null}
        {availability?.evaluatedAt ? (
          <p>Evaluated {new Date(availability.evaluatedAt).toLocaleString()}.</p>
        ) : null}
        <p>
          Availability is informational and is not a reservation. Tiers do not guarantee the full requested quantity of {requestedQuantity.toLocaleString()} leads. Final availability and pricing are confirmed during review; fulfillment begins only after approval.
        </p>
      </div>
    </section>
  );
}
