"use client";

import { cn } from "@/lib/utils";
import {
  MILESTONE_LABELS,
  MILESTONE_STATUS_DOT,
  formatDateTime,
} from "@/lib/front-office/display";
import type { LeadDeliveryTimelineEntry } from "@/lib/front-office/types";

export function FoMilestoneTimeline({
  entries,
  compact = false,
}: {
  entries: LeadDeliveryTimelineEntry[];
  compact?: boolean;
}) {
  return (
    <ol className={cn("space-y-0", compact ? "text-xs" : "text-sm")}>
      {entries.map((entry) => (
        <li key={entry.milestone} className="relative flex gap-3 pb-4 last:pb-0">
          <span
            className={cn(
              "relative z-10 mt-1.5 size-2 shrink-0 rounded-full ring-2 ring-white",
              MILESTONE_STATUS_DOT[entry.status]
            )}
            aria-hidden
          />
          <div className="min-w-0 flex-1 border-l border-slate-100 pl-0 last:border-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium text-slate-800">
                {MILESTONE_LABELS[entry.milestone] ?? entry.milestone}
              </span>
              {entry.at ? (
                <span className="text-[11px] text-slate-400">{formatDateTime(entry.at)}</span>
              ) : null}
            </div>
            {entry.detail ? (
              <p className="mt-0.5 text-slate-500">{entry.detail}</p>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
