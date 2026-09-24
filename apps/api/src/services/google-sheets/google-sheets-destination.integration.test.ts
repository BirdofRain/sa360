/**
 * Local sa360_test-only Google Sheets destination persistence.
 * Injected Google HTTP. No live Sheets/OAuth. Isolated encryption key.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY } from "../../lib/google-sheets-env.js";
import { payloadContainsPlaintextSecret } from "../../lib/token-field-denylist.js";
import { planDeliveryInstructionsForAllocation } from "../fulfillment-shadow/delivery-planning.service.js";
import {
  deleteGoogleSheetsDestinationForClient,
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

  // Built per call so the live PrismaClient from `before` is used, and so Google
  // HTTP stays injected. Nothing here reaches sheets.googleapis.com.
  function sheetsDeps(overrides: Record<string, unknown> = {}) {
    return {
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
      ...overrides,
    };
  }

  async function countSheetsTargets(clientAccountId: string): Promise<number> {
    return db.deliveryTarget.count({
      where: { clientAccountId, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
    });
  }

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
      { spreadsheetId: ID, worksheetId: 0 },
      sheetsDeps()
    );
    const second = await saveGoogleSheetsDestinationForClient(
      tenantA,
      { spreadsheetId: ID, worksheetId: 0 },
      sheetsDeps({
        getMetadata: async () => ({
          ok: true as const,
          metadata: {
            spreadsheetId: ID,
            title: "Customer Sheet",
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}`,
            worksheets: [{ sheetId: 0, title: "Leads Updated", index: 0, hidden: false, sheetType: "GRID" }],
          },
        }),
      })
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
    const foreign = await getGoogleSheetsDestinationForClient(
      tenantB,
      sheetsDeps({
        getConnection: async () =>
          ({ id: "other", clientAccountId: tenantB, status: "disconnected" }) as never,
      })
    );
    assert.equal(foreign.destination.configured, false);

    const steal = await saveGoogleSheetsDestinationForClient(
      tenantB,
      { spreadsheetId: ID, worksheetId: 0 },
      sheetsDeps({
        getConnection: async () =>
          ({ id: "other", clientAccountId: tenantB, status: "connected" }) as never,
      })
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

  it("HIGH #2. concurrent first saves settle on exactly one target row", async () => {
    // Reproduces the independent review's probe: no row exists, two callers
    // race the first save at the same moment.
    await db.deliveryTarget.deleteMany({
      where: { clientAccountId: tenantB, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
    });
    assert.equal(await countSheetsTargets(tenantB), 0);

    const deps = sheetsDeps({
      getConnection: async () =>
        ({ id: "conn-ref-1", clientAccountId: tenantB, status: "connected" }) as never,
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        saveGoogleSheetsDestinationForClient(tenantB, { spreadsheetId: ID, worksheetId: 0 }, deps)
      )
    );

    for (const result of results) {
      assert.equal(result.ok, true, `concurrent save failed: ${JSON.stringify(result)}`);
    }
    assert.equal(await countSheetsTargets(tenantB), 1);
  });

  it("HIGH #2. the database itself refuses a second google_sheets.v1 row", async () => {
    const existing = await db.deliveryTarget.findFirst({
      where: { clientAccountId: tenantB, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
    });
    assert.ok(existing);

    await assert.rejects(
      () =>
        db.deliveryTarget.create({
          data: {
            clientAccountId: tenantB,
            displayName: "Duplicate Sheets",
            adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY,
            readinessStatus: "configured",
            configMetadataJson: { spreadsheetId: ID, worksheetId: 0 },
          },
        }),
      (err: unknown) =>
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002"
    );

    // A second GHL target is still allowed; the index is Sheets-scoped only.
    const secondGhl = await db.deliveryTarget.create({
      data: {
        clientAccountId: tenantB,
        displayName: "Second GHL",
        adapterKey: "ghl.crm.v1",
        readinessStatus: "not_configured",
        configMetadataJson: {},
      },
    });
    await db.deliveryTarget.delete({ where: { id: secondGhl.id } });
    assert.equal(await countSheetsTargets(tenantB), 1);
  });

  it("HIGH #2. repeated identical saves stay at one row", async () => {
    const deps = sheetsDeps({
      getConnection: async () =>
        ({ id: "conn-ref-1", clientAccountId: tenantB, status: "connected" }) as never,
    });
    for (let i = 0; i < 3; i += 1) {
      const result = await saveGoogleSheetsDestinationForClient(
        tenantB,
        { spreadsheetId: ID, worksheetId: 0 },
        deps
      );
      assert.equal(result.ok, true);
    }
    assert.equal(await countSheetsTargets(tenantB), 1);
  });

  it("HIGH #2. save racing delete leaves a valid single-row or empty state", async () => {
    const deps = sheetsDeps({
      getConnection: async () =>
        ({ id: "conn-ref-1", clientAccountId: tenantB, status: "connected" }) as never,
    });
    await Promise.all([
      saveGoogleSheetsDestinationForClient(tenantB, { spreadsheetId: ID, worksheetId: 0 }, deps),
      deleteGoogleSheetsDestinationForClient(tenantB, deps),
      saveGoogleSheetsDestinationForClient(tenantB, { spreadsheetId: ID, worksheetId: 0 }, deps),
    ]);
    const count = await countSheetsTargets(tenantB);
    assert.ok(count === 0 || count === 1, `expected 0 or 1 Sheets targets, found ${count}`);
  });

  it("HIGH #2. DELETE with an in-use Sheets target removes nothing", async () => {
    const deps = sheetsDeps({
      getConnection: async () =>
        ({ id: "conn-ref-1", clientAccountId: tenantA, status: "connected" }) as never,
    });
    const saved = await saveGoogleSheetsDestinationForClient(
      tenantA,
      { spreadsheetId: ID, worksheetId: 0 },
      deps
    );
    assert.equal(saved.ok, true);
    const target = await db.deliveryTarget.findFirstOrThrow({
      where: { clientAccountId: tenantA, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
    });
    const allocation = await db.leadAllocation.findFirstOrThrow({
      where: { clientAccountId: tenantA },
    });
    const instruction = await db.deliveryInstruction.create({
      data: {
        leadAllocationId: allocation.id,
        deliveryTargetId: target.id,
        sequence: 99,
        isRequired: false,
        status: "planned",
      },
    });

    const blocked = await deleteGoogleSheetsDestinationForClient(tenantA, deps);
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "destination_in_use");
    assert.equal(await countSheetsTargets(tenantA), 1);

    await db.deliveryInstruction.delete({ where: { id: instruction.id } });
  });

  it("HIGH #2. DELETE of a free target removes the row, calls no Google HTTP, and keeps OAuth", async () => {
    await db.googleAccountConnection.create({
      data: {
        clientAccountId: tenantA,
        googleUserId: `sub_${suffix}`,
        googleEmail: "user@example.com",
        status: "connected",
        accessTokenEncrypted: "cipher",
        refreshTokenEncrypted: "cipher",
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      },
    });
    let googleCalls = 0;
    const deps = sheetsDeps({
      getConnection: async () =>
        ({ id: "conn-ref-1", clientAccountId: tenantA, status: "connected" }) as never,
      getMetadata: async () => {
        googleCalls += 1;
        throw new Error("delete must not call Google");
      },
      createSpreadsheet: async () => {
        googleCalls += 1;
        throw new Error("delete must not call Google");
      },
    });

    assert.equal(await countSheetsTargets(tenantA), 1);
    const removed = await deleteGoogleSheetsDestinationForClient(tenantA, deps);
    assert.equal(removed.ok, true);
    assert.equal(await countSheetsTargets(tenantA), 0);
    assert.equal(googleCalls, 0);

    // The spreadsheet and the Google account connection are untouched.
    const connection = await db.googleAccountConnection.findUnique({
      where: { clientAccountId: tenantA },
    });
    assert.equal(connection?.status, "connected");
    assert.ok(connection?.refreshTokenEncrypted);

    const ghl = await db.deliveryTarget.findMany({
      where: { clientAccountId: tenantA, adapterKey: "ghl.crm.v1" },
    });
    assert.equal(ghl.length, 1);
    assert.equal(ghl[0]?.enabled, true);
  });

  it("LF2 still excludes google_sheets.v1 when DB flags are manually enabled/required", async () => {
    const deps = sheetsDeps({
      getConnection: async () =>
        ({ id: "conn-ref-1", clientAccountId: tenantA, status: "connected" }) as never,
    });
    const saved = await saveGoogleSheetsDestinationForClient(
      tenantA,
      { spreadsheetId: ID, worksheetId: 0 },
      deps
    );
    assert.equal(saved.ok, true);

    // Force the dangerous state the planner gate must survive.
    await db.deliveryTarget.updateMany({
      where: { clientAccountId: tenantA, adapterKey: GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY },
      data: { enabled: true, isRequired: true, isPrimary: true },
    });

    const allocation = await db.leadAllocation.findFirstOrThrow({
      where: { clientAccountId: tenantA },
    });
    await db.deliveryInstruction.deleteMany({ where: { leadAllocationId: allocation.id } });

    const planned = await planDeliveryInstructionsForAllocation(
      { leadAllocationId: allocation.id, clientAccountId: tenantA },
      db
    );
    assert.equal(planned.ok, true);

    const instructions = await db.deliveryInstruction.findMany({
      where: { leadAllocationId: allocation.id },
      include: { deliveryTarget: true },
    });
    assert.equal(instructions.length, 1);
    assert.equal(instructions[0]?.deliveryTarget.adapterKey, "ghl.crm.v1");
    assert.equal(
      instructions.some(
        (row) => row.deliveryTarget.adapterKey === GOOGLE_SHEETS_DELIVERY_ADAPTER_KEY
      ),
      false
    );
  });
});
