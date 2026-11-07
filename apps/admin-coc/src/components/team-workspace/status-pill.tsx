import { cn } from "@/lib/utils";
import type { TeamWorkspaceStepStatus } from "@/lib/team-workspace/types";

const LABEL: Record<TeamWorkspaceStepStatus, string> = {
  complete: "Complete",
  blocked: "Blocked",
  unavailable: "Unavailable",
  pending: "Pending",
};

const CLASS_NAME: Record<TeamWorkspaceStepStatus, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-950",
  blocked: "border-amber-200 bg-amber-50 text-amber-950",
  unavailable: "border-slate-200 bg-slate-100 text-slate-700",
  pending: "border-sky-200 bg-sky-50 text-sky-950",
};

export function StatusPill({ status }: { status: TeamWorkspaceStepStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        CLASS_NAME[status]
      )}
    >
      {LABEL[status]}
    </span>
  );
}
