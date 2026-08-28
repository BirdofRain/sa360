import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent } from "@prisma/client";

import { listFulfilledLeadsForClientOrder } from "./lead-order-fulfilled-leads.service.js";
import type { LeadDeliveryJoinContext } from "../lead-delivery/lead-delivery-read.service.js";
import {
  presentLeadOrderFulfillment,
  presentLeadOrderFulfillmentSummary,
} from "./lead-order-fulfillment.present.js";

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
    destinationLocationIdResolved: "loc_src",
    routingRuleIdResolved: "rule_src",
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

function joinContext(
  id: string,
  clientAccountId: string,
  displayName = "Summit"
): LeadDeliveryJoinContext {
  return {
    sourceLead: sourceLead(id, clientAccountId),
    decision: null,
    plan: null,
    adapterRun: null,
    liveRun: null,
    clientDisplayName: displayName,
    timeline: null,
  };
}

const buyerOrder = {
  id: "ord_a",
  clientAccountId: "acct_a",
  clientDisplayName: "Summit Insurance",
  requestedQuantity: 5,
};

test("normal committed fulfillment still returns linked leads", async () => {
  const allocationFilters: Array<{ leadOrderId: string; clientAccountId: string }> = [];
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => buyerOrder as never,
      listCommittedAllocationsForOrderImpl: async (filters) => {
        allocationFilters.push({
          leadOrderId: filters.leadOrderId,
          clientAccountId: filters.clientAccountId,
        });
        return {
          items: [
            { id: "alloc_1", sourceLeadEventId: "evt_1", committedAt: new Date() },
            { id: "alloc_2", sourceLeadEventId: "evt_2", committedAt: new Date() },
          ],
          nextCursor: null,
        };
      },
      listLeadDeliveryReadModelByIdsImpl: async (ids) =>
        ids.map((id) => joinContext(id, "acct_a")),
    }
  );

  assert.ok(result);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.leadOrderId, "ord_a");
  assert.equal(result.items[0]?.id, "evt_1");
  assert.equal(result.items[0]?.clientAccountId, "acct_a");
  assert.match(result.items[0]?.phoneMasked ?? "", /\*\*\*/);
  assert.equal(result.items[0]?.phoneE164, undefined);
  assert.equal(result.items[0]?.email, undefined);
  assert.equal(result.items[0]?.emailMasked, "p***@example.com");
  assert.deepEqual(allocationFilters, [{ leadOrderId: "ord_a", clientAccountId: "acct_a" }]);
});

test("PPL aged-inventory committed allocations return linked leads", async () => {
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => buyerOrder as never,
      listCommittedAllocationsForOrderImpl: async () => ({
        items: [
          { id: "alloc_ppl_1", sourceLeadEventId: "evt_aged_1", committedAt: new Date() },
          { id: "alloc_ppl_2", sourceLeadEventId: "evt_aged_2", committedAt: new Date() },
        ],
        nextCursor: null,
      }),
      listLeadDeliveryReadModelByIdsImpl: async () => [
        joinContext("evt_aged_1", "acct_inventory_owner", "Original Inventory Owner LLC"),
        joinContext("evt_aged_2", "acct_inventory_owner", "Original Inventory Owner LLC"),
      ],
    }
  );

  assert.ok(result);
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    result.items.map((row) => row.id),
    ["evt_aged_1", "evt_aged_2"]
  );
  for (const row of result.items) {
    assert.equal(row.leadOrderId, "ord_a");
    assert.equal(row.clientAccountId, "acct_a");
    assert.equal(row.clientDisplayName, "Summit Insurance");
    assert.equal(row.matchedClient, "Summit Insurance");
    assert.equal(row.subaccountIdGhl, null);
    assert.doesNotMatch(JSON.stringify(row), /acct_inventory_owner|Original Inventory Owner|alloc_ppl/);
    assert.match(row.phoneMasked ?? "", /\*\*\*/);
    assert.equal(row.phoneE164, undefined);
    assert.equal(row.email, undefined);
  }
});

test("reserved allocations do not appear", async () => {
  const requestedIds: string[][] = [];
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => buyerOrder as never,
      listCommittedAllocationsForOrderImpl: async () => ({
        items: [{ id: "alloc_committed", sourceLeadEventId: "evt_committed", committedAt: new Date() }],
        nextCursor: null,
      }),
      listLeadDeliveryReadModelByIdsImpl: async (ids) => {
        requestedIds.push(ids);
        return [
          joinContext("evt_committed", "acct_a"),
          joinContext("evt_reserved", "acct_a"),
        ];
      },
    }
  );

  assert.ok(result);
  assert.deepEqual(requestedIds, [["evt_committed"]]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.id, "evt_committed");
});

test("released PPL order with 2 committed of 5 requested returns exactly 2 rows", async () => {
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => buyerOrder as never,
      listCommittedAllocationsForOrderImpl: async () => ({
        items: [
          { id: "alloc_1", sourceLeadEventId: "evt_1", committedAt: new Date() },
          { id: "alloc_2", sourceLeadEventId: "evt_2", committedAt: new Date() },
        ],
        nextCursor: null,
      }),
      listLeadDeliveryReadModelByIdsImpl: async () => [
        joinContext("evt_1", "acct_inventory_owner", "Original Inventory Owner LLC"),
        joinContext("evt_2", "acct_inventory_owner", "Original Inventory Owner LLC"),
      ],
    }
  );

  assert.ok(result);
  assert.equal(result.items.length, 2);

  const fulfillment = presentLeadOrderFulfillment({
    leadVolume: 5,
    requestedQuantity: 5,
    committedAllocationCount: 2,
  });
  assert.deepEqual(fulfillment, {
    requestedQuantity: 5,
    fulfilledQuantity: 2,
    remainingQuantity: 3,
    status: "in_progress",
  });
  assert.equal(presentLeadOrderFulfillmentSummary(fulfillment), "2 of 5 delivered");
  assert.equal(result.items.length, fulfillment?.fulfilledQuantity);
});

test("another tenant cannot request the order or obtain its linked leads", async () => {
  let listed = false;
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_b", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => buyerOrder as never,
      listCommittedAllocationsForOrderImpl: async () => {
        listed = true;
        return {
          items: [{ id: "alloc_1", sourceLeadEventId: "evt_1", committedAt: new Date() }],
          nextCursor: null,
        };
      },
      listLeadDeliveryReadModelByIdsImpl: async () => {
        throw new Error("must not load leads for a foreign tenant");
      },
    }
  );

  assert.equal(result, null);
  assert.equal(listed, false);
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
        ({ id: "ord_b", clientAccountId: "acct_b", clientDisplayName: "Other" }) as never,
      listCommittedAllocationsForOrderImpl: async () => {
        throw new Error("must not list allocations for a foreign order");
      },
    }
  );
  assert.equal(foreign, null);
  assert.deepEqual(missing, foreign);
});

test("empty committed set returns an empty list, not an inferred match", async () => {
  const result = await listFulfilledLeadsForClientOrder(
    { orderId: "ord_a", clientAccountId: "acct_a", limit: 50 },
    {
      findLeadOrderByIdImpl: async () => buyerOrder as never,
      listCommittedAllocationsForOrderImpl: async () => ({ items: [], nextCursor: null }),
      listLeadDeliveryReadModelByIdsImpl: async () => {
        throw new Error("should not load unrelated tenant leads");
      },
    }
  );

  assert.deepEqual(result, { items: [], nextCursor: null });
});
