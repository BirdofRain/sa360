import { SectionPanel } from "@/components/dashboard/section-panel";
import type { ProofVerificationSummaryItem } from "@/lib/lead-fulfillment/types";
import { cn } from "@/lib/utils";

function toneClasses(tone: ProofVerificationSummaryItem["tone"]): string {
  switch (tone) {
    case "good":
      return "border-emerald-200 bg-emerald-50/80 text-emerald-900";
    case "warn":
      return "border-amber-200 bg-amber-50/80 text-amber-900";
    case "bad":
      return "border-red-200 bg-red-50/80 text-red-900";
    default:
      return "border-slate-200 bg-slate-50/80 text-slate-800";
  }
}

export function ProofStatusCard({ items }: { items: ProofVerificationSummaryItem[] }) {
  return (
    <SectionPanel title="Proof / verification summary">
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {items.map((item) => (
          <div
            key={item.key}
            className={cn(
              "rounded-lg border px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)]",
              toneClasses(item.tone)
            )}
          >
            <div className="text-xs font-medium opacity-80">{item.label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{item.count}</div>
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}
