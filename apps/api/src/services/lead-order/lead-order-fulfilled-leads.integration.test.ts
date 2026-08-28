import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  countCommittedAllocationsByOrderIds,
  findLeadOrderById,
  listCommittedAllocationsForOrder,
} from "../../repositories/lead-order.repository.js";
import { listFulfilledLeadsForClientOrder } from "./lead-order-fulfilled-leads.service.js";
import {
  presentLeadOrderFulfillment,
  presentLeadOrderFulfillmentSummary,
} from "./lead-order-fulfillment.present.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

describe("PPL order-linked leads (requested 5 / committed 2)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const buyer = `acct_ppl_buyer_${suffix}`;
  const other = `acct_ppl_other_${suffix}`;
  const inventoryOwner = `acct_ppl_inventory_${suffix}`;
  let orderId = "";
  let otherOrderId = "";
  const sourceLeadIds: string[] = [];
  const allocationIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });

    const order = await db.leadOrder.create({
      data: {
        orderNumber: `LO-PPL-LINK-${suffix}`,
        clientAccountId: buyer,
        clientDisplayName: "Summit Insurance",
        status: "active",
        nicheKey: "vet",
        statesJson: ["TX"],
        leadVolume: 5,
        campaignType: "aged",
        crmPackage: "test",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 5,
      },
    });
    orderId = order.id;

    const otherOrder = await db.leadOrder.create({
      data: {
        orderNumber: `LO-PPL-OTH-${suffix}`,
        clientAccountId: other,
        clientDisplayName: "Other Buyer",
        status: "active",
        nicheKey: "vet",
        statesJson: ["TX"],
        leadVolume: 5,
        campaignType: "aged",
        crmPackage: "test",
        createdByRole: "admin",
        submittedAt: new Date(),
        activatedAt: new Date(),
        requestedQuantity: 5,
      },
    });
    otherOrderId = otherOrder.id;

    for (const tag of ["committed_a", "committed_b", "reserved"]) {
      const event = await db.sourceLeadEvent.create({
        data: {
          sourceProvider: "facebook",
          sourceSystem: "meta_lead_ads",
          sourceType: "lead_form",
          sourceLeadUid: `uid_ppl_${tag}_${suffix}`,
          clientAccountIdResolved: inventoryOwner,
          destinationLocationIdResolved: "loc_original_owner",
          status: "delivered",
          rawPayloadJson: {},
          normalizedPayloadJson: {
            contact: {
              first_name: tag === "reserved" ? "Res" : "Pat",
              last_name: "Lee",
              email: `${tag}@example.com`,
              phone_e164: tag === "reserved" ? "+15550000000" : "+15551234567",
            },
          },
          receivedAt: new Date("2026-07-01T10:00:00.000Z"),
          deliveredAt: new Date("2026-07-01T10:05:00.000Z"),
        },
      });
      sourceLeadIds.push(event.id);

      const allocation = await db.leadAllocation.create({
        data: {
          sourceLeadEventId: event.id,
          leadOrderId: orderId,
          clientAccountId: buyer,
          status: tag === "reserved" ? "reserved" : "committed",
          allocationPolicyVersion: "ppl-order-linked-leads-test",
          decisionReasonsJson: ["ppl_aged_inventory"],
          candidateCount: 5,
          idempotencyKey: `ppl-link-${tag}-${suffix}`,
          proposedAt: new Date(),
          reservedAt: new Date(),
          committedAt: tag === "reserved" ? null : new Date(),
        },
      });
      allocationIds.push(allocation.id);
    }
  });

  after(async () => {
    if (!db) return;
    if (allocationIds.length) {
      await db.leadAllocation.deleteMany({ where: { id: { in: allocationIds } } });
    }
    if (sourceLeadIds.length) {
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: sourceLeadIds } } });
    }
    await db.leadOrder.deleteMany({
      where: { id: { in: [orderId, otherOrderId].filter(Boolean) } },
    });
    await db.$disconnect();
  });

  it("returns exactly the two committed PPL allocations as buyer-safe leads", async () => {
    const committed = await listCommittedAllocationsForOrder(
      { leadOrderId: orderId, clientAccountId: buyer, limit: 50 },
      db
    );
    assert.equal(committed.items.length, 2);

    const counts = await countCommittedAllocationsByOrderIds([orderId], db);
    assert.equal(counts.get(orderId), 2);

    const fulfillment = presentLeadOrderFulfillment({
      leadVolume: 5,
      requestedQuantity: 5,
      committedAllocationCount: counts.get(orderId) ?? 0,
    });
    assert.equal(presentLeadOrderFulfillmentSummary(fulfillment), "2 of 5 delivered");

    const result = await listFulfilledLeadsForClientOrder(
      { orderId, clientAccountId: buyer, limit: 50 },
      { db, findLeadOrderByIdImpl: (id) => findLeadOrderById(id, db) }
    );
    assert.ok(result);
    assert.equal(result.items.length, 2);
    assert.deepEqual(new Set(result.items.map((row) => row.id)), new Set(sourceLeadIds.slice(0, 2)));
    for (const row of result.items) {
      assert.equal(row.leadOrderId, orderId);
      assert.equal(row.clientAccountId, buyer);
      assert.equal(row.clientDisplayName, "Summit Insurance");
      assert.match(row.phoneMasked ?? "", /\*\*\*/);
      assert.equal(row.phoneE164, undefined);
      assert.equal(row.email, undefined);
      assert.doesNotMatch(JSON.stringify(row), new RegExp(`${inventoryOwner}|loc_original_owner|alloc_`));
    }
    assert.equal(result.items.some((row) => row.id === sourceLeadIds[2]), false);
  });

  it("treats another tenant and a missing order as the same safe miss", async () => {
    const deps = { db, findLeadOrderByIdImpl: (id: string) => findLeadOrderById(id, db) };
    const foreign = await listFulfilledLeadsForClientOrder(
      { orderId, clientAccountId: other, limit: 50 },
      deps
    );
    const missing = await listFulfilledLeadsForClientOrder(
      { orderId: "ord_missing_ppl", clientAccountId: buyer, limit: 50 },
      deps
    );
    const otherOrder = await listFulfilledLeadsForClientOrder(
      { orderId: otherOrderId, clientAccountId: buyer, limit: 50 },
      deps
    );
    assert.equal(foreign, null);
    assert.equal(missing, null);
    assert.equal(otherOrder, null);
  });
});
