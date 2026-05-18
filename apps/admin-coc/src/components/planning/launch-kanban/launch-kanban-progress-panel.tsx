"use client";

import { AlertTriangle, CalendarDays, CheckCircle2, LayoutGrid } from "lucide-react";

import { cn } from "@/lib/utils";

import { computeBoardProgress, computeWorkstreamProgress } from "./launch-kanban-metrics";
import type { LaunchKanbanCard } from "./launch-kanban-types";

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "warn" | "danger" | "ok";
}) {
  const toneCls =
    tone === "danger"
      ? "text-red-700"
      : tone === "warn"
        ? "text-amber-800"
        : tone === "ok"
          ? "text-emerald-700"
          : "text-slate-900";
  return (
    <div className="min-w-[92px] flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-[0_1px_0_rgba(15,23,42,0.03)]">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={cn("text-lg font-semibold tabular-nums leading-tight", toneCls)}>{value}</div>
    </div>
  );
}

export function LaunchKanbanProgressPanel({ cards }: { cards: LaunchKanbanCard[] }) {
  const now = new Date();
  const s = computeBoardProgress(cards, now);
  const streams = computeWorkstreamProgress(cards);

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 pb-3">
        <LayoutGrid className="size-4 text-slate-400" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-800">Board progress</h2>
        <span className="text-[11px] text-slate-400">
          Week starts Monday · Due Soon = next 3 days (active tasks)
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Stat label="Total tasks" value={s.total} />
        <Stat label="Done" value={s.done} tone="ok" />
        <Stat label="Blocked" value={s.blocked} tone={s.blocked > 0 ? "warn" : "default"} />
        <Stat label="% Complete" value={`${s.percentComplete}%`} tone="ok" />
        <Stat label="Overdue" value={s.overdue} tone={s.overdue > 0 ? "danger" : "default"} />
        <Stat label="Due this week" value={s.dueThisWeek} tone={s.dueThisWeek > 0 ? "warn" : "default"} />
      </div>

      <details open className="group rounded-lg border border-slate-100 bg-slate-50/50">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700 [&::-webkit-details-marker]:hidden">
          Workstreams ({streams.length}) — tap to expand/collapse
        </summary>
        <div className="overflow-x-auto px-2 pb-2 pt-1">
          <table className="w-full min-w-[520px] border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-3 font-medium">Workstream</th>
                <th className="py-1.5 pr-3 font-medium tabular-nums">Total</th>
                <th className="py-1.5 pr-3 font-medium tabular-nums">Done</th>
                <th className="py-1.5 pr-3 font-medium tabular-nums">Blocked</th>
                <th className="py-1.5 pr-12 font-medium">Complete</th>
              </tr>
            </thead>
            <tbody>
              {streams.map((row) => (
                <tr key={row.workstream} className="border-b border-slate-100 last:border-0">
                  <td className="max-w-[200px] truncate py-1.5 pr-3 font-medium text-slate-800">
                    {row.workstream}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">{row.total}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-emerald-700">{row.done}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-slate-600">{row.blocked}</td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 min-w-[72px] flex-1 overflow-hidden rounded-full bg-slate-200">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-[width]"
                          style={{ width: `${row.percentComplete}%` }}
                        />
                      </div>
                      <span className="w-9 shrink-0 tabular-nums text-slate-600">{row.percentComplete}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-[10px] text-slate-500">
        <li className="inline-flex items-center gap-1">
          <CheckCircle2 className="size-3 text-emerald-500" aria-hidden />
          Done column
        </li>
        <li className="inline-flex items-center gap-1">
          <CalendarDays className="size-3 text-amber-500" aria-hidden />
          Due soon
        </li>
        <li className="inline-flex items-center gap-1">
          <AlertTriangle className="size-3 text-red-500" aria-hidden />
          Overdue
        </li>
      </ul>
    </div>
  );
}
