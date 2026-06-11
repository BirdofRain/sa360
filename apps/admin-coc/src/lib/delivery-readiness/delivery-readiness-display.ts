import type { DeliveryReadinessAssessment } from "./types.ts";

export function readinessStatusLabel(status: string | null | undefined): string {
  if (!status) return "Unknown";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function readinessStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "live_enabled":
      return "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/45 dark:text-emerald-100";
    case "ready_for_live":
      return "border-sky-600/35 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100";
    case "ready_for_shadow":
      return "border-violet-600/35 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100";
    case "needs_config":
      return "border-amber-600/35 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100";
    case "blocked":
      return "border-red-600/35 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function deliveryModeBadgeClass(mode: string | null | undefined): string {
  switch (mode) {
    case "live":
      return "border-red-600/35 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100";
    case "ready_for_live":
      return "border-sky-600/35 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100";
    case "paused":
      return "border-slate-400/40 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-200";
    default:
      return "border-violet-600/35 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100";
  }
}

export function formatBlockersWarnings(assessment: DeliveryReadinessAssessment): string {
  const lines: string[] = [];
  if (assessment.blockers.length) {
    lines.push("Blockers:", ...assessment.blockers.map((b) => `• ${b}`));
  }
  if (assessment.warnings.length) {
    lines.push("Warnings:", ...assessment.warnings.map((w) => `• ${w}`));
  }
  return lines.join("\n");
}

export function liveDeliveryAllowedLabel(canDeliverLive: boolean): string {
  return canDeliverLive ? "Yes (config only)" : "No";
}

export function directCanaryReadinessLabel(ready: boolean): string {
  return ready ? "Ready for direct canary" : "Not direct-canary-ready";
}

export function deliveryReadinessTierSummary(assessment: {
  readyForShadow: boolean;
  readyForDirectCanary: boolean;
  readyForLive: boolean;
  canDeliverLive: boolean;
}): string {
  if (assessment.canDeliverLive) return "Ready for full delivery";
  if (assessment.readyForLive) return "Ready for full delivery (pending approvals)";
  if (assessment.readyForDirectCanary) return "Ready for direct canary";
  if (assessment.readyForShadow) return "Ready for shadow";
  return "Needs configuration";
}
