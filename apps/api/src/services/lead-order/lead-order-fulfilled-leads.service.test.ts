import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent } from "@prisma/client";

import { listFulfilledLeadsForClientOrder } from "./lead-order-fulfilled-leads.service.js";
import type { LeadDeliveryJoinContext } from "../lead-delivery/lead-delivery-read.service.js";

function sourceLead(id: string, clientAccountId: string): SourceLeadEvent {
  return {
    id,
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    sourceType: "lead_form",
    sourceRouteKey: null,
    sourceCampaignId: null,
    sourceCampaignName: null,
    sourceFunnelName: null,
    sourceLeadId: null,
    sourceLeadUid: `uid_${id}`,
    clientAccountIdResolved: clientAccountId,
    destinationLocationIdResolved: null,
    routingRuleIdResolved: null,
    status: "delivered",
    rawPayloadJson: {},
    normalizedPayloadJson: {
      contact: {
        first_name: "Pat",
        last_name: "Lee",
        email: "pat@example.com",
        phone_e164: "+15551234567",
      },
    },
    routingResultJson: null,
    duplicateRiskJson: null,
    deliveryResultJson: null,
    enrichmentMetadataJson: null,
    routingDryRunDecisionId: null,
    errorSummary: null,
    webhookRequestLogId: null,
    receivedAt: new Date("2026-07-01T10:00:00.000Z"),
    normalizedAt: new Date("2026-07-01T10:01:00.000Z"),
    routedAt: null,
    approvedAt: null,
    deliveredAt: new Date("2026-07-01T10:05:00.000Z"),
    approvedBy: null,
    bulkImportId: null,
    bulkImportRowId: null,
    cleanupStatus: null,
    cleanupReason: null,
    cleanupMarkedAt: null,
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    updatedAt: new Date("2026-07-01T10:05:00.000Z"),
  };
}

function joinContext(id: string, clientAccountId: string): LeadDeliveryJoinContext {
  return {
    sourceLead: sourceLead(id, clientAccountId),
    decision: null,
    plan: null,
    adapterRun: null,
    liveRun: null,
    clientDisplayName: "Summit",
    timeline: null,
  };
}

const order = {
  id: "ord_a",
  clientAccountId: "acct_a",
};

test("returns only committed allocations for the tenant order", async () => {
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => order as never,
      listCommittedAllocationsForOrderImpl: async () => ({
        items: [
          { id: "alloc_1", sourceLeadEventId: "evt_1", committedAt: new Date() },
          { id: "alloc_2", sourceLeadEventId: "evt_2", committedAt: new Date() },
        ],
        nextCursor: null,
      }),
      listLeadDeliveryReadModelByIdsImpl: async (ids) =>
        ids.map((id) => joinContext(id, "acct_a")),
    }
  );

  assert.ok(result);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.leadOrderId, "ord_a");
  assert.equal(result.items[0]?.id, "evt_1");
  assert.match(result.items[0]?.phoneMasked ?? "", /\*\*\*/);
  assert.equal(result.items[0]?.phoneE164, undefined);
  assert.equal(result.items[0]?.email, undefined);
  assert.equal(result.items[0]?.emailMasked, "p***@example.com");
});

test("missing or foreign order is indistinguishable (null)", async () => {
  const missing = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_missing", clientAccountId: "acct_a", limit: 50 },
    { findLeadOrderByIdImpl: async () => null }
  );
  assert.equal(missing, null);

  const foreign = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_b", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () =>
        ({ id: "ord_b", clientAccountId: "acct_b" }) as never,
    }
  );
  assert.equal(foreign, null);
});

test("drops leads whose resolved tenant does not match the order tenant", async () => {
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => order as never,
      listCommittedAllocationsForOrderImpl: async () => ({
        items: [
          { id: "alloc_own", sourceLeadEventId: "evt_own", committedAt: new Date() },
          { id: "alloc_other", sourceLeadEventId: "evt_other", committedAt: new Date() },
        ],
        nextCursor: null,
      }),
      listLeadDeliveryReadModelByIdsImpl: async () => [
        joinContext("evt_own", "acct_a"),
        joinContext("evt_other", "acct_b"),
      ],
    }
  );

  assert.ok(result);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.id, "evt_own");
});

test("empty committed set returns an empty list, not an inferred match", async () => {
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => order as never,
      listCommittedAllocationsForOrderImpl: async () => ({ items: [], nextCursor: null }),
      listLeadDeliveryReadModelByIdsImpl: async () => {
        throw new Error("should not load unrelated tenant leads");
      },
    }
  );

  assert.deepEqual(result, { items: [], nextCursor: null });
});
