import type { RoutingDryRunDecisionItem } from "./types.ts";

export const ROUTING_VALIDATION_STATUS_OPTIONS = [
  { value: "all", label: "All validation statuses" },
  { value: "unreviewed", label: "Unreviewed" },
  { value: "matched_legacy", label: "Matched legacy" },
  { value: "mismatch", label: "Mismatch" },
  { value: "needs_mapping", label: "Needs mapping" },
  { value: "ignored_test", label: "Ignored (test)" },
  { value: "legacy_unknown", label: "Legacy unknown" },
] as const;

export type RoutingValidationStatusFilter =
  (typeof ROUTING_VALIDATION_STATUS_OPTIONS)[number]["value"];

export function effectiveValidationStatus(status: string | null | undefined): string {
  if (!status || status === "unreviewed") return "unreviewed";
  return status;
}

export function validationStatusLabel(status: string | null | undefined): string {
  const s = effectiveValidationStatus(status);
  const found = ROUTING_VALIDATION_STATUS_OPTIONS.find((o) => o.value === s);
  return found?.label ?? s.replace(/_/g, " ");
}

export function validationStatusBadgeClass(status: string | null | undefined): string {
  const s = effectiveValidationStatus(status);
  switch (s) {
    case "matched_legacy":
      return "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100";
    case "mismatch":
      return "border-red-600/35 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100";
    case "needs_mapping":
      return "border-amber-600/35 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
    case "ignored_test":
      return "border-slate-400/40 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200";
    case "legacy_unknown":
      return "border-violet-600/35 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function sa360PredictedClientLabel(row: RoutingDryRunDecisionItem): string {
  return (
    row.matchedRuleSummary?.clientDisplayName?.trim() ||
    row.destinationClientAccountId?.trim() ||
    "—"
  );
}

export function sa360PredictedSubaccount(row: RoutingDryRunDecisionItem): string {
  return row.destinationSubaccountIdGhl?.trim() || "—";
}
