import type { PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  listCommittedAllocationsForOrder,
  type CommittedOrderAllocationRow,
} from "../../repositories/lead-order.repository.js";
import { presentLeadDeliveryListRow } from "../lead-delivery/lead-delivery-present.service.js";
import {
  listLeadDeliveryReadModelByIds,
  type LeadDeliveryJoinContext,
  type LeadDeliveryReadServiceDeps,
} from "../lead-delivery/lead-delivery-read.service.js";
import type { LeadDeliveryListRow } from "../lead-delivery/lead-delivery.types.js";
import { getLeadOrderForAudience, type LeadOrderServiceDeps } from "./lead-order.service.js";

export type LeadOrderFulfilledLeadRow = LeadDeliveryListRow & {
  leadOrderId: string;
};

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

function resolvedClientAccountId(ctx: LeadDeliveryJoinContext): string | null {
  return ctx.sourceLead.clientAccountIdResolved ?? ctx.decision?.destinationClientAccountId ?? null;
}

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
      clientAccountId: input.clientAccountId,
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
    if (resolvedClientAccountId(ctx) !== input.clientAccountId) continue;
    items.push({
      ...presentLeadDeliveryListRow(ctx, "client"),
      leadOrderId: order.id,
    });
  }

  return { items, nextCursor };
}
