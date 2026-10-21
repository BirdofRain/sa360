import assert from "node:assert/strict";
import test from "node:test";

import { PrismaClient, type Prisma } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { activateFulfillmentOpsOrder } from "./fulfillment-ops.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

/**
 * The activation read goes through this client. After that read returns, reserved
 * quantity moves before the compare-and-set, which is the race the snapshot guards.
 */
function clientWithCapacityRace(db: PrismaClient, orderId: string, reservedQuantity: number): PrismaClient {
  let raced = false;
  const leadOrder = new Proxy(db.leadOrder, {
    get(target, prop, receiver) {
      if (prop === "findUnique") {
        return async (args: Prisma.LeadOrderFindUniqueArgs) => {
          const row = await db.leadOrder.findUnique(args);
          if (!raced) {
            raced = true;
            await db.leadOrder.update({
              where: { id: orderId },
              data: { reservedQuantity },
            });
          }
          return row;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "leadOrder") return leadOrder;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
}

test(
  "fulfillment activation snapshot on local postgres",
  { skip: runIntegration ? false : "SA360_TEST_DATABASE_URL is required" },
  async (t) => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    const db = new PrismaClient({ datasources: { db: { url } } });
    const suffix = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const orderIds: string[] = [];

    t.after(async () => {
      if (orderIds.length > 0) {
        await db.leadOrder.deleteMany({ where: { id: { in: orderIds } } });
      }
      await db.$disconnect();
    });

    async function seedReady(overrides: Partial<Prisma.LeadOrderUncheckedCreateInput> = {}) {
      const order = await db.leadOrder.create({
        data: {
          orderNumber: `LO-ACT-${suffix}-${orderIds.length}`,
          clientAccountId: `acct_activation_${suffix}`,
          status: "ready",
          nicheKey: "vet",
          statesJson: ["TX"],
          leadVolume: 4,
          campaignType: "Live transfer",
          crmPackage: "sim",
          createdByRole: "admin",
          notes: null,
          orderKind: null,
          fulfillmentMode: null,
          requestedQuantity: null,
          reservedQuantity: 0,
          fulfilledQuantity: 0,
          ...overrides,
        },
      });
      orderIds.push(order.id);
      return order;
    }

    await t.test("successful activation persists defaults and repeated calls keep activatedAt", async () => {
      const seeded = await seedReady();
      const activated = await activateFulfillmentOpsOrder(seeded.id, db);
      assert.equal(activated.ok, true);
      if (!activated.ok) return;
      assert.equal(activated.order.status, "active");
      assert.equal(activated.order.orderKind, "pay_per_lead");
      assert.equal(activated.order.fulfillmentMode, "pooled_matching");
      assert.equal(activated.order.requestedQuantity, 4);
      assert.equal(activated.order.allocationReady, true);
      assert.ok(activated.order.activatedAt);

      const stored = await db.leadOrder.findUniqueOrThrow({ where: { id: seeded.id } });
      assert.equal(stored.status, "active");
      assert.equal(stored.orderKind, "pay_per_lead");
      assert.equal(stored.fulfillmentMode, "pooled_matching");
      assert.equal(stored.requestedQuantity, 4);
      assert.equal(stored.pausedAt, null);
      assert.ok(stored.activatedAt);
      assert.ok(stored.fulfillmentCycleStart);
      assert.ok(stored.fulfillmentCycleEnd);
      assert.equal(
        stored.fulfillmentCycleEnd.getTime() - stored.fulfillmentCycleStart.getTime(),
        7 * 24 * 60 * 60 * 1000
      );

      const again = await activateFulfillmentOpsOrder(seeded.id, db);
      assert.equal(again.ok, true);
      if (!again.ok) return;
      assert.equal(again.order.activatedAt, stored.activatedAt.toISOString());
      const reread = await db.leadOrder.findUniqueOrThrow({ where: { id: seeded.id } });
      assert.equal(reread.activatedAt?.getTime(), stored.activatedAt.getTime());
    });

    await t.test("rejected activation does not change the stored order", async () => {
      const seeded = await seedReady({
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 2,
        leadVolume: 2,
        reservedQuantity: 2,
        fulfilledQuantity: 0,
      });
      const before = await db.leadOrder.findUniqueOrThrow({ where: { id: seeded.id } });
      const rejected = await activateFulfillmentOpsOrder(seeded.id, db);
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        assert.equal(rejected.error, "order_not_allocation_ready");
        assert.deepEqual(rejected.reasons, ["order_capacity_exhausted"]);
      }
      const after = await db.leadOrder.findUniqueOrThrow({ where: { id: seeded.id } });
      assert.equal(after.status, "ready");
      assert.equal(after.activatedAt, null);
      assert.equal(after.pausedAt, null);
      assert.equal(after.orderKind, "pay_per_lead");
      assert.equal(after.requestedQuantity, 2);
      assert.equal(after.reservedQuantity, 2);
      assert.equal(after.fulfilledQuantity, 0);
      assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
    });

    await t.test("a paused order activates and clears pausedAt", async () => {
      const pausedAt = new Date("2026-08-02T00:00:00.000Z");
      const seeded = await seedReady({
        status: "paused",
        pausedAt,
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 3,
        leadVolume: 3,
      });
      const activated = await activateFulfillmentOpsOrder(seeded.id, db);
      assert.equal(activated.ok, true);
      if (!activated.ok) return;
      assert.equal(activated.order.status, "active");
      assert.equal(activated.order.allocationReady, true);
      const stored = await db.leadOrder.findUniqueOrThrow({ where: { id: seeded.id } });
      assert.equal(stored.status, "active");
      assert.equal(stored.pausedAt, null);
      assert.ok(stored.activatedAt);
    });

    await t.test("a capacity change after the read invalidates the proposed activation", async () => {
      const seeded = await seedReady({
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 3,
        leadVolume: 3,
        reservedQuantity: 0,
      });
      const racing = clientWithCapacityRace(db, seeded.id, 3);
      const rejected = await activateFulfillmentOpsOrder(seeded.id, racing);
      assert.equal(rejected.ok, false);
      if (!rejected.ok) {
        assert.equal(rejected.error, "order_not_allocation_ready");
        assert.ok(rejected.reasons.includes("order_capacity_exhausted"));
      }
      const stored = await db.leadOrder.findUniqueOrThrow({ where: { id: seeded.id } });
      assert.equal(stored.status, "ready");
      assert.equal(stored.activatedAt, null);
      assert.equal(stored.reservedQuantity, 3);
      assert.equal(stored.orderKind, "pay_per_lead");
      assert.equal(stored.requestedQuantity, 3);
    });
  }
);
