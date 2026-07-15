import type {
  InventoryLot,
  LeadAllocation,
  LeadInventoryItem,
  LeadProof,
  LeadVerificationResult,
  SourceLeadEvent,
} from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { getProofRequirementPolicy } from "../lead-proof/proof-requirement-policy.registry.js";
import { resolveCanonicalSourceLane } from "../fulfillment-execution/lf2-source-lane.service.js";
import { calculateInventoryAgeDays, resolveAgeBandKey } from "./lead-inventory-age.js";
import {
  LEAD_INVENTORY_ACTIVE_RESERVATION_STATUSES,
  LEAD_INVENTORY_CLOCK_TOLERANCE_MS,
  type LeadInventoryAgeBand,
} from "./lead-inventory.constants.js";

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
  activeAllocations: Pick<LeadAllocation, "status">[];
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

function proofReady(status: string | undefined): boolean {
  return status === "PROOF_ATTACHED";
}

function verificationPassed(status: string | null | undefined): boolean {
  return status === "PASSED";
}

function duplicateAcceptable(status: string | null | undefined): boolean {
  return status === "UNIQUE";
}

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

  const sourceLane = resolveCanonicalSourceLane(input.sourceLeadEvent);
  const proofPolicy = getProofRequirementPolicy(sourceLane);
  const proofStatus = input.leadProof?.proofStatus ?? "UNREVIEWED";
  if (!proofReady(proofStatus)) blockers.push("proof_not_ready");
  if (proofPolicy.requiredArtifacts.length > 0 && proofStatus === "NEEDS_REVIEW") {
    warnings.push("proof_needs_review");
  }

  const verificationStatus = input.verification?.verificationStatus ?? "UNCHECKED";
  const duplicateStatus = input.verification?.duplicateStatus ?? "UNCHECKED";
  if (!verificationPassed(verificationStatus)) blockers.push("verification_not_passed");
  if (!duplicateAcceptable(duplicateStatus)) blockers.push("duplicate_risk");

  const activeReservation = input.activeAllocations.some((allocation) =>
    LEAD_INVENTORY_ACTIVE_RESERVATION_STATUSES.includes(
      allocation.status as (typeof LEAD_INVENTORY_ACTIVE_RESERVATION_STATUSES)[number]
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
    proofStatus,
    verificationStatus,
    duplicateStatus,
    reservationStatus: activeReservation ? "active" : "none",
    itemStatus: input.item.status,
    available: blockers.length === 0,
    blockers,
    warnings,
  };
}
