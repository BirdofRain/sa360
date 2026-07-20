"use client";

import { useMemo } from "react";

import {
  fulfillmentLabel,
  statusStroke,
  volumeFill,
} from "@/lib/front-office/pipeline-studio/inventory-display";
import type { DerivedStateInventory } from "@/lib/front-office/pipeline-studio/inventory-types";
import usStatesGeo from "@/lib/front-office/pipeline-studio/geo/us-states-albers.svg.json";
import { cn } from "@/lib/utils";

type GeoFeature = {
  stateCode: string;
  stateName: string;
  path: string;
};

type GeoAsset = {
  viewBox: string;
  states: GeoFeature[];
};

const GEO = usStatesGeo as GeoAsset;

/** Approximate Albers-USA label anchors for continental timezone bands (decorative only). */
const TZ_BAND_LABELS: { label: string; x: number; y: number }[] = [
  { label: "Pacific", x: 120, y: 42 },
  { label: "Mountain", x: 280, y: 42 },
  { label: "Central", x: 470, y: 42 },
  { label: "Eastern", x: 700, y: 42 },
];

export function FoTerritoryMap({
  states,
  focusedStateCode,
  onFocusState,
}: {
  states: DerivedStateInventory[];
  focusedStateCode: string | null;
  onFocusState: (code: string) => void;
}) {
  const byCode = useMemo(
    () => new Map(states.map((s) => [s.stateCode, s])),
    [states]
  );

  return (
    <section
      className="ps-card relative flex min-h-[300px] flex-col overflow-hidden sm:min-h-[360px] lg:min-h-[min(48vh,480px)]"
      aria-label="United States inventory map"
      data-testid="inventory-explorer-map"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] px-3 py-2">
        <p className="text-xs font-medium text-[var(--ps-muted)]">
          Inventory volume by state · order-fit outline
        </p>
        <p className="text-xs text-[var(--ps-muted)]">
          Static map · no live requests
        </p>
      </div>

      <div className="relative min-h-0 flex-1 p-2 sm:p-3">
        <svg
          viewBox={GEO.viewBox}
          className="h-full w-full max-h-[560px]"
          role="img"
          aria-label="US states colored by filtered lead inventory"
        >
          <defs>
            <pattern
              id="ie-hatch"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="rgba(30, 41, 59, 0.95)" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="rgba(148, 163, 184, 0.45)"
                strokeWidth="1.5"
              />
            </pattern>
          </defs>

          {TZ_BAND_LABELS.map((band) => (
            <text
              key={band.label}
              x={band.x}
              y={band.y}
              fill="rgba(139, 151, 173, 0.55)"
              fontSize="11"
              fontFamily="system-ui, sans-serif"
              letterSpacing="0.08em"
              textAnchor="middle"
              pointerEvents="none"
            >
              {band.label.toUpperCase()}
            </text>
          ))}

          {GEO.states.map((feature) => {
            const inv = byCode.get(feature.stateCode);
            const fill = inv
              ? volumeFill(inv.relativeVolumeBand)
              : "url(#ie-hatch)";
            const stroke = inv
              ? statusStroke(inv.fulfillmentStatus)
              : statusStroke("unknown");
            const focused = focusedStateCode === feature.stateCode;
            const selected = inv?.selected ?? false;
            const title = inv
              ? `${feature.stateName} (${feature.stateCode}): ${
                  inv.dataStatus === "unknown"
                    ? "inventory unknown"
                    : `${inv.filteredAvailable} matching · ${fulfillmentLabel(inv.fulfillmentStatus)}`
                }${
                  inv.timezoneStatus === "mixed" ? " · Mixed timezone" : ""
                }`
              : feature.stateName;

            return (
              <g key={feature.stateCode}>
                <path
                  d={feature.path}
                  fill={fill}
                  stroke={focused ? "var(--ps-blue)" : stroke.stroke}
                  strokeWidth={focused ? 2.4 : stroke.width}
                  strokeDasharray={stroke.dasharray}
                  className={cn(
                    "cursor-pointer transition-[stroke-width,filter] duration-150",
                    selected && "brightness-110"
                  )}
                  tabIndex={0}
                  role="button"
                  aria-label={title}
                  aria-pressed={focused}
                  data-state-code={feature.stateCode}
                  data-testid={`map-state-${feature.stateCode}`}
                  onClick={() => onFocusState(feature.stateCode)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onFocusState(feature.stateCode);
                    }
                  }}
                >
                  <title>{title}</title>
                </path>
              </g>
            );
          })}
        </svg>
      </div>

      <div
        className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-[var(--ps-border)] px-3 py-2 text-xs text-[var(--ps-muted)]"
        data-testid="inventory-map-legend"
      >
        <span className="font-medium text-[var(--ps-text)]/80">Legend:</span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm"
            style={{ background: "rgba(0, 209, 255, 0.55)" }}
          />
          Fill = inventory volume
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm border-2 border-[#34d399] bg-transparent"
          />
          Outline = order-fit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block size-3 rounded-sm"
            style={{
              background:
                "repeating-linear-gradient(45deg,#1e293b,#1e293b 2px,#94a3b8 2px,#94a3b8 3px)",
            }}
          />
          Hatched = data unavailable
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-[#34d399]" /> Strong/available
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-[#fbbf24]" /> Partial
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-[#a78bfa]" /> Custom review
        </span>
      </div>
    </section>
  );
}
