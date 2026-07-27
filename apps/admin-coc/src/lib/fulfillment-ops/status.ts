export type OpsBadgeTone = "neutral" | "success" | "warn" | "danger" | "info";

export function opsBadgeClass(tone: OpsBadgeTone): string {
  if (tone === "success") return "bg-emerald-50 text-emerald-900 border-emerald-200";
  if (tone === "warn") return "bg-amber-50 text-amber-900 border-amber-200";
  if (tone === "danger") return "bg-red-50 text-red-900 border-red-200";
  if (tone === "info") return "bg-blue-50 text-blue-900 border-blue-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

export function labelForEligibility(status: string): { label: string; tone: OpsBadgeTone } {
  if (status === "eligible") return { label: "ELIGIBLE", tone: "success" };
  if (status === "review_required") return { label: "INELIGIBLE", tone: "warn" };
  if (status === "ineligible") return { label: "INELIGIBLE", tone: "danger" };
  return { label: status.toUpperCase(), tone: "neutral" };
}

export function labelForInventoryStatus(status: string): { label: string; tone: OpsBadgeTone } {
  if (status === "pending_review") return { label: "PENDING REVIEW", tone: "warn" };
  if (status === "available") return { label: "ACTIVE", tone: "success" };
  if (status === "reserved") return { label: "RESERVED", tone: "warn" };
  if (status === "rejected" || status === "quarantined") {
    return { label: status.replace(/_/g, " ").toUpperCase(), tone: "danger" };
  }
  return { label: status.replace(/_/g, " ").toUpperCase(), tone: "neutral" };
}

export function labelForAllocation(status: string): { label: string; tone: OpsBadgeTone } {
  if (status === "shadow") return { label: "SIMULATION READY", tone: "info" };
  if (status === "reserved") return { label: "RESERVED", tone: "warn" };
  if (status === "committed") return { label: "SIMULATED", tone: "success" };
  if (status === "review_required") return { label: "SIMULATION FAILED", tone: "danger" };
  return { label: status.replace(/_/g, " ").toUpperCase(), tone: "neutral" };
}

export function labelForAttempt(
  status: string,
  executionMode: string
): { label: string; tone: OpsBadgeTone } {
  if (executionMode === "live") return { label: "LIVE ATTEMPT", tone: "danger" };
  if (status === "succeeded") return { label: "SIMULATED", tone: "success" };
  if (status === "terminal_failure" || status === "retryable_failure" || status === "unknown_outcome") {
    return { label: "SIMULATION FAILED", tone: "danger" };
  }
  return { label: status.replace(/_/g, " ").toUpperCase(), tone: "neutral" };
}
