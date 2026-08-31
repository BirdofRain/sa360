/**
 * Combined PR #105 + #106 50-lead beta regression against local sa360_test.
 * Product code is not modified. Injected notification transport only.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { CLIENT_PORTAL_KEY_HEADER } from "../../lib/client-portal-auth.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { SendTransactionalEmailInput } from "../../lib/transactional-email.js";
import {
  countCommittedAllocationsByOrderIds,
  findLeadOrderById,
  updateLeadOrderRecord,
} from "../../repositories/lead-order.repository.js";
import { clientPortalRoutes } from "../../routes/client-portal.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  approveLeadOrder,
  confirmLeadOrderPayment,
} from "../lead-order/lead-order.service.js";
import { presentLeadOrderFulfillment } from "../lead-order/lead-order-fulfillment.present.js";
import { listFulfilledLeadsForClientOrder } from "../lead-order/lead-order-fulfilled-leads.service.js";
import {
  activateFulfillmentOpsOrder,
  createFulfillmentOpsClientLeadOrder,
} from "../fulfillment-ops/fulfillment-ops.service.js";
import {
  BUYER_CSV_V4_FIELD_SCHEMA_VERSION,
  commitBuyerCsvExport,
  getBuyerCsvExportDownload,
  markSpreadsheetDelivered,
  previewBuyerCsvExport,
  sha256Hex,
  SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
} from "./buyer-csv-export.service.js";
import {
  commitPplInventorySelection,
  previewPplInventorySelection,
} from "./inventory-selection.service.js";
import { isPplBuyerReadyLead } from "./ppl-buyer-ready-eligibility.js";
import {
  BUYER_A_CLIENT_ID,
  BUYER_A_EMAIL,
  BUYER_B_CLIENT_ID,
  cleanupFiftyLeadRegression,
  COMMERCE_BUCKET,
  INVALID_COUNT,
  NICHE,
  REQUESTED_QUANTITY,
  seedFiftyLeadRegressionFixture,
  seedSameBuyerRedeliveryCandidates,
  STATE,
  type CandidateSpec,
} from "./integrated-50-lead-beta-regression.fixtures.js";

const integrationUrlRaw =
  process.env.SA360_PPL_INTEGRATION_DATABASE_URL?.trim() ||
  process.env.SA360_TEST_DATABASE_URL?.trim() ||
  "";
const runIntegration = Boolean(integrationUrlRaw);
const PORTAL_KEY = "fifty-lead-beta-portal-key";

function utcDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  out.push(current);
  return out;
}

function parseCsv(csv: string): { headers: string[]; rows: string[][] } {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0);
  const headers = splitCsvLine(lines[0] ?? "");
  const rows = lines.slice(1).map(splitCsvLine);
  return { headers, rows };
}

describe("integrated 50-lead beta regression (#105 + #106)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let previousPortalKey: string | undefined;
  let previousPortalTenant: string | undefined;
  let previousResend: string | undefined;
  let previousFrom: string | undefined;

  before(async () => {
    const integrationUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = integrationUrl;
    process.env.SA360_PPL_SELECTION_ENABLED = "true";
    process.env.SA360_PPL_LOCAL_MIN_QTY = "1";
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    process.env.ADMIN_COC_BASE_URL = "https://portal.example.test";
    previousPortalKey = process.env.CLIENT_PORTAL_API_KEY;
    previousPortalTenant = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
    previousResend = process.env.RESEND_API_KEY;
    previousFrom = process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
    process.env.CLIENT_PORTAL_API_KEY = PORTAL_KEY;
    delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
    delete process.env.RESEND_API_KEY;
    delete process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
    db = new PrismaClient({ datasources: { db: { url: integrationUrl } } });
  });

  after(async () => {
    if (previousPortalKey === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = previousPortalKey;
    if (previousPortalTenant === undefined) delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
    else process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = previousPortalTenant;
    if (previousResend === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResend;
    if (previousFrom === undefined) delete process.env.SA360_TRANSACTIONAL_EMAIL_FROM;
    else process.env.SA360_TRANSACTIONAL_EMAIL_FROM = previousFrom;
    if (db) {
      await cleanupFiftyLeadRegression(db);
      await db.$disconnect();
    }
  });

  function orderDeps() {
    return {
      db,
      findLeadOrderByIdImpl: (id: string) => findLeadOrderById(id, db),
      updateLeadOrderRecordImpl: (
        id: string,
        patch: Parameters<typeof updateLeadOrderRecord>[1]
      ) => updateLeadOrderRecord(id, patch, db),
      findClientAccountByIdImpl: (id: string) => findClientAccountById(id, db),
      countCommittedAllocationsByOrderIdsImpl: (ids: string[]) =>
        countCommittedAllocationsByOrderIds(ids, db),
    };
  }

  async function lifecycleToActive(input: {
    requestedQuantity: number;
    notes: string;
  }) {
    const created = await createFulfillmentOpsClientLeadOrder(
      {
        clientAccountId: BUYER_A_CLIENT_ID,
        clientDisplayName: "Fifty Lead Beta Buyer",
        nicheKey: NICHE,
        states: [STATE],
        requestedQuantity: input.requestedQuantity,
        commerceAgeBucketKey: COMMERCE_BUCKET,
        productType: "aged_leads",
        notes: input.notes,
      },
      db
    );
    assert.equal(created.status, "submitted");
    assert.equal(created.requestedQuantity, input.requestedQuantity);
    assert.equal(created.pricing?.commerceAgeBucketKey, COMMERCE_BUCKET);

    const paid = await confirmLeadOrderPayment(created.id, "fifty-lead-regression", orderDeps());
    assert.equal(paid.ok, true);
    if (!paid.ok) throw new Error("payment_confirm_failed");
    assert.equal(paid.row.paymentConfirmationStatus, "confirmed");
    assert.equal(paid.row.status, "submitted");

    const approved = await approveLeadOrder(created.id, orderDeps());
    assert.equal(approved.ok, true);
    if (!approved.ok) throw new Error("approve_failed");
    assert.equal(approved.row.status, "ready");

    const activated = await activateFulfillmentOpsOrder(created.id, db);
    assert.equal(activated.ok, true);
    if (!activated.ok) throw new Error("activate_failed");
    assert.equal(activated.order.status, "active");
    assert.equal(activated.order.orderKind, "pay_per_lead");
    assert.equal(activated.order.fulfillmentMode, "pooled_matching");
    assert.equal(activated.order.requestedQuantity, input.requestedQuantity);
    return activated.order;
  }

  async function portalApp() {
    const app = Fastify({ logger: false });
    await app.register(clientPortalRoutes, {
      prefix: "/client/v1",
      tenantDeps: { db },
      leadOrderDeps: orderDeps(),
    });
    return app;
  }

  it("reserves exactly 50 buyer-ready vet leads, exports v4, releases once, and isolates tenant B", { timeout: 180_000 }, async () => {
    const fixture = await seedFiftyLeadRegressionFixture(db);
    const invalidIds = new Set(fixture.invalidSpecs.map((row) => row.itemId));
    const validByItemId = new Map(fixture.validSpecs.map((row) => [row.itemId, row]));

    const order = await lifecycleToActive({
      requestedQuantity: REQUESTED_QUANTITY,
      notes: "Integrated 50-lead #105+#106 regression",
    });
    assert.equal(order.requestedQuantity, 50);
    assert.equal(order.pricing?.requestedQuantity, 50);

    const preview = await previewPplInventorySelection(
      {
        orderId: order.id,
        commerceAgeBucketKeys: [COMMERCE_BUCKET],
        requestedQuantity: REQUESTED_QUANTITY,
      },
      db
    );
    assert.equal(preview.ok, true, `preview failed: ${JSON.stringify(preview)}`);
    if (!preview.ok) return;
    assert.equal(preview.requestedQuantity, 50);
    assert.equal(preview.selectedQuantity, 50);
    assert.notEqual(preview.selectedQuantity, 52);
    assert.notEqual(preview.selectedQuantity, 53);
    assert.equal(preview.shortfallQuantity, 0);
    assert.ok(
      (preview.exclusionCounts?.notBuyerReady ?? 0) >= 15,
      `expected selector to reject >=15 buyer-unready rows, got ${preview.exclusionCounts?.notBuyerReady}`
    );
    assert.equal(preview.exclusionCounts?.notBuyerReady, INVALID_COUNT);
    assert.equal(preview.selectedItemIds.length, 50);
    assert.equal(preview.selectedItemIds.some((id) => invalidIds.has(id)), false);

    const reservedEvents = await db.leadInventoryItem.findMany({
      where: { id: { in: preview.selectedItemIds } },
      select: {
        id: true,
        sourceLeadEvent: { select: { id: true, normalizedPayloadJson: true } },
      },
    });
    assert.equal(reservedEvents.length, 50);
    for (const row of reservedEvents) {
      assert.equal(isPplBuyerReadyLead(row.sourceLeadEvent.normalizedPayloadJson), true);
    }

    const committed = await commitPplInventorySelection(
      {
        orderId: order.id,
        commerceAgeBucketKeys: [COMMERCE_BUCKET],
        requestedQuantity: REQUESTED_QUANTITY,
        idempotencyKey: `50beta-select-${order.id}`,
      },
      db
    );
    assert.equal(committed.ok, true, `commit failed: ${JSON.stringify(committed)}`);
    if (!committed.ok) return;
    assert.equal(committed.requestedQuantity, 50);
    assert.equal(committed.selectedQuantity, 50);
    assert.equal(committed.allocationIds?.length, 50);
    assert.equal(committed.selectedItemIds.some((id) => invalidIds.has(id)), false);

    const allocations = await db.leadAllocation.findMany({
      where: { leadOrderId: order.id },
      select: {
        id: true,
        status: true,
        leadInventoryItemId: true,
        sourceLeadEventId: true,
      },
    });
    assert.equal(allocations.length, 50);
    assert.ok(allocations.every((row) => row.status === "reserved"));
    const reservedItemIds = allocations.map((row) => row.leadInventoryItemId).filter(Boolean);
    assert.equal(reservedItemIds.length, 50);
    assert.equal(reservedItemIds.some((id) => id != null && invalidIds.has(id)), false);

    const orderAfterReserve = await db.leadOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(orderAfterReserve.requestedQuantity, 50);
    assert.equal(orderAfterReserve.reservedQuantity, 50);
    assert.notEqual(orderAfterReserve.reservedQuantity, 52);
    assert.notEqual(orderAfterReserve.reservedQuantity, 53);

    const csvPreview = await previewBuyerCsvExport({ orderId: order.id }, db);
    assert.equal(csvPreview.ok, true);
    if (!csvPreview.ok || !("columns" in csvPreview)) return;
    assert.equal(csvPreview.fieldSchemaVersion, BUYER_CSV_V4_FIELD_SCHEMA_VERSION);
    assert.equal(csvPreview.fieldSchemaVersion, "buyer_csv_v4");
    assert.equal(csvPreview.columns[0], "Date Generated");
    assert.equal(csvPreview.columns[1], "Lead Type");
    assert.equal(csvPreview.rowCount, 50);
    assert.equal(csvPreview.columns.includes("ZIP"), false);
    assert.equal(csvPreview.columns.includes("Coverage Amount"), false);
    assert.ok(csvPreview.columns.includes("Age"));
    assert.ok(csvPreview.columns.includes("Branch of Service"));
    assert.ok(csvPreview.columns.includes("Disability Rating"));
    assert.ok(csvPreview.columns.includes("Primary Concern"));

    const exported = await commitBuyerCsvExport(
      { orderId: order.id, idempotencyKey: `50beta-export-${order.id}` },
      db
    );
    assert.equal(exported.ok, true);
    if (!exported.ok) return;
    assert.equal(exported.fieldSchemaVersion, "buyer_csv_v4");
    assert.equal(exported.rowCount, 50);

    const generatedPkg = await db.leadDeliveryExportPackage.findUniqueOrThrow({
      where: { id: exported.exportId },
    });
    assert.equal(generatedPkg.spreadsheetDeliveredAt, null);
    assert.equal(generatedPkg.customerReleaseNotifyStatus, null);

    const parsedGenerated = parseCsv(generatedPkg.csvContent);
    assert.equal(parsedGenerated.headers[0], "Date Generated");
    assert.equal(parsedGenerated.headers[1], "Lead Type");
    assert.equal(parsedGenerated.rows.length, 50);
    assert.equal(parsedGenerated.headers.includes("ZIP"), false);
    assert.equal(parsedGenerated.headers.includes("Coverage Amount"), false);
    const dateIdx = parsedGenerated.headers.indexOf("Date Generated");
    const typeIdx = parsedGenerated.headers.indexOf("Lead Type");
    const ageIdx = parsedGenerated.headers.indexOf("Age");
    const branchIdx = parsedGenerated.headers.indexOf("Branch of Service");
    const concernIdx = parsedGenerated.headers.indexOf("Primary Concern");
    const dates = parsedGenerated.rows.map((row) => row[dateIdx] ?? "");
    assert.deepEqual(dates, [...dates].sort().reverse());
    assert.equal(dates[0], utcDateOnly(fixture.newestValidGeneratedAt));
    assert.equal(dates[dates.length - 1], utcDateOnly(fixture.oldestValidGeneratedAt));
    assert.ok(parsedGenerated.rows.every((row) => row[typeIdx] === "Veteran"));
    assert.ok(parsedGenerated.rows.every((row) => (row[ageIdx] ?? "").trim().length > 0));
    assert.ok(parsedGenerated.rows.every((row) => (row[branchIdx] ?? "").trim().length > 0));
    assert.ok(parsedGenerated.rows.every((row) => (row[concernIdx] ?? "").trim().length > 0));

    const app = await portalApp();
    const portalHeaders = { [CLIENT_PORTAL_KEY_HEADER]: PORTAL_KEY };

    const unreleasedList = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/exports?clientAccountId=${BUYER_A_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(unreleasedList.statusCode, 200);
    const unreleasedListBody = JSON.parse(unreleasedList.body) as { items?: unknown[] };
    assert.equal(Array.isArray(unreleasedListBody.items) && unreleasedListBody.items.length === 0, true);

    const unreleasedDownload = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/exports/${exported.exportId}/download?clientAccountId=${BUYER_A_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(unreleasedDownload.statusCode, 404);
    const unreleasedDownloadBody = JSON.parse(unreleasedDownload.body) as { error?: string };
    assert.equal(unreleasedDownloadBody.error, "Delivery not found");

    const sendCalls: SendTransactionalEmailInput[] = [];
    const released = await markSpreadsheetDelivered(
      {
        exportId: exported.exportId,
        confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
        idempotencyKey: `50beta-release-${exported.exportId}`,
        deliveredBy: "fifty-lead-regression",
      },
      db,
      {
        send: async (input) => {
          sendCalls.push(input);
          return { ok: true as const, id: `fake_${sendCalls.length}` };
        },
      }
    );
    assert.equal(released.ok, true);
    if (!released.ok) return;
    assert.equal(released.idempotentReplay, false);
    assert.equal(released.customerNotification?.status, "sent");
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0]?.to, BUYER_A_EMAIL);

    const replay = await markSpreadsheetDelivered(
      {
        exportId: exported.exportId,
        confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
        idempotencyKey: `50beta-release-${exported.exportId}`,
        deliveredBy: "fifty-lead-regression",
      },
      db,
      {
        send: async (input) => {
          sendCalls.push(input);
          return { ok: true as const, id: "fake_replay" };
        },
      }
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.idempotentReplay, true);
    assert.equal(sendCalls.length, 1);

    const counts = await countCommittedAllocationsByOrderIds([order.id], db);
    const committedCount = counts.get(order.id) ?? 0;
    assert.equal(committedCount, 50);
    const fulfillment = presentLeadOrderFulfillment({
      leadVolume: 50,
      requestedQuantity: 50,
      committedAllocationCount: committedCount,
    });
    assert.ok(fulfillment);
    assert.equal(fulfillment.requestedQuantity, 50);
    assert.equal(fulfillment.fulfilledQuantity, 50);
    assert.equal(fulfillment.remainingQuantity, 0);
    assert.equal(fulfillment.status, "fulfilled");

    const identities = await db.buyerDeliveredIdentity.findMany({
      where: { clientAccountId: BUYER_A_CLIENT_ID, leadAllocationId: { in: released.allocationIds } },
    });
    assert.equal(identities.length, 50);

    const adminDownload = await getBuyerCsvExportDownload(exported.exportId, db);
    assert.equal(adminDownload.ok, true);
    if (!adminDownload.ok) return;
    assert.equal(adminDownload.csv, generatedPkg.csvContent);
    assert.equal(adminDownload.contentSha256, generatedPkg.contentSha256);
    assert.equal(sha256Hex(adminDownload.csv), generatedPkg.contentSha256);

    const releasedList = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/exports?clientAccountId=${BUYER_A_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(releasedList.statusCode, 200);
    const releasedListBody = JSON.parse(releasedList.body) as { items?: Array<{ id: string }> };
    assert.equal(releasedListBody.items?.length, 1);
    assert.equal(releasedListBody.items?.[0]?.id, exported.exportId);

    const customerDownload = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/exports/${exported.exportId}/download?clientAccountId=${BUYER_A_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(customerDownload.statusCode, 200);
    assert.match(String(customerDownload.headers["content-type"]), /text\/csv/);
    assert.equal(customerDownload.body, generatedPkg.csvContent);
    const customerHash = createHash("sha256").update(customerDownload.body, "utf8").digest("hex");
    assert.equal(customerHash, generatedPkg.contentSha256);

    const customerParsed = parseCsv(customerDownload.body);
    assert.equal(customerParsed.rows.length, 50);

    const linked = await listFulfilledLeadsForClientOrder(
      { orderId: order.id, clientAccountId: BUYER_A_CLIENT_ID, limit: 100 },
      orderDeps()
    );
    assert.ok(linked);
    assert.equal(linked.items.length, 50);
    const linkedIds = new Set(linked.items.map((row) => row.id));
    const allocationEventIds = new Set(allocations.map((row) => row.sourceLeadEventId));
    assert.deepEqual(linkedIds, allocationEventIds);

    const tenantBList = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/exports?clientAccountId=${BUYER_B_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(tenantBList.statusCode, 404);

    const tenantBGet = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/exports/${exported.exportId}?clientAccountId=${BUYER_B_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(tenantBGet.statusCode, 404);

    const tenantBDownload = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/exports/${exported.exportId}/download?clientAccountId=${BUYER_B_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(tenantBDownload.statusCode, 404);
    const tenantBDownloadBody = JSON.parse(tenantBDownload.body) as { error?: string };
    assert.equal(tenantBDownloadBody.error, "Delivery not found");

    const tenantBLeads = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/leads?clientAccountId=${BUYER_B_CLIENT_ID}`,
      headers: portalHeaders,
    });
    assert.equal(tenantBLeads.statusCode, 404);

    const firstReserved = reservedItemIds[0];
    assert.ok(firstReserved);
    const clonedFrom = validByItemId.get(firstReserved) as CandidateSpec;
    assert.ok(clonedFrom);
    const extras = await seedSameBuyerRedeliveryCandidates(db, {
      clonedFrom,
      lotId: fixture.lotId,
      now: fixture.now,
    });
    const second = await lifecycleToActive({
      requestedQuantity: 2,
      notes: "Same-buyer redelivery probe",
    });
    const redelivery = await previewPplInventorySelection(
      {
        orderId: second.id,
        commerceAgeBucketKeys: [COMMERCE_BUCKET],
        requestedQuantity: 2,
      },
      db
    );
    assert.equal(redelivery.ok, true);
    if (!redelivery.ok) return;
    assert.equal(redelivery.selectedItemIds.includes(extras.cloneItemId), false);
    assert.ok((redelivery.exclusionCounts?.sameBuyerPriorDelivery ?? 0) >= 1);
    assert.deepEqual(redelivery.selectedItemIds, [extras.freshItemId]);

    const independentSend: SendTransactionalEmailInput[] = [];
    const independent = await markSpreadsheetDelivered(
      {
        exportId: exported.exportId,
        confirmationPhrase: SPREADSHEET_DELIVERY_CONFIRM_PHRASE,
        idempotencyKey: `50beta-release-other-${exported.exportId}`,
        deliveredBy: "fifty-lead-regression",
      },
      db,
      {
        send: async (input) => {
          independentSend.push(input);
          return { ok: false as const, error: "injected_transport_failure" };
        },
      }
    );
    assert.equal(independent.ok, true);
    assert.equal(independentSend.length, 0);

    await app.close();

    console.log(
      JSON.stringify({
        regression: "integrated-50-lead-beta-2026-08-31",
        orderId: order.id,
        exportId: exported.exportId,
        requestedQuantity: 50,
        reservedQuantity: 50,
        committedQuantity: 50,
        notBuyerReady: preview.exclusionCounts?.notBuyerReady,
        invalidReasonCounts: fixture.invalidReasonCounts,
        csvSchema: parsedGenerated.headers,
        firstGeneratedDate: dates[0],
        lastGeneratedDate: dates[dates.length - 1],
        contentSha256: generatedPkg.contentSha256,
        notifySends: sendCalls.length,
        tenantBStatus: {
          list: tenantBList.statusCode,
          get: tenantBGet.statusCode,
          download: tenantBDownload.statusCode,
          leads: tenantBLeads.statusCode,
        },
      })
    );
  });
});
