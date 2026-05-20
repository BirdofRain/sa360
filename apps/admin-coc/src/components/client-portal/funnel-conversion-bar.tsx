import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ClientPortalFunnel } from "@/lib/client-portal/types";
import { formatPercent } from "@/lib/client-portal/map-client-dashboard";
import { cn } from "@/lib/utils";

type BarSegment = {
  label: string;
  rate: number;
  color: string;
};

export function FunnelConversionBar({ funnel }: { funnel: ClientPortalFunnel }) {
  const segments: BarSegment[] = [
    { label: "Reply rate", rate: funnel.conversion.replyRate, color: "bg-sky-500" },
    { label: "Set rate", rate: funnel.conversion.setRate, color: "bg-indigo-500" },
    { label: "Show rate", rate: funnel.conversion.showRate, color: "bg-violet-500" },
    { label: "Close rate", rate: funnel.conversion.soldRate, color: "bg-emerald-500" },
  ];

  return (
    <SectionPanel title="Conversion snapshot">
      <div className="space-y-4 p-4">
        <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
          {segments.map((seg, i) => {
            const width = Math.max(seg.rate * 100, seg.rate > 0 ? 4 : 0);
            return (
              <div
                key={seg.label}
                className={cn(seg.color, i > 0 && "border-l border-white/40")}
                style={{ width: `${Math.min(width, 100)}%` }}
                title={`${seg.label}: ${formatPercent(seg.rate)}`}
              />
            );
          })}
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {segments.map((seg) => (
            <div key={seg.label}>
              <dt className="text-xs text-slate-500">{seg.label}</dt>
              <dd className="text-lg font-medium text-slate-900">{formatPercent(seg.rate)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-400">
          Percentages are based on leads in the selected period — reply and set rates use all
          leads; show and close rates use appointments in each step.
        </p>
      </div>
    </SectionPanel>
  );
}
