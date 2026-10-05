"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import usStatesGeo from "@/lib/front-office/pipeline-studio/geo/us-states-albers.svg.json";
import {
  PORTAL_INVENTORY_MAP_ADVISORY_LINE,
  formatPortalInventorySelectionSummary,
  parsePortalInventoryMapPayload,
  portalInventoryMapFill,
  portalInventoryMapFreshnessLabel,
  portalInventoryMapIsEmpty,
  portalInventoryMapRequestPath,
  portalInventoryMapTone,
  portalInventoryMapToneLabel,
  summarizePortalInventorySelection,
  type PortalInventoryMapLoadResult,
  type PortalInventoryMapModel,
} from "@/lib/client-portal/portal-inventory-map";
import { cn } from "@/lib/utils";

type GeoFeature = { stateCode: string; stateName: string; path: string };
type GeoAsset = { viewBox: string; states: GeoFeature[] };

/** Same pre-projected Albers USA geometry as the Admin inventory explorer — no map network requests. */
const GEO = usStatesGeo as GeoAsset;

export type PortalInventoryMapQuery = {
  nicheKey: string | null;
  productType: string | null;
};

export type PortalInventoryMapLoader = (
  query: PortalInventoryMapQuery,
  signal: AbortSignal
) => Promise<PortalInventoryMapLoadResult>;

const GENERIC_ERROR = "We could not check live availability. You can still choose states.";

