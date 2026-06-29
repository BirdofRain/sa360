import type { GhlLiveCanaryPreflight } from "./types";

export function ghlLiveRunStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return status.replace(/_/g, " ");
}

export function ghlLiveRunStatusBadgeClass(status: string | null | undefined): string {
  switch (status) {
    case "succeeded":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200";
    case "partial_success":
      return "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100";
    case "failed":
    case "blocked":
      return "border-destructive/40 bg-destructive/10 text-destructive";
    case "skipped_duplicate":
      return "border-muted-foreground/40 bg-muted/40 text-muted-foreground";
    case "executing":
      return "border-blue-500/40 bg-blue-500/10 text-blue-900 dark:text-blue-100";
    default:
      return "";
  }
}

export function liveCanaryCanRunFromPreflight(preflight: GhlLiveCanaryPreflight | null): boolean {
  return Boolean(preflight?.canExecute);
}

/**
 * Blocker messages that are cleared by a successful GHL adapter simulation for the *current*
 * delivery plan. Only these are removed when simulation passes — all other live gates remain.
 */
export const LIVE_CANARY_SIMULATION_BLOCKER_PATTERNS = [
  "no adapter run found",
  "recent successful ghl adapter simulation is required",
] as const;

function isSimulationBlocker(blocker: string): boolean {
  const lower = blocker.toLowerCase();
  return LIVE_CANARY_SIMULATION_BLOCKER_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Defensive client-side net for the "adapter run succeeded but readiness cache stale" case:
 * when a passing adapter simulation exists for the current plan, drop only the
 * simulation-required blockers. Every other live gate (adapter mode, deliveryEnabled,
 * deliveryMode, client cutover approval, internal approval) is preserved.
 */
export function filterStaleSimulationBlockers(
  blockers: string[],
  simulationPassed: boolean
): string[] {
  const list = Array.isArray(blockers) ? blockers.filter((b) => typeof b === "string") : [];
  if (!simulationPassed) return list;
  return list.filter((b) => !isSimulationBlocker(b));
}

export type LiveCanarySimulationBadge = {
  status: "passed" | "required" | "required_new_plan";
  label: string;
};

/**
 * Simulation badge state for the Live Canary panel, resolved against the *current* delivery plan.
 *
 * - "passed": the preflight (authoritative for the current plan id) reports a passing adapter run.
 * - "required_new_plan": a simulation was run, but for a different (now-stale) delivery plan id.
 * - "required": no passing simulation exists for the current plan.
 *
 * A stale `simulatedPlanId` can never produce "passed" — only the preflight (keyed to the live
 * plan id) can — so regenerating a plan never falsely shows the old simulation as valid.
 */
export function liveCanarySimulationBadge(input: {
  preflight: Pick<GhlLiveCanaryPreflight, "lastAdapterSimulationPassed"> | null;
  planId: string | null | undefined;
  simulatedPlanId: string | null | undefined;
}): LiveCanarySimulationBadge {
  if (input.preflight?.lastAdapterSimulationPassed) {
    return { status: "passed", label: "Simulation: passed" };
  }
  if (
    input.simulatedPlanId &&
    input.planId &&
    input.simulatedPlanId !== input.planId
  ) {
    return { status: "required_new_plan", label: "Simulation: required for this new plan" };
  }
  return { status: "required", label: "Simulation: required" };
}

export function truncateIdempotencyKey(key: string | null | undefined): string {
  if (!key) return "—";
  if (key.length <= 16) return key;
  return `${key.slice(0, 8)}…${key.slice(-8)}`;
}
