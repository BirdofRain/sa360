"use client";

import { ChevronDown, Circle } from "lucide-react";

/**
 * Preserved routing/delivery prototype (checkpoint).
 * Not rendered in the Inventory Explorer beta (capabilities.showRoutingPrototype=false).
 */
import { FoDestinationPanel } from "@/components/front-office/pipeline-studio/fo-routing-destination-panel";
import { FoPipelineFooter } from "@/components/front-office/pipeline-studio/fo-pipeline-footer";
import { FoPipelineKpiBar } from "@/components/front-office/pipeline-studio/fo-pipeline-kpi-bar";
import { FoTerritoryBar } from "@/components/front-office/pipeline-studio/fo-territory-bar";
import { FoRoutingTerritoryMap } from "@/components/front-office/pipeline-studio/fo-routing-territory-map";
import { buildMetricsStrip } from "@/lib/front-office/pipeline-studio/display";
import {
  PIPELINE_STUDIO_PROTOTYPE_NOTICE,
  type PipelineStudioReadModel,
} from "@/lib/front-office/pipeline-studio/types";
import { usePipelineStudioState } from "@/lib/front-office/pipeline-studio/use-pipeline-studio-state";

export function FoRoutingStudioContent({
  model,
}: {
  model: PipelineStudioReadModel;
}) {
  const state = usePipelineStudioState(model);
  const metricCards = buildMetricsStrip({
    ...model,
    territories: state.territories,
  });
  const canPublish = model.capabilities.canPublish;
  const canSave = model.capabilities.canSaveDraft;

  return (
    <div className="pipeline-studio -m-4 min-h-[calc(100dvh-5.5rem)] rounded-none sm:-m-6">
      <div className="flex flex-col gap-2.5 p-3 sm:gap-3 sm:p-4">
        <div
          className="rounded-md border border-[var(--ps-border-strong)] bg-[var(--ps-blue)]/10 px-2.5 py-1.5 text-center text-[11px] leading-snug text-[var(--ps-blue)] sm:text-xs"
          role="status"
          data-testid="pipeline-studio-prototype-notice"
        >
          {PIPELINE_STUDIO_PROTOTYPE_NOTICE}
        </div>

        <header className="flex flex-wrap items-center justify-between gap-2 gap-y-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-[var(--ps-text)] sm:text-lg">
                {model.pipeline.name}
              </h2>
              <span className="rounded border border-[var(--ps-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ps-muted)]">
                {model.pipeline.version}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ps-green)]/30 bg-[var(--ps-green)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--ps-green)]">
                <Circle className="size-1.5 fill-current" aria-hidden />
                {model.pipeline.status === "active" ? "Active" : "Draft"}
              </span>
              <span className="text-[10px] text-[var(--ps-muted)]">
                Demo fixture · {model.dataSource}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-[var(--ps-muted)]">
              Updated{" "}
              {new Date(model.pipeline.updatedAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
              })}{" "}
              UTC
              {" · "}
              {model.origin.city}, {model.origin.state}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled
              className="ps-focus-ring ps-btn-disabled rounded-md px-2.5 py-1.5 text-xs"
              title="Settings unavailable in fixture preview"
            >
              Pipeline Settings
            </button>
            <button
              type="button"
              disabled={!canSave}
              className="ps-focus-ring ps-btn-disabled rounded-md px-2.5 py-1.5 text-xs"
              title="Save draft unavailable — canSaveDraft is false"
            >
              Save
            </button>
            <button
              type="button"
              disabled={!canPublish}
              data-testid="pipeline-studio-publish"
              aria-disabled={!canPublish}
              className="ps-focus-ring ps-btn-disabled inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium"
              title="Publish unavailable — canPublish is false"
            >
              Publish Pipeline
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </button>
          </div>
        </header>

        <FoPipelineKpiBar cards={metricCards} />

        <div className="flex min-h-0 flex-col gap-2.5 lg:flex-row lg:items-stretch">
          <div className="min-w-0 flex-1">
            <FoRoutingTerritoryMap
              mapStates={model.mapStates}
              territories={state.territories}
              routes={model.routes}
              origin={model.origin}
              state={state}
            />
          </div>
          <FoDestinationPanel
            destinations={state.destinations}
            connectors={model.connectors}
            rules={model.rules}
            state={state}
          />
        </div>

        <FoTerritoryBar state={state} />
        <FoPipelineFooter metrics={model.metrics} compliance={model.compliance} />
      </div>
    </div>
  );
}
