import { PS_KPI_TONE_CLASS } from "@/lib/front-office/pipeline-studio/display";
import type {
  PipelineStudioCompliance,
  PipelineStudioMetrics,
} from "@/lib/front-office/pipeline-studio/types";
import { cn } from "@/lib/utils";

export function FoPipelineFooter({
  metrics,
  compliance,
}: {
  metrics: PipelineStudioMetrics;
  compliance: PipelineStudioCompliance;
}) {
  return (
    <footer
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg-elevated)] px-2.5 py-1.5 text-[10px] text-[var(--ps-muted)] sm:text-[11px]"
      aria-label="Delivery health"
    >
      <span>
        Pipeline Health:{" "}
        <span className={cn("font-medium", PS_KPI_TONE_CLASS.good)}>
          {metrics.routeHealth}
        </span>
      </span>
      <span className="hidden h-3 w-px bg-[var(--ps-border)] sm:inline" aria-hidden />
      <span>
        Live Connections:{" "}
        <span className="font-medium text-[var(--ps-text)]">
          {metrics.activeConnectionCount} Active
        </span>
      </span>
      <span className="hidden h-3 w-px bg-[var(--ps-border)] sm:inline" aria-hidden />
      <span>
        Last 7 Days:{" "}
        <span className="font-medium text-[var(--ps-text)]">
          {metrics.deliveredLastSevenDays.toLocaleString("en-US")} Leads
        </span>
      </span>
      <span className="hidden h-3 w-px bg-[var(--ps-border)] sm:inline" aria-hidden />
      <span>
        Avg Speed:{" "}
        <span className="font-medium text-[var(--ps-text)]">
          {metrics.averageSpeedToLeadSeconds}s
        </span>
      </span>
      <span className="hidden h-3 w-px bg-[var(--ps-border)] sm:inline" aria-hidden />
      <span>
        Compliance:{" "}
        <span className="font-medium text-[var(--ps-text)]">{compliance.status}</span>
      </span>
      <span className="sm:ml-auto">Demo · no live writes</span>
    </footer>
  );
}
