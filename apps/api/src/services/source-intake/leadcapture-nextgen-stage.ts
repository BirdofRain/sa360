/**
 * Staged rollout for LeadCapture Next-Gen intake canary.
 *
 * capture_only          — Stage A: persist + log only
 * inventory_only        — Normalize + canonical inventory; no routing/fulfillment
 * normalize_route_proof — Stage B (partial): normalize, exact match, proof
 * shadow_fulfillment    — Stages B–C: + LF2 outbox / shadow allocation
 * live_canary           — Stage D: allow one-lead live canary path (still gated)
 */
export type LeadCaptureNextGenIntakeStage =
  | "capture_only"
  | "inventory_only"
  | "normalize_route_proof"
  | "shadow_fulfillment"
  | "live_canary";

const STAGE_RANK: Record<LeadCaptureNextGenIntakeStage, number> = {
  capture_only: 0,
  inventory_only: 1,
  normalize_route_proof: 2,
  shadow_fulfillment: 3,
  live_canary: 4,
};

export function parseLeadCaptureNextGenIntakeStage(
  raw: string | undefined
): LeadCaptureNextGenIntakeStage {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "inventory_only") return "inventory_only";
  if (value === "normalize_route_proof") return "normalize_route_proof";
  if (value === "shadow_fulfillment") return "shadow_fulfillment";
  if (value === "live_canary") return "live_canary";
  return "capture_only";
}

export function getLeadCaptureNextGenIntakeStage(): LeadCaptureNextGenIntakeStage {
  return parseLeadCaptureNextGenIntakeStage(process.env.SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE);
}

export function nextGenStageAtLeast(
  current: LeadCaptureNextGenIntakeStage,
  required: LeadCaptureNextGenIntakeStage
): boolean {
  return STAGE_RANK[current] >= STAGE_RANK[required];
}
