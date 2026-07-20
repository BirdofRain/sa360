import { PS_KPI_TONE_CLASS } from "@/lib/front-office/pipeline-studio/display";
import type { PipelineStudioMetricCard } from "@/lib/front-office/pipeline-studio/types";
import { cn } from "@/lib/utils";

export function FoPipelineKpiBar({ cards }: { cards: PipelineStudioMetricCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
      {cards.map((card) => (
        <div key={card.key} className="ps-card px-2.5 py-2">
          <p className="text-[9px] font-medium uppercase tracking-wider text-[var(--ps-muted)]">
            {card.label}
          </p>
          <p
            className={cn(
              "mt-0.5 text-lg font-semibold tracking-tight leading-none",
              PS_KPI_TONE_CLASS[card.tone ?? "neutral"]
            )}
          >
            {card.value}
          </p>
          {card.trend ? (
            <p className="mt-0.5 text-[10px] text-[var(--ps-green)]">{card.trend}</p>
          ) : null}
          {card.detail ? (
            <p className="mt-0.5 text-[10px] text-[var(--ps-muted)]">{card.detail}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
