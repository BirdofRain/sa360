/**
 * Shared status vocabulary for internal C.O.C. planning surfaces
 * (Architecture Map, Workflow Map).
 */

export const PLANNING_STATUSES = [
  "LIVE",
  "BETA",
  "BUILDING",
  "NEXT",
  "PRIORITY",
  "FUTURE",
  "DISABLED IN PROD",
  "EXPLORING",
  "LEGACY / RETAINER ONLY",
  "DEPRECATED / DO NOT BUILD",
] as const;

export type PlanningStatus = (typeof PLANNING_STATUSES)[number];

export const PLANNING_STATUS_TONE: Record<PlanningStatus, string> = {
  LIVE: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200",
  BETA: "bg-violet-50 text-violet-800 ring-1 ring-inset ring-violet-200",
  BUILDING: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200",
  NEXT: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200",
  PRIORITY: "bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200",
  FUTURE: "bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200",
  "DISABLED IN PROD":
    "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200",
  EXPLORING: "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200",
  "LEGACY / RETAINER ONLY":
    "bg-zinc-100 text-zinc-700 ring-1 ring-inset ring-zinc-300",
  "DEPRECATED / DO NOT BUILD":
    "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200",
};

export function planningStatusTone(status: string): string {
  return (
    PLANNING_STATUS_TONE[status as PlanningStatus] ??
    "bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200"
  );
}
