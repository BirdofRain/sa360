import type { LeadAllocation } from "@prisma/client";

import type { LeadInventoryAvailabilityResult } from "./lead-inventory-availability.service.js";
import {
  hasActiveInventoryLinkedHold,
  type InventoryLinkedAllocation,
} from "./lead-inventory-allocation-invariant.service.js";

export type InventoryFacetCategory = "available" | "reserved" | "blocked";

export function classifyInventoryFacetItem(input: {
  availability: LeadInventoryAvailabilityResult;
  inventoryLinkedAllocations: InventoryLinkedAllocation[];
}): InventoryFacetCategory {
  if (hasActiveInventoryLinkedHold(input.inventoryLinkedAllocations)) {
    return "reserved";
  }
  if (input.availability.available) {
    return "available";
  }
  return "blocked";
}

export function mapAllocationsForFacetClassification(
  allocations: Pick<LeadAllocation, "id" | "status" | "leadInventoryItemId" | "releasedAt">[]
): InventoryLinkedAllocation[] {
  return allocations.map((allocation) => ({
    id: allocation.id,
    status: allocation.status,
    leadInventoryItemId: allocation.leadInventoryItemId,
    releasedAt: allocation.releasedAt,
  }));
}

export function assertFacetCellInvariants(cell: {
  total: number;
  available: number;
  reserved: number;
  blocked: number;
  supply: number;
}): boolean {
  return (
    cell.total === cell.available + cell.reserved + cell.blocked &&
    cell.supply === cell.available + cell.reserved
  );
}
