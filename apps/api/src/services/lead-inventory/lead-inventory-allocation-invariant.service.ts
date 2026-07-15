import type { InventoryExclusivityMode, LeadAllocation } from "@prisma/client";

import { LEAD_INVENTORY_SUPPLY_HOLD_STATUSES } from "./lead-inventory.constants.js";

export type InventoryLinkedAllocation = Pick<
  LeadAllocation,
  "id" | "status" | "leadInventoryItemId" | "releasedAt"
>;

export function isInventorySupplyHoldStatus(
  status: LeadAllocation["status"]
): status is (typeof LEAD_INVENTORY_SUPPLY_HOLD_STATUSES)[number] {
  return LEAD_INVENTORY_SUPPLY_HOLD_STATUSES.includes(
    status as (typeof LEAD_INVENTORY_SUPPLY_HOLD_STATUSES)[number]
  );
}

export function getActiveInventoryLinkedAllocations(
  allocations: InventoryLinkedAllocation[]
): InventoryLinkedAllocation[] {
  return allocations.filter(
    (allocation) =>
      allocation.leadInventoryItemId != null && isInventorySupplyHoldStatus(allocation.status)
  );
}

export function hasActiveInventoryLinkedHold(allocations: InventoryLinkedAllocation[]): boolean {
  return getActiveInventoryLinkedAllocations(allocations).length > 0;
}

export function countActiveInventoryLinkedHolds(allocations: InventoryLinkedAllocation[]): number {
  return getActiveInventoryLinkedAllocations(allocations).length;
}

export type InventoryReservationInvariantInput = {
  exclusivityMode: InventoryExclusivityMode;
  maxFulfillments: number;
  fulfillmentCount: number;
  allocations: InventoryLinkedAllocation[];
};

export type InventoryReservationInvariantResult = {
  valid: boolean;
  violations: string[];
  activeHoldCount: number;
  remainingCapacity: number;
};

/**
 * Read-only invariant check for future transactional reservation paths.
 * Does not mutate allocations or inventory items.
 */
export function evaluateInventoryReservationInvariant(
  input: InventoryReservationInvariantInput
): InventoryReservationInvariantResult {
  const activeHolds = getActiveInventoryLinkedAllocations(input.allocations);
  const activeHoldCount = activeHolds.length;
  const remainingCapacity = Math.max(input.maxFulfillments - input.fulfillmentCount - activeHoldCount, 0);
  const violations: string[] = [];

  if (input.maxFulfillments <= 0) violations.push("max_fulfillments_invalid");
  if (input.fulfillmentCount < 0) violations.push("fulfillment_count_negative");
  if (input.fulfillmentCount > input.maxFulfillments) {
    violations.push("fulfillment_count_exceeds_max");
  }

  if (input.exclusivityMode === "exclusive" && activeHoldCount > 1) {
    violations.push("exclusive_multiple_active_holds");
  }

  if (input.fulfillmentCount + activeHoldCount > input.maxFulfillments) {
    violations.push("fulfillment_capacity_exceeded");
  }

  return {
    valid: violations.length === 0,
    violations,
    activeHoldCount,
    remainingCapacity,
  };
}
