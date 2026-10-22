import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { prisma } from "../lib/db.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { clientPortalRoutes } from "./client-portal.js";
import {
  approveLeadOrder,
  confirmLeadOrderPayment,
} from "../services/lead-order/lead-order.service.js";
import { activateFulfillmentOpsOrder } from "../services/fulfillment-ops/fulfillment-ops.service.js";
import { previewBuyerCsvExport } from "../services/ppl-fulfillment/buyer-csv-export.service.js";
import { recordPortalAgeUnionPriceReview } from "../services/ppl-fulfillment/ppl-order-pricing.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const PORTAL_KEY = "local-portal-aged-order-test-key";

function agedBody(policy: "REFUND_UNFILLED" | "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT") {
  return {
    nicheKey: "vet",
    states: ["TX", "FL"],
    leadVolume: 8,
    campaignType: "Aged leads",
    crmPackage: "lead_delivery",
    aiVoiceAddon: false,
    deliveryDestinationLabel: "Local portal desk",
    notes: `Need a Monday start\n---\nsa360.portalAgedOptions.v1 ${JSON.stringify({
      requestedAgeBucket: "COMMERCE_6_12_MO",
      shortfallPolicy: policy,
    })}`,
  };
}

describe("portal aged order API persistence (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const clientAccountId = `acct_portal_aged_${suffix}`;
  const createdOrderIds: string[] = [];
  let previousPortalKey: string | undefined;
  let previousPortalAccount: string | undefined;
  let previousExportFlag: string | undefined;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    previousPortalKey = process.env.CLIENT_PORTAL_API_KEY;
    previousPortalAccount = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
    previousExportFlag = process.env.SA360_PPL_CSV_EXPORT_ENABLED;
    process.env.CLIENT_PORTAL_API_KEY = PORTAL_KEY;
    process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = clientAccountId;
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    await db.clientAccount.create({
      data: {
        clientAccountId,
        clientDisplayName: "Local Portal Aged",
        status: "active",
        portalEnabled: true,
        portalLoginEmail: `portal-aged-${suffix}@example.com`,
      },
    });
  });

  after(async () => {
    if (db) {
      if (createdOrderIds.length > 0) {
        await db.leadAllocation.deleteMany({ where: { leadOrderId: { in: createdOrderIds } } });
        await db.leadOrderLine.deleteMany({ where: { leadOrderId: { in: createdOrderIds } } });
        await db.leadOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
      }
      await db.clientAccount.deleteMany({ where: { clientAccountId } });
      await db.$disconnect();
    }
    if (previousPortalKey === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = previousPortalKey;
    if (previousPortalAccount === undefined) delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
    else process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = previousPortalAccount;
    if (previousExportFlag === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
    else process.env.SA360_PPL_CSV_EXPORT_ENABLED = previousExportFlag;
  });

  async function postOrder(body: Record<string, unknown>) {
    const app = Fastify({ logger: false });
    await app.register(clientPortalRoutes, { prefix: "/client/v1", tenantDeps: { db } });
    const response = await app.inject({
      method: "POST",
      url: "/client/v1/lead-orders",
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: PORTAL_KEY,
        "content-type": "application/json",
      },
      payload: body,
    });
    await app.close();
    return response;
  }

  it("rejects fresh and live-transfer submissions and persists both 6–12 consents", async () => {
    const beforeCount = await db.leadOrder.count({ where: { clientAccountId } });
    const fresh = await postOrder({
      ...agedBody("REFUND_UNFILLED"),
      campaignType: "Fresh leads",
      notes: "Call after 4",
    });
    const live = await postOrder({
      ...agedBody("REFUND_UNFILLED"),
      campaignType: "Live transfer",
      notes: "Call after 4",
    });
    assert.equal(fresh.statusCode, 400, fresh.body);
    assert.equal((fresh.json() as { code?: string }).code, "PORTAL_AGED_CAMPAIGN_REQUIRED");
    assert.equal(live.statusCode, 400, live.body);
    assert.equal((live.json() as { code?: string }).code, "PORTAL_AGED_CAMPAIGN_REQUIRED");
    assert.equal(await db.leadOrder.count({ where: { clientAccountId } }), beforeCount);

    for (const policy of ["REFUND_UNFILLED", "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT"] as const) {
      const created = await postOrder(agedBody(policy));
      assert.equal(created.statusCode, 201, created.body);
      const item = (created.json() as { item: { id: string; agedCommerce: { requestedAgeBucket: string; shortfallPolicy: string; label: string }; pricedPpl: unknown } }).item;
      createdOrderIds.push(item.id);
      assert.equal(item.agedCommerce.requestedAgeBucket, "COMMERCE_6_12_MO");
      assert.equal(item.agedCommerce.shortfallPolicy, policy);
      assert.equal(item.agedCommerce.label, "6–12 months");
      assert.equal(item.pricedPpl, null);

      const line = await db.leadOrderLine.findFirst({ where: { leadOrderId: item.id } });
      assert.ok(line);
      assert.deepEqual(line.ageBandKeysJson, ["COMMERCE_6_9_MO", "COMMERCE_9_12_MO"]);
      assert.equal(line.minAgeDays, 180);
      assert.equal(line.maxAgeDays, 364);
      assert.equal(line.unitPriceCents, null);
      assert.notEqual(line.unitPriceCents, 0);
      assert.equal(line.lineTotalCents, null);
      assert.deepEqual(line.normalizedStatesJson, ["TX", "FL"]);
      const meta = line.metadataJson as { priceReviewedAt?: string; constituentUnitPriceCents?: Record<string, number> };
      assert.equal(meta.priceReviewedAt, undefined);
      assert.equal(meta.constituentUnitPriceCents?.COMMERCE_6_9_MO, 300);
      assert.equal(meta.constituentUnitPriceCents?.COMMERCE_9_12_MO, 200);
    }
  });

  it("payment, approval, and activation do not invent a price; CSV waits for constituent review", async () => {
    const created = await postOrder(agedBody("REFUND_UNFILLED"));
    assert.equal(created.statusCode, 201, created.body);
    const orderId = (created.json() as { item: { id: string } }).item.id;
    createdOrderIds.push(orderId);

    const confirmed = await confirmLeadOrderPayment(orderId, "alex");
    assert.equal(confirmed.ok, true);
    const approved = await approveLeadOrder(orderId);
    assert.equal(approved.ok, true);
    const activated = await activateFulfillmentOpsOrder(orderId, prisma);
    assert.equal(activated.ok, true);
    if (activated.ok) {
      assert.equal(activated.order.pricing, null);
      assert.equal(activated.order.portalAgeLabel, "6–12 months");
      assert.equal(activated.order.portalAgePriceReviewedAt, null);
      assert.deepEqual(activated.order.selectionCommerceAgeBucketKeys, ["COMMERCE_6_12_MO"]);
    }

    const lineBefore = await db.leadOrderLine.findFirst({ where: { leadOrderId: orderId } });
    assert.equal(lineBefore?.unitPriceCents, null);
    assert.equal(lineBefore?.lineTotalCents, null);

    const blocked = await previewBuyerCsvExport({ orderId }, prisma);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "reviewed_price_required");

    const reviewed = await recordPortalAgeUnionPriceReview(orderId, "alex", prisma);
    assert.equal(reviewed.ok, true);
    if (reviewed.ok) assert.equal(reviewed.unitPriceCents, null);
    const lineAfter = await db.leadOrderLine.findFirst({ where: { leadOrderId: orderId } });
    assert.equal(lineAfter?.unitPriceCents, null);
    assert.equal(lineAfter?.lineTotalCents, null);
    const meta = lineAfter?.metadataJson as { priceReviewedBy?: string };
    assert.equal(meta.priceReviewedBy, "alex");

    const released = await previewBuyerCsvExport({ orderId }, prisma);
    assert.equal(released.ok, false);
    if (!released.ok) assert.equal(released.code, "no_exportable_allocations");
  });
});
