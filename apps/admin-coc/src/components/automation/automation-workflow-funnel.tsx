import { AlertTriangle } from "lucide-react";

import type { AutomationWorkflowCheckpoint } from "@/lib/admin-api/types";

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

export function AutomationWorkflowFunnel({
  checkpoints,
}: {
  checkpoints: AutomationWorkflowCheckpoint[];
}) {
  if (checkpoints.length === 0) {
    return <p className="px-4 py-6 text-sm text-slate-500">No checkpoint data for this range.</p>;
  }

  return (
    <ol className="divide-y divide-slate-100">
      {checkpoints.map((step, i) => {
        const prior = i > 0 ? checkpoints[i - 1] : null;
        const dropWarning =
          prior != null && prior.count > 0 && step.count === 0 && step.eventName !== "signal_sent";

        return (
          <li
            key={step.eventName}
            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 items-center gap-2">
              {dropWarning ? (
                <AlertTriangle className="size-4 shrink-0 text-amber-500" aria-hidden />
              ) : (
                <span className="size-4 shrink-0 rounded-full bg-slate-200" aria-hidden />
              )}
              <div>
                <div className="text-sm font-medium text-slate-800">{step.label}</div>
                <div className="font-mono text-xs text-slate-400">{step.eventName}</div>
              </div>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span className="font-medium text-slate-900">{step.count.toLocaleString()}</span>
              <span className="text-slate-500">
                {step.percentageOfLeads != null ? `${step.percentageOfLeads}% of leads` : "—"}
              </span>
              {step.failedCount != null && step.failedCount > 0 ? (
                <span className="text-red-600">{step.failedCount} failed</span>
              ) : null}
              <span className="text-xs text-slate-400">Last: {formatWhen(step.lastEventAt)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
