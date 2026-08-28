import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  listCommittedAllocationsForOrder,
  type CommittedOrderAllocationRow,
} from "../../repositories/lead-order.repository.js";
import {
  listLeadDeliveryReadModelByIds,
  type LeadDeliveryReadServiceDeps,
} from "../lead-delivery/lead-delivery-read.service.js";
import {
  presentOrderLinkedLeadRow,
  type LeadOrderFulfilledLeadRow,
} from "./lead-order-fulfilled-leads.present.js";
import { getLeadOrderForAudience, type LeadOrderServiceDeps } from "./lead-order.service.js";

export type { LeadOrderFulfilledLeadRow } from "./lead-order-fulfilled-leads.present.js";

export type LeadOrderFulfilledLeadsResponse = {
  ok: true;
  items: LeadOrderFulfilledLeadRow[];
  nextCursor: string | null;
};

export type LeadOrderFulfilledLeadsServiceDeps = LeadOrderServiceDeps &
  LeadDeliveryReadServiceDeps & {
    db?: PrismaClient;
    listCommittedAllocationsForOrderImpl?: typeof listCommittedAllocationsForOrder;
    listLeadDeliveryReadModelByIdsImpl?: typeof listLeadDeliveryReadModelByIds;
  };

/**
 * Customer order-linked leads.
 *
 * Security chain (do not replace with source-lead ownership):
 * 1. `getLeadOrderForAudience` proves the LeadOrder belongs to the portal tenant.
 * 2. `listCommittedAllocationsForOrder` returns only `status=committed` rows for
 *    that order whose `LeadAllocation.clientAccountId` is the buyer.
 * 3. Source-lead `clientAccountIdResolved` is the original inventory/source
 *    owner and must not override the explicit buyer-order allocation link.
 */
export async function listFulfilledLeadsForClientOrder(
  input: {
    orderId: string;
    clientAccountId: string;
    limit: number;
    cursor?: string;
  },
  deps: LeadOrderFulfilledLeadsServiceDeps = {}
): Promise<{ items: LeadOrderFulfilledLeadRow[]; nextCursor: string | null } | null> {
  const order = await getLeadOrderForAudience(input.orderId, input.clientAccountId, deps);
  if (!order) return null;

  const listAllocations = deps.listCommittedAllocationsForOrderImpl ?? listCommittedAllocationsForOrder;
  const listByIds = deps.listLeadDeliveryReadModelByIdsImpl ?? listLeadDeliveryReadModelByIds;
  const db = deps.db ?? prisma;

  const { items: allocations, nextCursor } = await listAllocations(
    {
      leadOrderId: order.id,
      clientAccountId: order.clientAccountId,
      limit: input.limit,
      cursor: input.cursor,
    },
    db
  );

  if (allocations.length === 0) {
    return { items: [], nextCursor };
  }

  const joined = await listByIds(
    allocations.map((row: CommittedOrderAllocationRow) => row.sourceLeadEventId),
    deps
  );
  const joinedById = new Map(joined.map((ctx) => [ctx.sourceLead.id, ctx]));

  const items: LeadOrderFulfilledLeadRow[] = [];
  for (const allocation of allocations) {
    const ctx = joinedById.get(allocation.sourceLeadEventId);
    if (!ctx) continue;
    items.push(
      presentOrderLinkedLeadRow(ctx, {
        leadOrderId: order.id,
        buyerClientAccountId: order.clientAccountId,
        buyerDisplayName: order.clientDisplayName,
      })
    );
  }

  return { items, nextCursor };
}
