import type { LucideIcon } from "lucide-react";

import { StatTile } from "@/components/dashboard/stat-tile";
import type { LeadFulfillmentKpi } from "@/lib/lead-fulfillment/types";
import { cn } from "@/lib/utils";

/** KPI tile with optional icon — gradient card styling inspired by shadcn dashboard starter overview KPIs. */
export function LeadFulfillmentStatCard({
  kpi,
  icon: Icon,
  className,
}: {
  kpi: LeadFulfillmentKpi;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "@container/card rounded-xl border border-slate-200 bg-gradient-to-t from-slate-900/[0.03] to-white shadow-[0_1px_0_rgba(15,23,42,0.04)]",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2 p-4 pb-0">
        <div className="text-xs text-slate-500">{kpi.label}</div>
        {Icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Icon className="size-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <StatTile
        label=""
        value={kpi.value}
        delta={kpi.delta}
        tone={kpi.tone}
        hint={kpi.hint}
        className="border-0 bg-transparent p-4 pt-2 shadow-none [&>div:first-child]:hidden [&>div:nth-child(2)>div:first-child]:text-2xl [&>div:nth-child(2)>div:first-child]:font-semibold [&>div:nth-child(2)>div:first-child]:tabular-nums @[250px]/card:[&>div:nth-child(2)>div:first-child]:text-3xl"
      />
    </div>
  );
}

export function LeadFulfillmentStatGrid({
  kpis,
  icons,
}: {
  kpis: LeadFulfillmentKpi[];
  icons?: Partial<Record<LeadFulfillmentKpi["key"], LucideIcon>>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
      {kpis.map((kpi) => (
        <LeadFulfillmentStatCard key={kpi.key} kpi={kpi} icon={icons?.[kpi.key]} />
      ))}
    </div>
  );
}
