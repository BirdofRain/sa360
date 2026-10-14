import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import { PPL_AGED_PRICING_VERSION } from "@sa360/shared";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { createLeadOrderRecord } from "../../repositories/lead-order.repository.js";
import { createClientLeadOrder } from "./lead-order.service.js";
import {
  applyAuthorizedPortalAgedOrderLineRepair,
  type PortalAgedOrderLineRepairExpectedSnapshot,
} from "./portal-aged-commerce.js";
import { buildPplOrderLineCreateData } from "../ppl-fulfillment/ppl-order-pricing.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const NOTES =
  'Need a Monday start\n---\nsa360.portalAgedOptions.v1 {"requestedAgeBucket":"COMMERCE_6_9_MO","shortfallPolicy":"REFUND_UNFILLED"}';
const STATES = ["CO", "KS", "CT", "DE", "FL", "GA", "HI", "AZ"];

function expectedSnapshot(): PortalAgedOrderLineRepairExpectedSnapshot {
  return {
    clientAccountId: "acct_hebda_repair",
    nicheKey: "vet",
    states: STATES,
    leadVolume: 3,
    paymentConfirmationStatus: "not_required",
    status: "active",
    unitPriceCents: 300,
    pricingVersion: PPL_AGED_PRICING_VERSION,
  };
}

describe("portal aged line repair (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const createdOrderIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  after(async () => {
    if (db && createdOrderIds.length > 0) {
      await db.leadOrderLine.deleteMany({ where: { leadOrderId: { in: createdOrderIds } } });
      await db.leadOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    }
    await db?.$disconnect();
  });

  it("nested priced-line create is atomic: duplicate lineNumber rolls back the order", async () => {
    const orderNumber = `LO-ATOMIC-${suffix}`;
    const priced = buildPplOrderLineCreateData({
      nicheKey: "vet",
      states: STATES,
      requestedQuantity: 3,
      commerceAgeBucketKey: "COMMERCE_6_9_MO",
    });
    assert.equal(priced.ok, true);
    if (!priced.ok) return;

    await assert.rejects(
      () =>
        db.leadOrder.create({
          data: {
            orderNumber,
            clientAccountId: "acct_hebda_repair",
            status: "submitted",
            nicheKey: "vet",
            statesJson: STATES,
            leadVolume: 3,
            campaignType: "Aged leads",
            crmPackage: "lead_delivery",
            createdByRole: "client",
            submittedAt: new Date(),
            orderLines: { create: [priced.data, priced.data] },
          },
        }),
      /Unique constraint|P2002/i
    );
    const leftover = await db.leadOrder.findUnique({ where: { orderNumber } });
    assert.equal(leftover, null);
  });

  it("portal create persists the order and priced line together", async () => {
    const created = await createClientLeadOrder(
      {
        nicheKey: "vet",
        states: STATES,
        leadVolume: 3,
        campaignType: "Aged leads",
        crmPackage: "lead_delivery",
        aiVoiceAddon: false,
        deliveryDestinationLabel: "Sam Hebda test client",
        notes: NOTES,
      },
      "acct_hebda_repair",
      {
        findClientAccountByIdImpl: (async () => ({
          id: "acct_hebda_repair",
          status: "active",
          clientDisplayName: "Sam Hebda test client",
        })) as never,
        nextLeadOrderNumberImpl: (async () => `LO-PORTAL-${suffix}`) as never,
        createLeadOrderRecordImpl: (async (data) => createLeadOrderRecord(data, db)) as never,
      }
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    createdOrderIds.push(created.row.id);
    const lines = await db.leadOrderLine.findMany({ where: { leadOrderId: created.row.id } });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.lineNumber, 1);
    assert.equal(lines[0]?.unitPriceCents, 300);
    assert.equal(lines[0]?.requestedQuantity, 3);
  });

  it("authorized local apply writes one line and concurrent retries do not duplicate", async () => {
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `LO-1060-REP-${suffix}`,
        clientAccountId: "acct_hebda_repair",
        clientDisplayName: "Sam Hebda test client",
        status: "active",
        nicheKey: "vet",
        statesJson: STATES,
        leadVolume: 3,
        campaignType: "Aged leads",
        crmPackage: "lead_delivery",
        createdByRole: "client",
        submittedAt: new Date(),
        activatedAt: new Date(),
        notes: NOTES,
        paymentConfirmationStatus: "not_required",
        reservedQuantity: 0,
        fulfilledQuantity: 0,
        proposedQuantity: 0,
      },
    });
    createdOrderIds.push(order.id);

    const input = {
      orderId: order.id,
      expected: expectedSnapshot(),
      authorization: {
        confirmed: true as const,
        ticket: "LO-1060-REPAIR-LOCAL",
        orderNumber: order.orderNumber,
      },
      environment: "local_test" as const,
    };

    const [first, second] = await Promise.all([
      applyAuthorizedPortalAgedOrderLineRepair(input, db),
      applyAuthorizedPortalAgedOrderLineRepair(input, db),
    ]);
    const wrote = [first, second].filter((row) => row.wrote);
    const already = [first, second].filter((row) => row.eligible && row.alreadyRepaired);
    assert.ok(wrote.length <= 1);
    assert.ok(wrote.length + already.length === 2 || [first, second].some((row) => !row.eligible && row.code === "concurrent_repair_conflict"));
    const lines = await db.leadOrderLine.findMany({ where: { leadOrderId: order.id } });
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.unitPriceCents, 300);
    assert.equal(lines[0]?.lineNumber, 1);

    const retry = await applyAuthorizedPortalAgedOrderLineRepair(input, db);
    assert.equal(retry.eligible, true);
    assert.equal(retry.alreadyRepaired, true);
    assert.equal(retry.wrote, false);
    const after = await db.leadOrderLine.findMany({ where: { leadOrderId: order.id } });
    assert.equal(after.length, 1);
  });

  it("apply fails closed when the live order status is no longer repairable", async () => {
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `LO-1060-CAN-${suffix}`,
        clientAccountId: "acct_hebda_repair",
        status: "canceled",
        nicheKey: "vet",
        statesJson: STATES,
        leadVolume: 3,
        campaignType: "Aged leads",
        crmPackage: "lead_delivery",
        createdByRole: "client",
        submittedAt: new Date(),
        canceledAt: new Date(),
        notes: NOTES,
        paymentConfirmationStatus: "not_required",
      },
    });
    createdOrderIds.push(order.id);
    const result = await applyAuthorizedPortalAgedOrderLineRepair(
      {
        orderId: order.id,
        expected: expectedSnapshot(),
        authorization: {
          confirmed: true,
          ticket: "LO-1060-REPAIR-LOCAL",
          orderNumber: order.orderNumber,
        },
        environment: "local_test",
      },
      db
    );
    assert.equal(result.eligible, false);
    assert.equal(result.wrote, false);
    if (!result.eligible) assert.equal(result.code, "order_status_changed");
    const lines = await db.leadOrderLine.findMany({ where: { leadOrderId: order.id } });
    assert.equal(lines.length, 0);
  });
});
