import type { LeadDeliveryPlanItem, LeadDeliveryPlanSummary } from "./delivery-plan-types";

export function deliveryPlanStatusLabel(status: string | null | undefined): string {
  if (!status) return "Not generated";
  switch (status) {
    case "planned":
      return "Planned";
    case "needs_config":
      return "Needs config";
    case "blocked":
      return "Blocked";
    case "ready_for_review":
      return "Ready for review";
    case "ignored_test":
      return "Ignored (test)";
    default:
      return status.replace(/_/g, " ");
  }
}

export function deliveryPlanStatusBadgeClass(status: string | null | undefined): string {
  if (!status) return "bg-muted text-muted-foreground";
  switch (status) {
    case "planned":
      return "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100";
    case "needs_config":
      return "border-amber-600/35 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
    case "blocked":
      return "border-red-600/35 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100";
    case "ready_for_review":
      return "border-sky-600/35 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function deliveryPlanStepStatusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export function deliveryPlanSummaryLabel(summary: LeadDeliveryPlanSummary | null | undefined): string {
  if (!summary) return "Not generated";
  return deliveryPlanStatusLabel(summary.status);
}

export function deliveryPlanStepSummary(
  step: LeadDeliveryPlanItem["steps"][number] | null | undefined
): string {
  if (!step || typeof step !== "object") return "—";
  const parts = [typeof step.title === "string" ? step.title : "Step"];
  if (step.targetSystem) parts.push(`→ ${step.targetSystem}`);
  if (step.targetId) parts.push(step.targetId);
  return parts.join(" ");
}
