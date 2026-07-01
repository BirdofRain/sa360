import { cn } from "@/lib/utils";
import { KPI_TONE_CLASS } from "@/lib/front-office/display";
import type { FrontOfficeDashboardKpi } from "@/lib/front-office/types";

export function FoKpiGrid({ kpis }: { kpis: FrontOfficeDashboardKpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
      {kpis.map((kpi) => (
        <div
          key={kpi.key}
          className="rounded-xl border border-slate-200 bg-gradient-to-t from-slate-900/[0.03] to-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]"
        >
          <p className="text-xs text-slate-500">{kpi.label}</p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              kpi.tone ? KPI_TONE_CLASS[kpi.tone] : "text-slate-900"
            )}
          >
            {kpi.value}
          </p>
          {kpi.delta ? (
            <p className="mt-1 text-[11px] text-slate-500">{kpi.delta}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