async function defaultLoadAvailability(
  query: PortalInventoryMapQuery,
  signal: AbortSignal
): Promise<PortalInventoryMapLoadResult> {
  const res = await fetch(portalInventoryMapRequestPath(query), {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) return { ok: false, error: GENERIC_ERROR };
  const model = parsePortalInventoryMapPayload(json);
  if (!model) return { ok: false, error: GENERIC_ERROR };
  return { ok: true, model };
}

type LoadState =
  | { status: "loading"; model: PortalInventoryMapModel | null }
  | { status: "ready"; model: PortalInventoryMapModel }
  | { status: "error"; error: string; model: PortalInventoryMapModel | null };

function LegendSwatch({ fill, label }: { fill: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block size-3 rounded-sm border border-slate-300"
        style={{ background: fill }}
      />
      {label}
    </span>
  );
}

/**
 * Advisory live inventory map for the portal order request.
 *
 * - Clicking a state only toggles it in the parent's draft (no network writes).
 * - Availability is fetched through the session-scoped BFF; the browser never
 *   receives counts, pricing, or item identifiers.
 * - The map stays usable as a state picker in loading and error states.
 */
export function PortalInventoryMap({
  nicheKey,
  productType = null,
  nicheLabel,
  selectedStates,
  onToggleState,
  atSelectionLimit = false,
  loadAvailability = defaultLoadAvailability,
}: {
  nicheKey: string | null;
  productType?: string | null;
  nicheLabel?: string;
  selectedStates: readonly string[];
  onToggleState: (stateCode: string) => void;
  atSelectionLimit?: boolean;
  loadAvailability?: PortalInventoryMapLoader;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading", model: null });
  const [reloadToken, setReloadToken] = useState(0);
  const latestModel = useRef<PortalInventoryMapModel | null>(null);
  // Loader identity must not retrigger fetches (callers may pass inline functions).
  const loaderRef = useRef<PortalInventoryMapLoader>(loadAvailability);
  useEffect(() => {
    loaderRef.current = loadAvailability;
  }, [loadAvailability]);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState({ status: "loading", model: latestModel.current });
    (async () => {
      try {
        const result = await loaderRef.current({ nicheKey, productType }, controller.signal);
        if (cancelled) return;
        if (result.ok) {
          latestModel.current = result.model;
          setState({ status: "ready", model: result.model });
        } else {
          setState({ status: "error", error: result.error, model: latestModel.current });
        }
      } catch {
        if (cancelled) return;
        setState({ status: "error", error: GENERIC_ERROR, model: latestModel.current });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nicheKey, productType, reloadToken]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  // Keep the last good model while reloading (no flicker); never show stale tones under an error.
  const model = state.status === "error" ? null : state.model;
  const selected = useMemo(() => new Set(selectedStates), [selectedStates]);
  const selectionSummary = useMemo(
    () => formatPortalInventorySelectionSummary(summarizePortalInventorySelection(model, selectedStates)),
    [model, selectedStates]
  );
  const freshness = model ? portalInventoryMapFreshnessLabel(model.evaluatedAt) : null;
  const live = state.status === "ready" && state.model.dataStatus === "live";
  const empty = state.status === "ready" && portalInventoryMapIsEmpty(state.model);
  const subjectLabel = nicheLabel?.trim() || nicheKey?.trim() || "this lead type";

  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-label="Live inventory availability by state"
      aria-busy={state.status === "loading"}
      data-testid="portal-inventory-map"
      data-status={state.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-3 py-2.5 sm:px-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-900">Live availability by state</p>
          <p className="text-xs text-slate-500">
            {state.status === "loading"
              ? "Checking live availability…"
              : live
                ? `Showing ${subjectLabel}${freshness ? ` · ${freshness}` : ""}`
                : "Availability unknown right now"}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-9"
          disabled={state.status === "loading"}
          onClick={retry}
        >
          Refresh
        </Button>
      </div>

      {state.status === "error" ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 sm:px-4"
        >
          <span>{state.error}</span>
          <button
            type="button"
            className="min-h-8 font-medium underline-offset-2 hover:underline"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      ) : null}

      {state.status === "ready" && !live ? (
        <div
          role="status"
          className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:px-4"
        >
          Live availability could not be computed. The map still works as a state picker.
        </div>
      ) : null}

      {state.status === "ready" && live && empty ? (
        <div
          role="status"
          className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:px-4"
          data-testid="portal-inventory-map-empty"
        >
          No live inventory for {subjectLabel} in any state right now. You can still request
          states; your SA360 team confirms what can be filled during review.
        </div>
      ) : null}

      <div className="relative min-w-0 p-2 sm:p-3">
        <svg
          viewBox={GEO.viewBox}
          className={cn(
            "h-auto w-full max-h-[420px] transition-opacity duration-150",
            state.status === "loading" && "opacity-60"
          )}
          role="group"
          aria-label="Select states on the map"
        >
          <defs>
            <pattern
              id="portal-map-unknown"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#f1f5f9" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#cbd5e1" strokeWidth="1.5" />
            </pattern>
          </defs>
          {GEO.states.map((feature) => {
            const tone = portalInventoryMapTone(model, feature.stateCode);
            const isSelected = selected.has(feature.stateCode);
            const disabled = !isSelected && atSelectionLimit;
            const title = `${feature.stateName} (${feature.stateCode}): ${portalInventoryMapToneLabel(tone)}${
              isSelected ? " · selected" : ""
            }`;
            return (
              <path
                key={feature.stateCode}
                d={feature.path}
                fill={portalInventoryMapFill(tone)}
                stroke={isSelected ? "#0f172a" : "#ffffff"}
                strokeWidth={isSelected ? 2.2 : 0.8}
                strokeLinejoin="round"
                className={cn(
                  "outline-none transition-[stroke-width] duration-150 focus-visible:stroke-sky-600",
                  disabled ? "cursor-not-allowed" : "cursor-pointer hover:brightness-95"
                )}
                tabIndex={0}
                role="button"
                aria-label={title}
                aria-pressed={isSelected}
                aria-disabled={disabled || undefined}
                data-state-code={feature.stateCode}
                data-tone={tone}
                data-testid={`portal-map-state-${feature.stateCode}`}
                onClick={() => {
                  if (!disabled) onToggleState(feature.stateCode);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    if (!disabled) onToggleState(feature.stateCode);
                  }
                }}
              >
                <title>{title}</title>
              </path>
            );
          })}
        </svg>
      </div>

      <div className="space-y-1.5 border-t border-slate-100 px-3 py-2.5 text-xs text-slate-600 sm:px-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1.5" data-testid="portal-inventory-map-legend">
          <LegendSwatch fill={portalInventoryMapFill("Available")} label="Available" />
          <LegendSwatch fill={portalInventoryMapFill("Limited")} label="Limited" />
          <LegendSwatch
            fill={portalInventoryMapFill("Currently unavailable")}
            label="Currently unavailable"
          />
          <LegendSwatch
            fill="repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 2px,#cbd5e1 2px,#cbd5e1 3px)"
            label="Unknown"
          />
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block size-3 rounded-sm border-2 border-slate-900 bg-white"
            />
            Selected
          </span>
        </div>
        {selectionSummary ? (
          <p data-testid="portal-inventory-map-selection">
            Selected states: {selectionSummary}
          </p>
        ) : null}
        <p className="text-slate-500">{PORTAL_INVENTORY_MAP_ADVISORY_LINE}</p>
      </div>
    </section>
  );
}
