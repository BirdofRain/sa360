import { maskSourceLeadUidForAudit } from "../../lib/identity-fingerprint.js";
import type { LeadInventoryAvailabilityResult } from "./lead-inventory-availability.service.js";

export function maskInventoryItemId(id: string): string {
  return maskSourceLeadUidForAudit(id) ?? "inv***";
}

export function presentInventoryItemListRow(input: {
  id: string;
  maskedItemId: string;
  normalizedState: string;
  generatedAt: Date;
  ageDays: number;
  ageBandKey: string | null;
  inventoryClass: string;
  sourceLane: string;
  lotDisplayName: string;
  lotId: string;
  proofStatus: string;
  verificationStatus: string;
  itemStatus: string;
  reservationStatus: string;
  available: boolean;
  blockers: string[];
}) {
  return {
    maskedItemId: input.maskedItemId,
    state: input.normalizedState,
    generatedAt: input.generatedAt.toISOString(),
    ageDays: input.ageDays,
    ageBandKey: input.ageBandKey,
    inventoryClass: input.inventoryClass,
    sourceLane: input.sourceLane,
    lotId: input.lotId,
    lotDisplayName: input.lotDisplayName,
    proofStatus: input.proofStatus,
    verificationStatus: input.verificationStatus,
    inventoryStatus: input.itemStatus,
    reservationStatus: input.reservationStatus,
    available: input.available,
    blockers: input.blockers,
  };
}

export function presentInventoryItemDetail(input: {
  item: {
    id: string;
    status: string;
    generatedAt: Date;
    normalizedState: string;
    nicheKey: string;
    productType: string | null;
    inventoryClass: string;
    sourceLane: string;
    exclusivityMode: string;
    fulfillmentCount: number;
    maxFulfillments: number;
    sourceLeadEventId: string;
  };
  lot: {
    id: string;
    lotKey: string;
    displayName: string;
    status: string;
    inventoryClass: string;
    sourceLane: string;
    nicheKey: string;
  };
  maskedLeadUid: string | null;
  availability: LeadInventoryAvailabilityResult;
  allocationHistory: Array<{
    id: string;
    status: string;
    leadOrderId: string;
    reservedAt: string | null;
    committedAt: string | null;
    releasedAt: string | null;
  }>;
}) {
  return {
    inventoryItemId: input.item.id,
    maskedItemId: maskInventoryItemId(input.item.id),
    sourceLeadEventId: input.item.sourceLeadEventId,
    maskedLeadUid: input.maskedLeadUid,
    generatedAt: input.item.generatedAt.toISOString(),
    ageDays: input.availability.ageDays,
    ageBandKey: input.availability.ageBandKey,
    normalizedState: input.item.normalizedState,
    nicheKey: input.item.nicheKey,
    productType: input.item.productType,
    inventoryClass: input.item.inventoryClass,
    sourceLane: input.item.sourceLane,
    exclusivityMode: input.item.exclusivityMode,
    inventoryStatus: input.item.status,
    fulfillmentCount: input.item.fulfillmentCount,
    maxFulfillments: input.item.maxFulfillments,
    lot: {
      id: input.lot.id,
      lotKey: input.lot.lotKey,
      displayName: input.lot.displayName,
      status: input.lot.status,
      inventoryClass: input.lot.inventoryClass,
      sourceLane: input.lot.sourceLane,
      nicheKey: input.lot.nicheKey,
    },
    proofReadiness: {
      proofStatus: input.availability.proofStatus,
      verificationStatus: input.availability.verificationStatus,
      duplicateStatus: input.availability.duplicateStatus,
    },
    reservationStatus: input.availability.reservationStatus,
    available: input.availability.available,
    blockers: input.availability.blockers,
    warnings: input.availability.warnings,
    allocationHistory: input.allocationHistory,
  };
}
