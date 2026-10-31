import { cn } from "@/lib/utils";
import type { TriState } from "@/lib/clients/onboarding/types";

export function StatusMark({
  label,
  state,
  detail,
}: {
  label: string;
  state: TriState | "proven" | "unproven" | "warn";
  detail?: string;
}) {
  const tone =
    state === "yes" || state === "proven"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : state === "warn" || state === "unknown"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-slate-200 bg-slate-50 text-slate-700";
  const word =
    state === "yes" || state === "proven"
      ? "Yes"
      : state === "no" || state === "unproven"
        ? "No"
        : state === "warn"
          ? "Review"
          : "Unknown";
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2", tone)} data-status={label} data-state={state}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs font-semibold">{word}</span>
      </div>
      {detail ? <p className="mt-1 min-w-0 break-words text-xs leading-5">{detail}</p> : null}
    </div>
  );
}
