import type {
  InventoryLot,
  LeadAllocation,
  LeadInventoryItem,
  LeadProof,
  LeadVerificationResult,
  SourceLeadEvent,
} from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "./lead-inventory-age.js";
import {
  LEAD_INVENTORY_CLOCK_TOLERANCE_MS,
  LEAD_INVENTORY_SUPPLY_HOLD_STATUSES,
  type LeadInventoryAgeBand,
} from "./lead-inventory.constants.js";
import { evaluateInventoryEvidenceReadiness } from "./lead-inventory-evidence.service.js";

export type LeadInventoryAvailabilityInput = {
  item: Pick<
    LeadInventoryItem,
    | "id"
    | "status"
    | "generatedAt"
    | "normalizedState"
    | "inventoryClass"
    | "nicheKey"
    | "maxFulfillments"
    | "fulfillmentCount"
    | "quarantineReason"
    | "withdrawnAt"
    | "expiredAt"
  >;
  lot: Pick<InventoryLot, "status">;
  sourceLeadEvent: Pick<
    SourceLeadEvent,
    "sourceProvider" | "sourceSystem" | "normalizedPayloadJson" | "enrichmentMetadataJson"
  >;
  leadProof: Pick<LeadProof, "proofStatus"> | null;
  verification: Pick<LeadVerificationResult, "verificationStatus" | "duplicateStatus"> | null;
  activeAllocations: Pick<LeadAllocation, "status" | "leadInventoryItemId">[];
  ageBands: LeadInventoryAgeBand[];
  evaluatedAt?: Date;
};

export type LeadInventoryAvailabilityResult = {
  inventoryItemId: string;
  generatedAt: string;
  ageDays: number;
  ageBandKey: string | null;
  normalizedState: string | null;
  inventoryClass: string;
  nicheKey: string;
  proofStatus: string;
  verificationStatus: string;
  duplicateStatus: string;
  reservationStatus: "none" | "active";
  itemStatus: string;
  available: boolean;
  blockers: string[];
  warnings: string[];
};

export function evaluateLeadInventoryAvailability(
  input: LeadInventoryAvailabilityInput
): LeadInventoryAvailabilityResult {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (input.lot.status !== "active") blockers.push("lot_not_active");
  if (input.item.status !== "available") blockers.push("item_not_available");
  if (input.item.status === "quarantined" || input.item.quarantineReason) blockers.push("quarantined");
  if (input.item.withdrawnAt) blockers.push("withdrawn");
  if (input.item.expiredAt && input.item.expiredAt.getTime() <= evaluatedAt.getTime()) {
    blockers.push("expired");
  }

  if (!input.item.generatedAt) {
    blockers.push("generated_at_missing");
  }

  const generatedAt = input.item.generatedAt;
  let ageDays = 0;
  if (generatedAt) {
    if (generatedAt.getTime() > evaluatedAt.getTime() + LEAD_INVENTORY_CLOCK_TOLERANCE_MS) {
      blockers.push("generated_at_invalid");
    }
    ageDays = calculateInventoryAgeDays(generatedAt, evaluatedAt);
  }

  const normalizedState = input.item.normalizedState?.trim() || null;
  if (!normalizedState) blockers.push("state_missing");

  const evidence = evaluateInventoryEvidenceReadiness({
    sourceLeadEvent: input.sourceLeadEvent,
    leadProof: input.leadProof,
    verification: input.verification,
  });
  blockers.push(...evidence.blockers);
  warnings.push(...evidence.warnings);

  const activeReservation = input.activeAllocations.some(
    (allocation) =>
      allocation.leadInventoryItemId != null &&
      LEAD_INVENTORY_SUPPLY_HOLD_STATUSES.includes(
        allocation.status as (typeof LEAD_INVENTORY_SUPPLY_HOLD_STATUSES)[number]
      )
  );
  if (activeReservation) blockers.push("active_reservation");

  if (input.item.fulfillmentCount >= input.item.maxFulfillments) {
    blockers.push("fulfillment_limit_reached");
  }

  const identity = readNormalizedLeadIdentity(input.sourceLeadEvent.normalizedPayloadJson);
  if (!identity?.phoneE164 && !identity?.email) {
    warnings.push("normalized_identity_sparse");
  }

  const ageBandKey = generatedAt ? resolveAgeBandKey(ageDays, input.ageBands) : null;

  return {
    inventoryItemId: input.item.id,
    generatedAt: generatedAt?.toISOString() ?? "",
    ageDays,
    ageBandKey,
    normalizedState,
    inventoryClass: input.item.inventoryClass,
    nicheKey: input.item.nicheKey,
    proofStatus: evidence.proofStatus,
    verificationStatus: evidence.verificationStatus,
    duplicateStatus: evidence.duplicateStatus,
    reservationStatus: activeReservation ? "active" : "none",
    itemStatus: input.item.status,
    available: blockers.length === 0,
    blockers,
    warnings,
  };
}
