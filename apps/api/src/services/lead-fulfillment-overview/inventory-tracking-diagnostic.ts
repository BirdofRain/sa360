/**
 * Read-only classification of the inventoryTracking object already stored on
 * SourceLeadEvent.enrichmentMetadataJson. Does not create or update inventory.
 * Observer responses receive only recognized outcome codes.
 */

export const RECOGNIZED_INVENTORY_TRACKING_OUTCOMES = [
  "created",
  "reused_same_event",
  "reused_source_lead_id",
  "reused_phone",
  "reused_email",
  "reused_historical",
  "generated_at_missing",
  "skipped_not_resale_supply",
  "inventory_tracking_failed",
] as const;

export type RecognizedInventoryTrackingOutcome =
  (typeof RECOGNIZED_INVENTORY_TRACKING_OUTCOMES)[number];

export type InventoryTrackingDiagnostic =
  | "created"
  | "reused"
  | "generated_at_missing"
  | "skipped"
  | "failed"
  | "not_attempted"
  | "unrecognized";

export type ClassifiedInventoryTracking = {
  diagnostic: InventoryTrackingDiagnostic;
  /** Recognized outcome code, or null. Never a stored free-text value. */
  outcome: RecognizedInventoryTrackingOutcome | null;
  inventoryItemId: string | null;
  label: string;
};

const RECOGNIZED = new Set<string>(RECOGNIZED_INVENTORY_TRACKING_OUTCOMES);

const REUSE_OUTCOMES = new Set<RecognizedInventoryTrackingOutcome>([
  "reused_same_event",
  "reused_source_lead_id",
  "reused_phone",
  "reused_email",
  "reused_historical",
]);

const UNRECOGNIZED_LABEL = "Unrecognized tracking outcome";

const LABELS: Record<InventoryTrackingDiagnostic, string> = {
  created: "Inventory created",
  reused: "Inventory reused",
  generated_at_missing: "Generated date missing",
  skipped: "Tracking skipped",
  failed: "Tracking failed",
  not_attempted: "Tracking not yet attempted",
  unrecognized: UNRECOGNIZED_LABEL,
};

const SAFE_REFERENCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isSafeInventoryReferenceId(value: string): boolean {
  return SAFE_REFERENCE_ID.test(value);
}

export function isRecognizedReuseOutcome(
  outcome: string | null
): outcome is RecognizedInventoryTrackingOutcome {
  return outcome != null && REUSE_OUTCOMES.has(outcome as RecognizedInventoryTrackingOutcome);
}

function safeReferenceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return isSafeInventoryReferenceId(trimmed) ? trimmed : null;
}

function unrecognized(): ClassifiedInventoryTracking {
  return {
    diagnostic: "unrecognized",
    outcome: null,
    inventoryItemId: null,
    label: UNRECOGNIZED_LABEL,
  };
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

  const rawOutcome = typeof tracking.outcome === "string" ? tracking.outcome.trim() : "";
  const failedSignal =
    tracking.ok === false ||
    (typeof tracking.code === "string" && tracking.code === "inventory_tracking_failed");

  if (!rawOutcome) {
    if (failedSignal) {
      return {
        diagnostic: "failed",
        outcome: null,
        inventoryItemId: null,
        label: LABELS.failed,
      };
    }
    return {
      diagnostic: "not_attempted",
      outcome: null,
      inventoryItemId: null,
      label: LABELS.not_attempted,
    };
  }

  if (!RECOGNIZED.has(rawOutcome)) return unrecognized();

  const outcome = rawOutcome as RecognizedInventoryTrackingOutcome;
  const inventoryItemId =
    outcome === "created" || REUSE_OUTCOMES.has(outcome) ? safeReferenceId(tracking.inventoryItemId) : null;

  if (outcome === "inventory_tracking_failed") {
    return { diagnostic: "failed", outcome, inventoryItemId: null, label: LABELS.failed };
  }
  if (outcome === "generated_at_missing") {
    return {
      diagnostic: "generated_at_missing",
      outcome,
      inventoryItemId: null,
      label: LABELS.generated_at_missing,
    };
  }
  if (outcome === "created") {
    return { diagnostic: "created", outcome, inventoryItemId, label: LABELS.created };
  }
  if (REUSE_OUTCOMES.has(outcome)) {
    return { diagnostic: "reused", outcome, inventoryItemId, label: LABELS.reused };
  }
  return { diagnostic: "skipped", outcome, inventoryItemId: null, label: LABELS.skipped };
}

export function inventoryTrackingDetail(input: {
  diagnostic: InventoryTrackingDiagnostic;
  outcome: RecognizedInventoryTrackingOutcome | null;
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
  if (input.diagnostic === "unrecognized") return UNRECOGNIZED_LABEL;
  return null;
}
