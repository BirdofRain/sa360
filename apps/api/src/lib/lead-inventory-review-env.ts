/** Server-side feature flag for Lead Inventory Review & Activation v1. Default: disabled. */
export function isLeadInventoryReviewEnabled(): boolean {
  const raw = process.env.SA360_LEAD_INVENTORY_REVIEW_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
