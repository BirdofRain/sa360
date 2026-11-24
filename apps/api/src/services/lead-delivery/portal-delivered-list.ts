/**
 * Customer Delivered tab.
 *
 * Candidates are the same client, search, and receivedAt window as All.
 * Membership is the customer list badge (`deliveryStatus === "delivered"`),
 * which applies #374's receipt verdict and leaves a source-status delivered
 * row in place when it has no association run. The page is filled from that
 * membership, then the cursor advances. Reads stay inside a fixed scan budget
 * and do not call GoHighLevel.
 */

import {
  listSourceLeadEvents,
  type SourceLeadEventListFilters,
} from "../../repositories/source-lead-event.repository.js";
import { presentLeadDeliveryListRow } from "./lead-delivery-present.service.js";
import {
  joinLeadDeliveryListContexts,
  type LeadDeliveryJoinContext,
  type LeadDeliveryReadServiceDeps,
} from "./lead-delivery-read.service.js";
import { scanPortalDeliveredMembership } from "./portal-delivered-membership.js";

export async function listCustomerDeliveredLeadDelivery(
  filters: SourceLeadEventListFilters,
  deps: LeadDeliveryReadServiceDeps = {}
): Promise<{ items: LeadDeliveryJoinContext[]; nextCursor: string | null }> {
  const clientAccountId = filters.clientAccountIdResolved?.trim();
  if (!clientAccountId) return { items: [], nextCursor: null };

  const list = deps.listSourceLeadEventsImpl ?? listSourceLeadEvents;
  const db = deps.db;
  const pageLimit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const sourceFilters: SourceLeadEventListFilters = {
    sourceProvider: filters.sourceProvider,
    sourceSystem: filters.sourceSystem,
    matched: filters.matched,
    clientAccountIdResolved: clientAccountId,
    includeCleanup: filters.includeCleanup,
    cleanupStatus: filters.cleanupStatus,
    search: filters.search,
    receivedFrom: filters.receivedFrom,
    receivedTo: filters.receivedTo,
  };

  const scanned = await scanPortalDeliveredMembership({
    pageLimit,
    cursor: filters.cursor,
    loadPage: async ({ limit, cursor }) => {
      const page = await list({ ...sourceFilters, limit, cursor }, db);
      const joined = await joinLeadDeliveryListContexts(page.items, deps);
      return {
        items: joined.map((ctx) => ({ id: ctx.sourceLead.id, ctx })),
        nextCursor: page.nextCursor,
      };
    },
    isDelivered: (row) => presentLeadDeliveryListRow(row.ctx, "client").deliveryStatus === "delivered",
  });

  return {
    items: scanned.items.map((row) => row.ctx),
    nextCursor: scanned.nextCursor,
  };
}
