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
import {
  buildPortalAgeUnionOrderLine,
  recordPortalAgeUnionPriceReview,
} from "../services/ppl-fulfillment/ppl-order-pricing.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const PORTAL_KEY = "local-portal-aged-order-test-key";

const PRICED_BUCKETS = [
  ["COMMERCE_1_3_MO", 600, 60_000],
  ["COMMERCE_3_6_MO", 400, 40_000],
  ["COMMERCE_6_9_MO", 300, 30_000],
  ["COMMERCE_9_12_MO", 200, 20_000],
  ["COMMERCE_12_MO_PLUS", 100, 10_000],
] as const;

function agedBody(
  policy: "REFUND_UNFILLED" | "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT",
  requestedAgeBucket = "COMMERCE_6_9_MO",
  leadVolume = 100
) {
  return {
    nicheKey: "vet",
    states: ["TX", "FL"],
    leadVolume,
    campaignType: "Aged leads",
    crmPackage: "lead_delivery",
    aiVoiceAddon: false,
    deliveryDestinationLabel: "Local portal desk",
    unitPriceCents: 1,
    notes: `Need a Monday start\n---\nsa360.portalAgedOptions.v1 ${JSON.stringify({
      requestedAgeBucket,
      shortfallPolicy: policy,
      unitPriceCents: 1,
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

  it("rejects a new 6–12 union and persists each priced bucket from the catalog", async () => {
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

    const union = await postOrder(agedBody("REFUND_UNFILLED", "COMMERCE_6_12_MO", 8));
    assert.equal(union.statusCode, 400, union.body);
    assert.equal((union.json() as { code?: string }).code, "AGED_PRICED_LINE_UNAVAILABLE");
    assert.equal(await db.leadOrder.count({ where: { clientAccountId } }), beforeCount);

    for (const [bucket, unitPriceCents, lineTotalCents] of PRICED_BUCKETS) {
      const created = await postOrder(agedBody("REFUND_UNFILLED", bucket, 100));
      assert.equal(created.statusCode, 201, created.body);
      const item = (
        created.json() as {
          item: {
            id: string;
            agedCommerce: { requestedAgeBucket: string; shortfallPolicy: string };
            pricedPpl: { unitPriceCents: number; lineTotalCents: number; commerceAgeBucketKey: string } | null;
          };
        }
      ).item;
      createdOrderIds.push(item.id);
      assert.equal(item.agedCommerce.requestedAgeBucket, bucket);
      assert.equal(item.agedCommerce.shortfallPolicy, "REFUND_UNFILLED");
      assert.equal(item.pricedPpl?.commerceAgeBucketKey, bucket);
      assert.equal(item.pricedPpl?.unitPriceCents, unitPriceCents);
      assert.equal(item.pricedPpl?.lineTotalCents, lineTotalCents);
      const line = await db.leadOrderLine.findFirst({ where: { leadOrderId: item.id } });
      assert.ok(line);
      assert.deepEqual(line.ageBandKeysJson, [bucket]);
      assert.equal(line.unitPriceCents, unitPriceCents);
      assert.equal(line.lineTotalCents, lineTotalCents);
      assert.notEqual(line.unitPriceCents, 1);
    }

    const consented = await postOrder(
      agedBody("ALLOW_OLDER_WITH_PRICE_ADJUSTMENT", "COMMERCE_9_12_MO", 100)
    );
    assert.equal(consented.statusCode, 201, consented.body);
    const consentedItem = (
      consented.json() as { item: { id: string; agedCommerce: { shortfallPolicy: string } } }
    ).item;
    createdOrderIds.push(consentedItem.id);
    assert.equal(consentedItem.agedCommerce.shortfallPolicy, "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT");
  });

  it("keeps a historical 6–12 union readable without rewriting its saved price", async () => {
    const built = buildPortalAgeUnionOrderLine({
      nicheKey: "vet",
      states: ["TX", "FL"],
      requestedQuantity: 8,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `LO-HIST-${suffix}`,
        clientAccountId,
        clientDisplayName: "Local Portal Aged",
        status: "submitted",
        nicheKey: "vet",
        statesJson: ["TX", "FL"],
        leadVolume: 8,
        campaignType: "Aged leads",
        crmPackage: "lead_delivery",
        deliveryDestinationLabel: "Local portal desk",
        notes: agedBody("REFUND_UNFILLED", "COMMERCE_6_12_MO", 8).notes,
        createdByRole: "client",
        submittedAt: new Date(),
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 8,
        orderLines: { create: [built.data] },
      },
    });
    const orderId = order.id;
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
    assert.ok(lineAfter);
    const meta = lineAfter.metadataJson as { priceReviewedBy?: string; priceReviewFingerprint?: string };
    assert.equal(meta.priceReviewedBy, "alex");
    assert.equal(typeof meta.priceReviewFingerprint, "string");
    assert.ok(meta.priceReviewFingerprint && meta.priceReviewFingerprint.length > 0);

    const released = await previewBuyerCsvExport({ orderId }, prisma);
    assert.equal(released.ok, false);
    if (!released.ok) assert.equal(released.code, "no_exportable_allocations");

    await db.leadOrderLine.update({
      where: { id: lineAfter.id },
      data: { requestedQuantity: 9 },
    });
    const stale = await previewBuyerCsvExport({ orderId }, prisma);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "reviewed_price_required");

    const rereviewed = await recordPortalAgeUnionPriceReview(orderId, "sam", prisma);
    assert.equal(rereviewed.ok, true);
    if (rereviewed.ok) {
      assert.equal(rereviewed.alreadyReviewed, false);
      assert.equal(rereviewed.priceReviewedBy, "sam");
      assert.equal(rereviewed.unitPriceCents, null);
    }
    const afterRereview = await previewBuyerCsvExport({ orderId }, prisma);
    assert.equal(afterRereview.ok, false);
    if (!afterRereview.ok) assert.equal(afterRereview.code, "no_exportable_allocations");
  });
});
