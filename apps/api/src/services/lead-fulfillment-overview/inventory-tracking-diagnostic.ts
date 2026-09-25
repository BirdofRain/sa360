/**
 * Read-only classification of the inventoryTracking object already stored on
 * SourceLeadEvent.enrichmentMetadataJson. Does not create or update inventory.
 */

export type InventoryTrackingDiagnostic =
  | "created"
  | "reused"
  | "generated_at_missing"
  | "skipped"
  | "failed"
  | "not_attempted";

export type ClassifiedInventoryTracking = {
  diagnostic: InventoryTrackingDiagnostic;
  /** Stored outcome code when present. Never a phone, email, or payload. */
  outcome: string | null;
  inventoryItemId: string | null;
  label: string;
};

const REUSE_OUTCOMES = new Set([
  "reused_same_event",
  "reused_source_lead_id",
  "reused_phone",
  "reused_email",
  "reused_historical",
]);

const LABELS: Record<InventoryTrackingDiagnostic, string> = {
  created: "Inventory created",
  reused: "Inventory reused",
  generated_at_missing: "Generated date missing",
  skipped: "Tracking skipped",
  failed: "Tracking failed",
  not_attempted: "Tracking not yet attempted",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function classifyStoredInventoryTracking(enrichment: unknown): ClassifiedInventoryTracking {
  const root = asRecord(enrichment);
  const tracking = root ? asRecord(root.inventoryTracking) : null;
  if (!tracking) {
    return {
      diagnostic: "not_attempted",
      outcome: null,
      inventoryItemId: null,
      label: LABELS.not_attempted,
    };
  }

  const outcome = typeof tracking.outcome === "string" ? tracking.outcome.trim() : "";
  const inventoryItemId = readId(tracking.inventoryItemId);
  const failed =
    tracking.ok === false ||
    outcome === "inventory_tracking_failed" ||
    (typeof tracking.code === "string" && tracking.code === "inventory_tracking_failed");

  let diagnostic: InventoryTrackingDiagnostic;
  if (failed) diagnostic = "failed";
  else if (outcome === "generated_at_missing") diagnostic = "generated_at_missing";
  else if (outcome === "created") diagnostic = "created";
  else if (outcome.startsWith("reused_") || REUSE_OUTCOMES.has(outcome)) diagnostic = "reused";
  else if (outcome.startsWith("skipped")) diagnostic = "skipped";
  else if (!outcome) diagnostic = "not_attempted";
  else diagnostic = "failed";

  return {
    diagnostic,
    outcome: outcome || null,
    inventoryItemId,
    label: LABELS[diagnostic],
  };
}

export function inventoryTrackingDetail(input: {
  diagnostic: InventoryTrackingDiagnostic;
  outcome: string | null;
  canonicalOnOtherEvent: boolean;
}): string | null {
  if (input.diagnostic === "reused" && input.canonicalOnOtherEvent) {
    return "Existing item on another source event";
  }
  if (input.diagnostic === "reused" && input.outcome === "reused_same_event") {
    return "Existing item on this source event";
  }
  if (input.diagnostic === "skipped") return "Tracking skipped";
  if (input.diagnostic === "failed") return "Tracking failed";
  if (input.diagnostic === "generated_at_missing") return "Generated date missing";
  if (input.diagnostic === "not_attempted") return "Tracking not yet attempted";
  return null;
}
