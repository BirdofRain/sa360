import { presentLeadDeliveryListRow } from "../lead-delivery/lead-delivery-present.service.js";
import type { LeadDeliveryJoinContext } from "../lead-delivery/lead-delivery-read.service.js";
import type { LeadDeliveryListRow } from "../lead-delivery/lead-delivery.types.js";

export type LeadOrderFulfilledLeadRow = LeadDeliveryListRow & {
  leadOrderId: string;
};

export type OrderLinkedLeadBuyer = {
  leadOrderId: string;
  buyerClientAccountId: string;
  buyerDisplayName?: string | null;
};

/**
 * Customer-safe order-linked lead row.
 *
 * Reuses the existing client list presenter for contact masking, then rewrites
 * identity fields to the buyer on the already-authorized LeadOrder. Source-lead
 * ownership / original inventory owner must not appear.
 */
export function presentOrderLinkedLeadRow(
  ctx: LeadDeliveryJoinContext,
  buyer: OrderLinkedLeadBuyer
): LeadOrderFulfilledLeadRow {
  const row = presentLeadDeliveryListRow(ctx, "client");
  const buyerName = buyer.buyerDisplayName?.trim() || null;
  return {
    ...row,
    leadOrderId: buyer.leadOrderId,
    clientAccountId: buyer.buyerClientAccountId,
    clientDisplayName: buyerName,
    matchedClient: buyerName ?? "Your account",
    subaccountIdGhl: null,
    contactIdGhl: null,
  };
}
