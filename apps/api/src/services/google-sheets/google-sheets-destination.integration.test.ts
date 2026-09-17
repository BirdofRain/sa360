/**
 * Local sa360_test-only Google Sheets destination persistence.
 * Injected Google HTTP. No live Sheets/OAuth. Isolated encryption key.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY } from "../../lib/google-sheets-env.js";
import { payloadContainsPlaintextSecret } from "../../lib/token-field-denylist.js";
import { planDeliveryInstructionsForAllocation } from "../fulfillment-shadow/delivery-planning.service.js";
import {
  getGoogleSheetsDestinationForClient,
  saveGoogleSheetsDestinationForClient,
} from "./google-sheets-destination.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const ACCESS = "ya29.phase1c-destination-access";

describe("Google Sheets destination persistence (local sa360_test)", { skip: !runIntegration }, () => {
  let db!: PrismaClient;
  const suffix = `${Date.now()}`;
  const tenantA = `gsheets_a_${suffix}`;
  const tenantB = `gsheets_b_${suffix}`;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: tenantA, clientDisplayName: "Sheets A", status: "active" },
        { clientAccountId: tenantB, clientDisplayName: "Sheets B", status: "active" },
      ],
    });
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup(): Promise<void> {
    await db.deliveryInstruction.deleteMany({
      where: { deliveryTarget: { clientAccountId: { in: [tenantA, tenantB] } } },
    });
    await db.leadAllocation.deleteMany({ where: { clientAccountId: { in: [tenantA, tenantB] } } });
    await db.sourceLeadEvent.deleteMany({
      where: { clientAccountIdResolved: { in: [tenantA, tenantB] } },
    });
    await db.leadOrder.deleteMany({ where: { clientAccountId: { in: [tenantA, tenantB] } } });
    await db.deliveryTarget.deleteMany({ where: { clientAccountId: { in: [tenantA, tenantB] } } });
    await db.googleAccountConnection.deleteMany({
      where: { clientAccountId: { in: [tenantA, tenantB] } },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: [tenantA, tenantB] } } });
  }

  const sheetsDeps = {
    env: { SA360_GOOGLE_SHEETS_DESTINATION_ENABLED: "true" } as NodeJS.ProcessEnv,
    db,
    getAccessToken: async () => ({
      ok: true as const,
      accessToken: ACCESS,
      connectionId: "conn-ref-1",
      tokenVersion: 1,
    }),
    getMetadata: async () => ({
      ok: true as const,
      metadata: {
        spreadsheetId: ID,
        title: "Customer Sheet",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}`,
        worksheets: [{ sheetId: 0, title: "Leads", index: 0, hidden: false, sheetType: "GRID" }],
      },
    }),
    getConnection: async () =>
      ({
        id: "conn-ref-1",
        clientAccountId: tenantA,
        status: "connected",
      }) as never,
  };

  it("AI/AJ/AL. one google_sheets.v1 destination per client; GHL target is unchanged", async () => {
    const ghl = await db.deliveryTarget.create({
      data: {
        clientAccountId: tenantA,
        displayName: "GHL CRM",
        adapterKey: "ghl.crm.v1",
        enabled: true,
        isPrimary: true,
        isRequired: true,
        readinessStatus: "ready_for_shadow",
        configMetadataJson: { destinationSubaccountIdGhl: "loc_keep" },
      },
    });
    const first = await saveGoogleSheetsDestinationForClient(
      tenantA,
      { spreadsheetId: ID, worksheetId: 0, createdBySa360: true },
      sheetsDeps
    );
    const second = await saveGoogleSheetsDestinationForClient(
      tenantA,
      { spreadsheetId: ID, worksheetId: 0, createdBySa360: false },
      {
        ...sheetsDeps,
        getMetadata: async () => ({
          ok: true as const,
          metadata: {
            spreadsheetId: ID,
            title: "Customer Sheet",
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}`,
            worksheets: [{ sheetId: 0, title: "Leads Updated", index: 0, hidden: false, sheetType: "GRID" }],
          },
        }),
      }
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    const sheetsTargets = await db.deliveryTarget.findMany({
      where: { clientAccountId: tenantA, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
    });
    assert.equal(sheetsTargets.length, 1);
    assert.equal(sheetsTargets[0]?.enabled, false);
    assert.equal(sheetsTargets[0]?.isRequired, false);
    const meta = sheetsTargets[0]?.configMetadataJson as Record<string, unknown>;
    assert.equal(meta.worksheetTitle, "Leads Updated");
    assert.equal(meta.createdBySa360, false);
    assert.equal(payloadContainsPlaintextSecret(meta, [ACCESS]), false);

    const ghlAfter = await db.deliveryTarget.findUnique({ where: { id: ghl.id } });
    assert.equal(ghlAfter?.enabled, true);
    assert.equal(ghlAfter?.isRequired, true);
    assert.equal(ghlAfter?.adapterKey, "ghl.crm.v1");
    assert.deepEqual(ghlAfter?.configMetadataJson, { destinationSubaccountIdGhl: "loc_keep" });
  });

  it("AK. another tenant cannot read or update the destination", async () => {
    const foreign = await getGoogleSheetsDestinationForClient(tenantB, {
      ...sheetsDeps,
      getConnection: async () => ({ id: "other", clientAccountId: tenantB, status: "disconnected" }) as never,
    });
    assert.equal(foreign.destination.configured, false);

    const steal = await saveGoogleSheetsDestinationForClient(
      tenantB,
      { spreadsheetId: ID, worksheetId: 0 },
      {
        ...sheetsDeps,
        getConnection: async () => ({ id: "other", clientAccountId: tenantB, status: "connected" }) as never,
      }
    );
    assert.equal(steal.ok, true);
    const aTargets = await db.deliveryTarget.findMany({
      where: { clientAccountId: tenantA, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
    });
    const bTargets = await db.deliveryTarget.findMany({
      where: { clientAccountId: tenantB, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
    });
    assert.equal(aTargets.length, 1);
    assert.equal(bTargets.length, 1);
    assert.notEqual(aTargets[0]?.id, bTargets[0]?.id);
  });

  it("AM/AN/AO/AP. saving a Sheets target does not plan instructions or change allocation/outbox", async () => {
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `ORD-SHEETS-${suffix}`,
        clientAccountId: tenantA,
        status: "active",
        nicheKey: "solar",
        leadVolume: 1,
        campaignType: "lead_gen",
        crmPackage: "basic",
        createdByRole: "admin",
        orderKind: "pay_per_lead",
        fulfillmentMode: "pooled_matching",
        requestedQuantity: 1,
      },
    });
    const event = await db.sourceLeadEvent.create({
      data: {
        sourceLeadUid: `uid_sheets_${suffix}`,
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        rawPayloadJson: {},
        clientAccountIdResolved: tenantA,
        status: "approved",
        normalizedPayloadJson: {},
        enrichmentMetadataJson: {},
      },
    });
    const allocation = await db.leadAllocation.create({
      data: {
        sourceLeadEventId: event.id,
        leadOrderId: order.id,
        clientAccountId: tenantA,
        status: "shadow",
        allocationPolicyVersion: "1.0.0",
        idempotencyKey: `alloc:sheets:${suffix}`,
      },
    });
    const beforeAlloc = await db.leadAllocation.findUnique({ where: { id: allocation.id } });
    const beforeOutbox = await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: event.id } });
    const beforePlan = await planDeliveryInstructionsForAllocation(
      { leadAllocationId: allocation.id, clientAccountId: tenantA },
      db
    );
    const afterPlan = await planDeliveryInstructionsForAllocation(
      { leadAllocationId: allocation.id, clientAccountId: tenantA },
      db
    );
    const afterAlloc = await db.leadAllocation.findUnique({ where: { id: allocation.id } });
    const afterOutbox = await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: event.id } });
    const instructions = await db.deliveryInstruction.findMany({
      where: { leadAllocationId: allocation.id },
      include: { deliveryTarget: true },
    });
    assert.equal(beforePlan.ok, true);
    assert.equal(afterPlan.ok, true);
    assert.equal(instructions.length, 1);
    assert.equal(instructions[0]?.deliveryTarget.adapterKey, "ghl.crm.v1");
    assert.equal(afterAlloc?.status, beforeAlloc?.status);
    assert.equal(afterOutbox, beforeOutbox);
    assert.equal(afterOutbox, 0);
  });
});
