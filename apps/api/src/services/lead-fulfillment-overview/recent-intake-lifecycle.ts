import { calculateInventoryAgeDays } from "../lead-inventory/lead-inventory-age.js";
import { resolveInventoryCommerceLifecycle } from "../ppl-fulfillment/commerce-lifecycle.js";

export type RecentIntakeLifecycle =
  | "INTAKE_ONLY"
  | "DATE_MISSING"
  | "FRESH_HOLD"
  | "SEMI_FRESH_HOLD"
  | "AGED_AVAILABLE"
  | "AGED_RESERVED"
  | "AGED_BLOCKED_REVIEW"
  | "DELIVERED"
  | "QUARANTINED";

export const RECENT_INTAKE_LIFECYCLE_LABELS: Record<RecentIntakeLifecycle, string> = {
  INTAKE_ONLY: "INTAKE ONLY",
  DATE_MISSING: "DATE MISSING",
  FRESH_HOLD: "FRESH — HOLD",
  SEMI_FRESH_HOLD: "SEMI-FRESH — HOLD",
  AGED_AVAILABLE: "AGED AVAILABLE",
  AGED_RESERVED: "AGED RESERVED",
  AGED_BLOCKED_REVIEW: "AGED BLOCKED / REVIEW",
  DELIVERED: "DELIVERED",
  QUARANTINED: "QUARANTINED",
};

/**
 * Operator lifecycle for recent intake. Age alone never implies available.
 * A 35-day pending_review lead is AGED BLOCKED / REVIEW, not Aged Available.
 */
export function deriveRecentIntakeLifecycle(input: {
  hasInventoryItem: boolean;
  generatedAtMissing: boolean;
  inventoryStatus?: string | null;
  generatedAt?: Date | null;
  evaluatedAt: Date;
}): RecentIntakeLifecycle {
  if (!input.hasInventoryItem) {
    return input.generatedAtMissing ? "DATE_MISSING" : "INTAKE_ONLY";
  }

  const status = input.inventoryStatus ?? "";
  if (status === "quarantined") return "QUARANTINED";
  if (status === "fulfilled" || status === "committed") return "DELIVERED";
  if (status === "reserved") return "AGED_RESERVED";

  const ageDays =
    input.generatedAt != null
      ? calculateInventoryAgeDays(input.generatedAt, input.evaluatedAt)
      : null;
  const commerce = resolveInventoryCommerceLifecycle(ageDays);
  if (commerce === "DATE_MISSING") return "DATE_MISSING";
  if (commerce === "FRESH_HOLD") return "FRESH_HOLD";
  if (commerce === "SEMI_FRESH_HOLD") return "SEMI_FRESH_HOLD";

  if (status === "available") return "AGED_AVAILABLE";
  return "AGED_BLOCKED_REVIEW";
}

export function isGeneratedAtMissingFromEnrichment(enrichment: unknown): boolean {
  if (!enrichment || typeof enrichment !== "object" || Array.isArray(enrichment)) return false;
  const tracking = (enrichment as { inventoryTracking?: unknown }).inventoryTracking;
  if (!tracking || typeof tracking !== "object" || Array.isArray(tracking)) return false;
  return (tracking as { outcome?: unknown }).outcome === "generated_at_missing";
}
