import type {
  InventoryLot,
  LeadAllocation,
  LeadInventoryItem,
  LeadProof,
  LeadVerificationResult,
  SourceLeadEvent,
} from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "../lead-inventory/lead-inventory-age.js";
import {
  LEAD_INVENTORY_CLOCK_TOLERANCE_MS,
  type LeadInventoryAgeBand,
} from "../lead-inventory/lead-inventory.constants.js";
import { hasActiveInventoryLinkedHold } from "../lead-inventory/lead-inventory-allocation-invariant.service.js";
import { normalizeInventoryState } from "../lead-inventory/lead-inventory-state.js";
import {
  REVIEW_RECOGNIZED_PROVIDERS,
  REVIEW_RECOGNIZED_SOURCE_LANES,
  US_STATE_CODES,
  type ReviewBlockerCode,
} from "./lead-inventory-review.constants.js";

export type LeadInventoryActivationEligibilityInput = {
  item: Pick<
    LeadInventoryItem,
    | "id"
    | "status"
    | "generatedAt"
    | "normalizedState"
    | "nicheKey"
    | "productType"
    | "sourceProvider"
    | "sourceLane"
    | "inventoryClass"
    | "inventoryLotId"
    | "sourceLeadEventId"
    | "quarantineReason"
    | "availableAt"
    | "reservedAt"
    | "committedAt"
    | "withdrawnAt"
    | "expiredAt"
    | "rejectedAt"
    | "maxFulfillments"
    | "fulfillmentCount"
    | "metadataJson"
  >;
  lot: Pick<InventoryLot, "id" | "status" | "lotKey" | "sourceLane" | "sourceProvider"> | null;
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    | "id"
    | "sourceProvider"
    | "sourceSystem"
    | "normalizedPayloadJson"
    | "enrichmentMetadataJson"
    | "receivedAt"
  > | null;
  leadProof: Pick<LeadProof, "proofStatus"> | null;
  verification: Pick<LeadVerificationResult, "verificationStatus" | "duplicateStatus"> | null;
  allocations: Array<
    Pick<LeadAllocation, "id" | "status" | "leadInventoryItemId" | "releasedAt"> & {
      deliveryInstructionCount: number;
      deliveryAttemptCount: number;
    }
  >;
  ageBands: LeadInventoryAgeBand[];
  evaluatedAt?: Date;
};

