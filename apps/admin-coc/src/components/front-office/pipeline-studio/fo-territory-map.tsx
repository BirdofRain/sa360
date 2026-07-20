"use client";

import {
  Crosshair,
  Hand,
  Minus,
  MousePointer2,
  Plus,
  Route,
  Trash2,
} from "lucide-react";

import {
  isTerritoryInteractive,
  PS_ROUTE_DISPLAY,
} from "@/lib/front-office/pipeline-studio/display";
import type { PipelineStudioLocalState } from "@/lib/front-office/pipeline-studio/use-pipeline-studio-state";
import type {
  MapViewMode,
  PipelineStudioMapState,
  PipelineStudioReadModel,
  PipelineStudioRoute,
  PipelineStudioTerritory,
} from "@/lib/front-office/pipeline-studio/types";
import { cn } from "@/lib/utils";

const VIEW_MODES: { id: MapViewMode; label: string }[] = [
  { id: "states", label: "States" },
  { id: "regions", label: "Regions" },
  { id: "markets", label: "Markets" },
  { id: "heatmap", label: "Heatmap" },
];

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - 28;
  return `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`;
}

export function FoTerritoryMap({
  mapStates,
  territories,
  routes,
  origin,
  state,
}: {
  mapStates: PipelineStudioMapState[];
  territories: PipelineStudioTerritory[];
  routes: PipelineStudioRoute[];
  origin: PipelineStudioReadModel["origin"];
  state: PipelineStudioLocalState;
}) {
  const territoryByCode = new Map(territories.map((t) => [t.stateCode, t]));

  const hubLabel = `${origin.city}, ${origin.state} · HQ`;

  return (
    <section
      className="ps-card relative flex min-h-[420px] flex-col overflow-hidden lg:min-h-[520px]"
      aria-label="Territory map"
    >
      <div className="flex items-center justify-between border-b border-[var(--ps-border)] px-2.5 py-1.5">
        <p className="text-[11px] font-medium text-[var(--ps-muted)]">
          Routing canvas · fixture preview
        </p>
        <div className="hidden items-center gap-3 text-[10px] text-[var(--ps-muted)] sm:flex">
          {(Object.keys(PS_ROUTE_DISPLAY) as Array<keyof typeof PS_ROUTE_DISPLAY>).map(
            (kind) => (
              <span key={kind} className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block h-0.5 w-4 rounded"
                  style={{
                    background: PS_ROUTE_DISPLAY[kind].stroke,
                    opacity: kind === "backup" ? 0.7 : 1,
                  }}
                />
                {PS_ROUTE_DISPLAY[kind].label}
              </span>
            )
          )}
        </div>
      </div>

      <div className="relative flex-1">
        <div
          className="absolute left-2 top-2 z-10 flex flex-col gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)]/90 p-1"
          role="toolbar"
          aria-label="Map tools (preview)"
        >
          {[
            { icon: MousePointer2, label: "Select" },
            { icon: Hand, label: "Pan" },
            { icon: Crosshair, label: "Focus" },
            { icon: Route, label: "Route" },
            { icon: Trash2, label: "Clear" },
          ].map(({ icon: Icon, label }) => (
            <button
              key={label}
              type="button"
              disabled
              title={`${label} (preview)`}
              className="ps-focus-ring rounded-md p-1.5 text-[var(--ps-muted)] opacity-60"
              aria-label={`${label} tool unavailable in preview`}
            >
              <Icon className="size-3.5" aria-hidden />
            </button>
          ))}
        </div>

        <div className="absolute right-2 top-2 z-10 w-[132px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)]/90 p-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-muted)]">
            View
          </p>
          <div
            className="flex flex-col gap-0.5"
            role="radiogroup"
            aria-label="Map view mode"
          >
            {VIEW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="radio"
                aria-checked={state.mapView === mode.id}
                onClick={() => state.setMapView(mode.id)}
                className={cn(
                  "ps-focus-ring rounded-md px-2 py-1 text-left text-xs transition-colors",
                  state.mapView === mode.id
                    ? "bg-[var(--ps-blue)]/15 text-[var(--ps-blue)]"
                    : "text-[var(--ps-muted)] hover:bg-white/5 hover:text-[var(--ps-text)]"
                )}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>

        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden p-4 pt-8"
          style={{
            transform: `scale(${state.zoom})`,
            transformOrigin: "center center",
            transition: "transform 160ms ease",
          }}
        >
          <svg
            viewBox="0 0 1000 620"
            className="h-full w-full max-h-[480px] lg:max-h-[520px]"
            role="img"
            aria-label="Stylized United States territory map"
          >
            <defs>
              <filter id="ps-glow" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="ps-state-fill" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00d1ff" stopOpacity="0.55" />
                <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.45" />
              </linearGradient>
            </defs>

            {mapStates.map((s) => {
              const territory = territoryByCode.get(s.code);
              const interactive = territory
                ? isTerritoryInteractive(territory)
                : false;
              const selected = Boolean(territory?.selected && interactive);
              const isFocus = s.focus;
              return (
                <path
                  key={s.code}
                  d={s.path}
                  tabIndex={interactive ? 0 : -1}
                  role={territory ? "button" : undefined}
                  aria-label={
                    territory
                      ? `${s.name}, ${selected ? "selected" : "not selected"}`
                      : s.name
                  }
                  aria-pressed={territory ? selected : undefined}
                  onClick={() => {
                    if (interactive) state.toggleTerritory(s.code);
                  }}
                  onKeyDown={(e) => {
                    if (!interactive) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      state.toggleTerritory(s.code);
                    }
                  }}
                  className={cn(
                    "ps-focus-ring ps-map-path stroke-[1.2]",
                    interactive ? "cursor-pointer" : "cursor-default"
                  )}
                  fill={
                    selected
                      ? "url(#ps-state-fill)"
                      : isFocus
                        ? "rgba(56, 189, 248, 0.12)"
                        : "rgba(30, 41, 59, 0.85)"
                  }
                  stroke={
                    selected
                      ? "var(--ps-blue)"
                      : state.selectedTerritoryCode === s.code
                        ? "var(--ps-purple)"
                        : "rgba(100, 116, 139, 0.55)"
                  }
                  filter={selected ? "url(#ps-glow)" : undefined}
                  opacity={
                    state.mapView === "regions" && !isFocus && !selected
                      ? 0.35
                      : state.mapView === "markets" && !selected
                        ? 0.4
                        : 1
                  }
                />
              );
            })}

            {routes.map((route) => {
              const from = territoryByCode.get(route.fromCode);
              const to = territoryByCode.get(route.toCode);
              if (!from || !to) return null;
              if (!from.selected || !to.selected) return null;
              const style = PS_ROUTE_DISPLAY[route.kind];
              return (
                <path
                  key={route.id}
                  d={curvePath(from.mapX, from.mapY, to.mapX, to.mapY)}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={route.kind === "primary" ? 2 : 1.4}
                  strokeDasharray={style.dasharray}
                  opacity={0.85}
                  filter="url(#ps-glow)"
                />
              );
            })}

            {territories
              .filter((t) => t.selected && isTerritoryInteractive(t))
              .map((t) => (
                <g key={`node-${t.stateCode}`}>
                  <circle
                    cx={t.mapX}
                    cy={t.mapY}
                    r={5}
                    fill="var(--ps-blue)"
                    filter="url(#ps-glow)"
                  />
                  <circle cx={t.mapX} cy={t.mapY} r={2} fill="#fff" />
                  <text
                    x={t.mapX}
                    y={t.mapY + 16}
                    textAnchor="middle"
                    className="ps-map-label"
                  >
                    {t.stateCode}
                  </text>
                </g>
              ))}

            <g>
              <circle
                cx={origin.mapX}
                cy={origin.mapY}
                r={8}
                fill="var(--ps-purple)"
                filter="url(#ps-glow)"
              />
              <circle cx={origin.mapX} cy={origin.mapY} r={3} fill="#fff" />
              <text
                x={origin.mapX}
                y={origin.mapY - 14}
                textAnchor="middle"
                className="ps-map-label"
              >
                {hubLabel}
              </text>
            </g>
          </svg>
        </div>

        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)]/95 p-1">
          <button
            type="button"
            onClick={state.zoomOut}
            className="ps-focus-ring rounded-md p-1.5 text-[var(--ps-text)] hover:bg-white/5"
            aria-label="Zoom out"
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            onClick={state.resetView}
            className="ps-focus-ring rounded-md px-2 py-1 text-xs text-[var(--ps-muted)] hover:bg-white/5 hover:text-[var(--ps-text)]"
          >
            Reset View
          </button>
          <button
            type="button"
            onClick={state.zoomIn}
            className="ps-focus-ring rounded-md p-1.5 text-[var(--ps-text)] hover:bg-white/5"
            aria-label="Zoom in"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </section>
  );
}
