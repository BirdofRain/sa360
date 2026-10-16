/** Admin-only buyer inventory availability lookup. Default off. */
export function isBuyerInventoryAvailabilityEnabled(): boolean {
  return process.env.SA360_BUYER_INVENTORY_AVAILABILITY_ENABLED === "true";
}