export type LeadInventoryActivationEligibilityResult = {
  inventoryItemId: string;
  eligible: boolean;
  blockerCodes: ReviewBlockerCode[];
  warnings: string[];
  currentStatus: string;
  allowedActions: Array<"make_available" | "quarantine" | "reject">;
  ageDays: number | null;
  ageBandKey: string | null;
  sourceLane: string | null;
  sourceProvider: string | null;
  normalizedState: string | null;
  proofStatus: string;
  verificationStatus: string;
  duplicateStatus: string;
  provenance: {
    hasLot: boolean;
    hasSourceEvent: boolean;
    hasImportRequestId: boolean;
    hasGeneratedAt: boolean;
  };
  duplicateSummary: {
    status: string;
    safe: boolean;
  };
  identitySummary: {
    present: boolean;
    hasPhoneOrEmail: boolean;
    verificationPassed: boolean;
  };
  allocationConflict: boolean;
  deliveryHistoryPresent: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readImportRequestId(metadataJson: unknown): string | null {
  const meta = asRecord(metadataJson);
  const value = meta?.importRequestId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDuplicateSafe(status: string | null | undefined): boolean {
  return status === "UNIQUE";
}

export function assessLeadInventoryActivationEligibility(
  input: LeadInventoryActivationEligibilityInput
): LeadInventoryActivationEligibilityResult {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const blockers = new Set<ReviewBlockerCode>();
  const warnings: string[] = [];

  const currentStatus = input.item.status;
  const pending = currentStatus === "pending_review";
  if (!pending) blockers.add("status_not_pending_review");

  if (
    currentStatus === "available" ||
    currentStatus === "reserved" ||
    currentStatus === "committed" ||
    currentStatus === "fulfilled" ||
    currentStatus === "expired" ||
    currentStatus === "withdrawn" ||
    currentStatus === "rejected" ||
    currentStatus === "quarantined"
  ) {
    blockers.add("status_not_pending_review");
  }

  const normalizedState = normalizeInventoryState(input.item.normalizedState);
  if (!normalizedState || !US_STATE_CODES.has(normalizedState)) {
    blockers.add("invalid_state");
  }

  const generatedAt = input.item.generatedAt;
  let ageDays: number | null = null;
  let ageBandKey: string | null = null;
  if (!generatedAt || Number.isNaN(generatedAt.getTime())) {
    blockers.add("generated_at_missing_or_invalid");
  } else {
    if (generatedAt.getTime() > evaluatedAt.getTime() + LEAD_INVENTORY_CLOCK_TOLERANCE_MS) {
      blockers.add("generated_at_missing_or_invalid");
    }
    ageDays = calculateInventoryAgeDays(generatedAt, evaluatedAt);
    ageBandKey = resolveAgeBandKey(ageDays, input.ageBands);
    if (!ageBandKey) blockers.add("age_band_unresolved");
  }

  const provider = input.item.sourceProvider;
  if (!provider || !REVIEW_RECOGNIZED_PROVIDERS.has(provider) || provider === "unknown") {
    blockers.add("source_provider_unrecognized");
  }

  const itemLane = input.item.sourceLane?.trim().toLowerCase() || null;
  const eventLane = input.sourceLeadEvent
    ? resolveCanonicalSourceLane(input.sourceLeadEvent)
    : null;
  const resolvedLane = itemLane || eventLane;
  const laneRecognized =
    !!resolvedLane &&
    (REVIEW_RECOGNIZED_SOURCE_LANES.has(resolvedLane) ||
      // Canonical provider_system form for recognized manual/csv imports.
      resolvedLane === "manual_import_csv_import");
  if (!resolvedLane || !laneRecognized) {
    blockers.add("source_lane_unrecognized");
  }
  // Item lane must agree with event canonical lane when both are present.
  if (itemLane && eventLane && itemLane !== eventLane && !REVIEW_RECOGNIZED_SOURCE_LANES.has(itemLane)) {
    blockers.add("source_lane_unrecognized");
  }

  if (!input.lot || !input.item.inventoryLotId || input.lot.id !== input.item.inventoryLotId) {
    blockers.add("inventory_lot_missing");
  }

  if (
    !input.sourceLeadEvent ||
    !input.item.sourceLeadEventId ||
    input.sourceLeadEvent.id !== input.item.sourceLeadEventId
  ) {
    blockers.add("source_event_missing");
  }

  const importRequestId = readImportRequestId(input.item.metadataJson);
  const hasImportProvenance =
    !!input.lot &&
    !!input.sourceLeadEvent &&
    !!importRequestId &&
    !!generatedAt &&
    !Number.isNaN(generatedAt?.getTime?.() ?? NaN);
  if (!hasImportProvenance) {
    blockers.add("import_provenance_missing");
  }

  const identity = input.sourceLeadEvent
    ? readNormalizedLeadIdentity(input.sourceLeadEvent.normalizedPayloadJson)
    : null;
  const hasPhoneOrEmail = !!(identity?.phoneE164 || identity?.email);
  const verificationStatus = input.verification?.verificationStatus ?? "UNCHECKED";
  const duplicateStatus = input.verification?.duplicateStatus ?? "UNCHECKED";
  const verificationPassed = verificationStatus === "PASSED";

  if (!identity || !hasPhoneOrEmail || !verificationPassed) {
    blockers.add("identity_normalization_incomplete");
  }

  if (!input.verification || duplicateStatus === "UNCHECKED") {
    blockers.add("duplicate_status_unchecked");
  } else if (duplicateStatus === "POSSIBLE_MATCH") {
    blockers.add("duplicate_possible_match");
  } else if (
    duplicateStatus === "DUPLICATE_GLOBAL" ||
    duplicateStatus === "DUPLICATE_BUYER" ||
    duplicateStatus === "DUPLICATE_RECENT"
  ) {
    blockers.add("duplicate_detected");
  } else if (!isDuplicateSafe(duplicateStatus)) {
    blockers.add("duplicate_status_unchecked");
  }

  if (input.item.quarantineReason?.trim()) {
    blockers.add("quarantine_reason_present");
  }

  const allocationConflict = hasActiveInventoryLinkedHold(input.allocations);
  if (allocationConflict) blockers.add("allocation_conflict");

  const deliveryHistoryPresent = input.allocations.some(
    (allocation) =>
      allocation.deliveryInstructionCount > 0 || allocation.deliveryAttemptCount > 0
  );
  if (deliveryHistoryPresent) blockers.add("delivery_history_present");

  if (
    input.item.maxFulfillments <= 0 ||
    input.item.fulfillmentCount < 0 ||
    input.item.fulfillmentCount > input.item.maxFulfillments
  ) {
    blockers.add("fulfillment_limit_invalid");
  }

  if (!input.item.nicheKey?.trim() || !input.item.inventoryClass) {
    blockers.add("required_fields_missing");
  }

  if (input.item.inventoryClass === "aged" && input.lot?.status === "archived") {
    blockers.add("commercial_policy_blocked");
  }

  const proofStatus = input.leadProof?.proofStatus ?? "UNREVIEWED";
  if (proofStatus === "REJECTED" || proofStatus === "PROOF_MISSING") {
    warnings.push("proof_not_ready_informational");
  } else if (proofStatus !== "PROOF_ATTACHED") {
    warnings.push("proof_unreviewed_informational");
  }

  const blockerCodes = [...blockers];
  const eligible = pending && blockerCodes.length === 0;

  const allowedActions: Array<"make_available" | "quarantine" | "reject"> = pending
    ? ["make_available", "quarantine", "reject"]
    : [];

  return {
    inventoryItemId: input.item.id,
    eligible,
    blockerCodes,
    warnings,
    currentStatus,
    allowedActions,
    ageDays,
    ageBandKey,
    sourceLane: resolvedLane,
    sourceProvider: provider ?? null,
    normalizedState,
    proofStatus,
    verificationStatus,
    duplicateStatus,
    provenance: {
      hasLot: !!input.lot,
      hasSourceEvent: !!input.sourceLeadEvent,
      hasImportRequestId: !!importRequestId,
      hasGeneratedAt: !!generatedAt && !Number.isNaN(generatedAt.getTime()),
    },
    duplicateSummary: {
      status: duplicateStatus,
      safe: isDuplicateSafe(duplicateStatus),
    },
    identitySummary: {
      present: !!identity,
      hasPhoneOrEmail,
      verificationPassed,
    },
    allocationConflict,
    deliveryHistoryPresent,
  };
}
