/**
 * Local sa360_test coverage for the company Sheets writer. No live Google calls.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import {
  COMPANY_SHEETS_LEAD_HEADER,
  COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
} from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { sha256Hex } from "../ppl-fulfillment/buyer-csv-export.service.js";
import {
  adminCompanySheetsDeliveryRoutes,
  clientCompanySheetsDeliveryRoutes,
} from "../../routes/company-sheets-delivery.js";
import {
  enqueueAuthorizedAgedReleaseSheetsDelivery,
  enqueueCompanySheetsCanary,
  enqueueConfirmedLeadSheetsDelivery,
  executeCompanySheetsDeliveryJob,
  releaseCompanySheetsDeliveryHold,
  setCompanySheetsCanaryApproval,
  type CompanySheetsDeliveryDeps,
} from "./company-sheets-delivery.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "sheets@lifeagentlaunch.test";
const HEADER = "x-sa360-admin-key";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

type AppendMode =
  | null
  | "throw-before-write"
  | "throw-after-write"
  | "throw-after-write-blind"
  | "partial"
  | "server-after-write";

class MemorySheet {
  rows: string[][] = [];
  appends: string[][][] = [];
  updates: string[][][] = [];
  calls = 0;
  failAppend: AppendMode = null;
  holdAppend: Promise<void> | null = null;
  onAppendEntered: (() => void) | null = null;
  failColumnAfterAppend = false;
  truncateColumn = false;

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.calls += 1;
    if (url.includes("USER_ENTERED") || url.includes("/permissions") || url.includes("type=anyone")) {
      throw new Error(`refused Google call ${url}`);
    }
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    if (method === "PUT") {
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.updates.push(values);
      this.rows[0] = values[0] ?? [];
      return json(200, {});
    }
    if (method === "POST") {
      this.onAppendEntered?.();
      if (this.holdAppend) await this.holdAppend;
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push(values);
      if (this.failAppend === "throw-before-write") throw new Error("timeout");
      if (this.failAppend === "partial") {
        const [first] = values;
        if (first) this.rows.push(first);
        throw new Error("timeout");
      }
      if (this.failAppend === "throw-after-write" || this.failAppend === "throw-after-write-blind") {
        for (const row of values) this.rows.push(row);
        if (this.failAppend === "throw-after-write-blind") this.failColumnAfterAppend = true;
        throw new Error("timeout");
      }
      if (this.failAppend === "server-after-write") {
        for (const row of values) this.rows.push(row);
        return json(503, {});
      }
      for (const row of values) this.rows.push(row);
      return json(200, {});
    }
    const decoded = decodeURIComponent(url);
    if (decoded.includes("A1:ZZ2")) return json(200, { values: this.rows.slice(0, 2) });
    if (decoded.includes("!A1:A")) {
      if (this.failColumnAfterAppend) {
        this.failColumnAfterAppend = false;
        throw new Error("timeout");
      }
      if (this.truncateColumn) {
        return json(200, { values: Array.from({ length: 5001 }, () => ["other-row"]) });
      }
      return json(200, { values: this.rows.map((row) => [row[0] ?? ""]) });
    }
    return json(200, { values: [] });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}`;
}

function csvDocument(rows: string[][]): string {
  return ["first_name,note", ...rows.map((row) => row.join(","))].join("\n") + "\n";
}

describe("company sheets durable writer (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const role = ["lead", "aged", "canary", "partial", "uncertain", "blind", "mismatch", "conflict", "buried", "truncate", "control", "race"] as const;
  const client: Record<(typeof role)[number], string> = {
    lead: `csw_lead_${suffix}`,
    aged: `csw_aged_${suffix}`,
    canary: `csw_canary_${suffix}`,
    partial: `csw_partial_${suffix}`,
    uncertain: `csw_uncertain_${suffix}`,
    blind: `csw_blind_${suffix}`,
    mismatch: `csw_mismatch_${suffix}`,
    conflict: `csw_conflict_${suffix}`,
    buried: `csw_buried_${suffix}`,
    truncate: `csw_truncate_${suffix}`,
    control: `csw_control_${suffix}`,
    race: `csw_race_${suffix}`,
  };
  const sheetId: Record<(typeof role)[number], string> = {
    lead: `sheetLead${suffix}`,
    aged: `sheetAged${suffix}`,
    canary: `sheetCanary${suffix}`,
    partial: `sheetPartial${suffix}`,
    uncertain: `sheetUncertain${suffix}`,
    blind: `sheetBlind${suffix}`,
    mismatch: `sheetMismatch${suffix}`,
    conflict: `sheetConflict${suffix}`,
    buried: `sheetBuried${suffix}`,
    truncate: `sheetTruncate${suffix}`,
    control: `sheetControl${suffix}`,
    race: `sheetRace${suffix}`,
  };
  const leadRetarget = `sheetLeadMoved${suffix}`;
  const agedRetarget = `sheetAgedMoved${suffix}`;
  const canaryRetarget = `sheetCanaryMoved${suffix}`;
  const sheets = new Map<string, MemorySheet>();
  const leadIds: string[] = [];
  const orderIds: string[] = [];
  let connectionId = "";
  const world: {
    token: "ok" | "expired" | "other";
    drive: "owned" | "foreign" | "shared" | "denied";
    metadata: "ok" | "network";
  } = { token: "ok", drive: "owned", metadata: "ok" };

  function sheetFor(id: string): MemorySheet {
    let sheet = sheets.get(id);
    if (!sheet) {
      sheet = new MemorySheet();
      sheets.set(id, sheet);
    }
    return sheet;
  }

  function testEnv(execution: boolean, sheetsEnabled = true): NodeJS.ProcessEnv {
    const env = { ...process.env };
    env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED = sheetsEnabled ? "true" : "false";
    env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED = execution ? "true" : "false";
    return env;
  }

  function deps(overrides: Partial<CompanySheetsDeliveryDeps> = {}): CompanySheetsDeliveryDeps {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const match = url.match(/spreadsheets\/([^/]+)/);
      const id = match?.[1] ? decodeURIComponent(match[1]) : "";
      return sheetFor(id).fetch(url, init);
    };
    return {
      env: testEnv(true),
      db,
      now: () => new Date(),
      fetchImpl,
      getAccessToken: async () => {
        if (world.token === "expired") return { ok: false, code: "google_reconnect_required" };
        return {
          ok: true,
          accessToken: "ya29.writer-test",
          connectionId: world.token === "other" ? "other-connection" : connectionId,
          tokenVersion: 1,
          googleEmail: EMAIL,
        };
      },
      getMetadata: async (input: { spreadsheetId: string }) => {
        if (world.metadata === "network") return { ok: false, reason: "network_error" as const };
        return {
          ok: true as const,
          metadata: {
            spreadsheetId: input.spreadsheetId,
            title: "Writer",
            spreadsheetUrl: sheetUrl(input.spreadsheetId),
            worksheets: [
              { sheetId: 0, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" },
              { sheetId: 1, title: "Aged Orders", index: 1, hidden: false, sheetType: "GRID" },
              { sheetId: 2, title: "Canary", index: 2, hidden: false, sheetType: "GRID" },
            ],
          },
        };
      },
      getDriveFile: async (input: { fileId: string }) => {
        if (world.drive === "denied") return { ok: false, reason: "access_denied" as const };
        return {
          ok: true as const,
          file: {
            id: input.fileId,
            name: "Writer",
            mimeType: "application/vnd.google-apps.spreadsheet",
            ownedByMe: world.drive !== "foreign",
            ownerEmails: world.drive === "foreign" ? ["other@example.com"] : [EMAIL],
            driveId: world.drive === "shared" ? "shared-drive" : null,
          },
        };
      },
      ...overrides,
    };
  }

  async function createLead(clientAccountId: string | null, phone = "5550100") {
    const lead = await db.sourceLeadEvent.create({
      data: {
        sourceLeadUid: `uid_${suffix}_${leadIds.length}_${Math.random().toString(16).slice(2)}`,
        sourceProvider: "manual_import",
        sourceSystem: "external_vendor",
        sourceType: "manual_entry",
        rawPayloadJson: { untouched: true },
        clientAccountIdResolved: clientAccountId,
        status: "approved",
        normalizedPayloadJson: {
          first_name: "Ada",
          last_name: "Lovelace",
          email: "ada@example.com",
          phone,
        },
        enrichmentMetadataJson: { source: "writer-test" },
      },
    });
    leadIds.push(lead.id);
    return lead;
  }

  async function createOrder(
    clientAccountId: string,
    status: "draft" | "submitted" | "ready" | "active" | "paused" | "completed" | "canceled" = "active"
  ) {
    const order = await db.leadOrder.create({
      data: {
        orderNumber: `LO-CSW-${suffix}-${orderIds.length}`,
        clientAccountId,
        status,
        nicheKey: "vet",
        statesJson: ["TX"],
        leadVolume: 5,
        campaignType: "aged",
        crmPackage: "test",
        createdByRole: "admin",
        submittedAt: new Date("2026-08-01T00:00:00.000Z"),
        activatedAt: new Date("2026-08-01T00:00:00.000Z"),
      },
    });
    orderIds.push(order.id);
    return order;
  }

  async function createPackage(input: {
    clientAccountId: string;
    leadOrderId: string;
    rows: string[][];
    allocationIds: string[];
    released: boolean;
    sha?: string;
    rowCount?: number;
  }) {
    const csv = csvDocument(input.rows);
    const deliveredAt = input.released ? new Date("2026-08-20T15:00:00.000Z") : null;
    return db.leadDeliveryExportPackage.create({
      data: {
        leadOrderId: input.leadOrderId,
        clientAccountId: input.clientAccountId,
        rowCount: input.rowCount ?? input.rows.length,
        contentSha256: input.sha ?? sha256Hex(csv),
        idempotencyKey: `csw-pkg-${suffix}-${orderIds.length}-${Math.random().toString(16).slice(2)}`,
        fieldSchemaVersion: "buyer_csv_v2",
        allocationIdsJson: input.allocationIds,
        csvContent: csv,
        spreadsheetDeliveredAt: deliveredAt,
        spreadsheetDeliveredBy: deliveredAt ? "operator_alex" : null,
        spreadsheetDeliveryIdempotencyKey: deliveredAt ? `csw-del-${suffix}-${Math.random().toString(16).slice(2)}` : null,
      },
    });
  }

  async function sideCounts() {
    const [allocations, instructions, targets, outbox, replacements] = await Promise.all([
      db.leadAllocation.count(),
      db.deliveryInstruction.count(),
      db.deliveryTarget.count(),
      db.fulfillmentOutbox.count(),
      db.leadReplacementRequest.count(),
    ]);
    return { allocations, instructions, targets, outbox, replacements };
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: role.map((name) => ({
        clientAccountId: client[name],
        clientDisplayName: name,
        status: "active",
      })),
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: "life_agent_launch",
        googleUserId: `company-writer-${suffix}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes,
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    for (const name of role) {
      await db.companySheetsDestination.create({
        data: {
          clientAccountId: client[name],
          companyConnectionId: connectionId,
          spreadsheetId: sheetId[name],
          spreadsheetTitle: name,
          spreadsheetUrl: sheetUrl(sheetId[name]),
          worksheetId: 0,
          worksheetTitle: "Leads",
          controlBasis: "drive_owner_verified",
          accessStatus: "readable",
          sharingStatus: "missing_recipient",
          enabled: false,
          canaryApproved: false,
        },
      });
      const destination = await db.companySheetsDestination.findUniqueOrThrow({
        where: { clientAccountId: client[name] },
      });
      await db.companySheetsTabContract.createMany({
        data: [
          {
            destinationId: destination.id,
            role: "campaign",
            setupState: "bound",
            worksheetId: 0,
            worksheetTitle: "Campaign Leads",
            schemaVersion: "company_sheets_campaign_v1",
            headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
            boundAt: new Date(),
          },
          {
            destinationId: destination.id,
            role: "aged",
            setupState: "bound",
            worksheetId: 1,
            worksheetTitle: "Aged Orders",
            schemaVersion: "buyer_csv_v2",
            headerContract: ["delivery_row_id", "first_name", "note"],
            boundAt: new Date(),
          },
          ...(name === "canary"
            ? [
                {
                  destinationId: destination.id,
                  role: "canary",
                  setupState: "bound",
                  worksheetId: 2,
                  worksheetTitle: "Canary",
                  schemaVersion: "company_sheets_canary_v1",
                  headerContract: ["delivery_row_id", "sample_formula", "sample_plus", "note"],
                  boundAt: new Date(),
                },
              ]
            : []),
        ],
      });
    }
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup() {
    const ids = Object.values(client);
    const spreadsheets = [...Object.values(sheetId), leadRetarget, agedRetarget, canaryRetarget];
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsWorksheetLock.deleteMany({ where: { spreadsheetId: { in: spreadsheets } } });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: "life_agent_launch" } });
    if (leadIds.length > 0) {
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: leadIds } } });
    }
    if (orderIds.length > 0) {
      await db.leadDeliveryExportPackage.deleteMany({ where: { leadOrderId: { in: orderIds } } });
      await db.leadOrder.deleteMany({ where: { id: { in: orderIds } } });
    }
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
  }

  it("keeps enqueue and execute inert while the execution flag is off", async () => {
    const lead = await createLead(client.lead, "=15551212");
    const beforeJobs = await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.lead } });
    const blocked = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps({ env: testEnv(false) }));
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "execution_disabled");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.lead } }), beforeJobs);
    assert.equal(sheetFor(sheetId.lead).calls, 0);

    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const paused = await executeCompanySheetsDeliveryJob(queued.job.id, deps({ env: testEnv(false) }));
    assert.equal(paused.ok, false);
    if (!paused.ok) assert.equal(paused.code, "execution_disabled");
    const stored = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.job.id } });
    assert.equal(stored.status, "queued");
    assert.equal(stored.attemptCount, 0);
    assert.equal(sheetFor(sheetId.lead).calls, 0);
    await db.companySheetsDeliveryJob.delete({ where: { id: queued.job.id } });
  });

  it("refuses an unconfirmed lead and an unauthorized or altered release", async () => {
    const unresolved = await createLead(null);
    const refused = await enqueueConfirmedLeadSheetsDelivery(unresolved.id, deps());
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "client_not_confirmed");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: unresolved.id } }), 0);

    const order = await createOrder(client.aged);
    const unreleased = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: order.id,
      rows: [["Ada", "hidden"]],
      allocationIds: ["alloc-hidden"],
      released: false,
    });
    const internalOnly = await enqueueAuthorizedAgedReleaseSheetsDelivery(unreleased.id, deps());
    assert.equal(internalOnly.ok, false);
    if (!internalOnly.ok) assert.equal(internalOnly.code, "package_not_released");
    const unreleasedAfter = await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: unreleased.id } });
    assert.equal(unreleasedAfter.spreadsheetDeliveredAt, null);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: unreleased.id } }), 0);

    const draft = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: (await createOrder(client.aged, "draft")).id,
      rows: [["Ada", "draft"]],
      allocationIds: ["alloc-draft"],
      released: false,
    });
    const draftResult = await enqueueAuthorizedAgedReleaseSheetsDelivery(draft.id, deps());
    assert.equal(draftResult.ok, false);
    if (!draftResult.ok) assert.equal(draftResult.code, "order_draft");

    const heldOrder = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: (await createOrder(client.aged, "paused")).id,
      rows: [["Ada", "held"]],
      allocationIds: ["alloc-held"],
      released: true,
    });
    const heldResult = await enqueueAuthorizedAgedReleaseSheetsDelivery(heldOrder.id, deps());
    assert.equal(heldResult.ok, false);
    if (!heldResult.ok) assert.equal(heldResult.code, "order_held");

    const revoked = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: (await createOrder(client.aged, "canceled")).id,
      rows: [["Ada", "revoked"]],
      allocationIds: ["alloc-revoked"],
      released: true,
    });
    const revokedResult = await enqueueAuthorizedAgedReleaseSheetsDelivery(revoked.id, deps());
    assert.equal(revokedResult.ok, false);
    if (!revokedResult.ok) assert.equal(revokedResult.code, "order_revoked");

    const unauthorized = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: (await createOrder(client.aged, "submitted")).id,
      rows: [["Ada", "submitted"]],
      allocationIds: ["alloc-submitted"],
      released: false,
    });
    const notAuthorized = await enqueueAuthorizedAgedReleaseSheetsDelivery(unauthorized.id, deps());
    assert.equal(notAuthorized.ok, false);
    if (!notAuthorized.ok) assert.equal(notAuthorized.code, "release_not_authorized");

    const otherOrder = await createOrder(client.lead);
    const wrongClient = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: otherOrder.id,
      rows: [["Ada", "other"]],
      allocationIds: ["alloc-other"],
      released: false,
    });
    const mismatchClient = await enqueueAuthorizedAgedReleaseSheetsDelivery(wrongClient.id, deps());
    assert.equal(mismatchClient.ok, false);
    if (!mismatchClient.ok) assert.equal(mismatchClient.code, "order_client_mismatch");

    const tampered = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: order.id,
      rows: [["Ada", "tampered"]],
      allocationIds: ["alloc-tampered"],
      released: true,
      sha: "not-the-csv-hash",
    });
    const badHash = await enqueueAuthorizedAgedReleaseSheetsDelivery(tampered.id, deps());
    assert.equal(badHash.ok, false);
    if (!badHash.ok) assert.equal(badHash.code, "csv_integrity_mismatch");

    const mismatch = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: order.id,
      rows: [["Ada", "one"]],
      allocationIds: ["alloc-a", "alloc-b"],
      released: true,
      rowCount: 2,
    });
    const badCount = await enqueueAuthorizedAgedReleaseSheetsDelivery(mismatch.id, deps());
    assert.equal(badCount.ok, false);
    if (!badCount.ok) assert.equal(badCount.code, "row_count_mismatch");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { exportPackageId: mismatch.id } }), 0);
    assert.equal(await db.leadAllocation.count({ where: { clientAccountId: client.aged } }), 0);
  });

  it("writes a confirmed lead once, keeps the snapshotted sheet, and stores formulas as text", async () => {
    const lead = await createLead(client.lead, "=15551212");
    const beforeLead = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: lead.id } });
    const beforeCounts = await sideCounts();
    const first = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(first.ok, true);
    if (!first.ok) return;
    const again = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(again.ok, true);
    if (!again.ok) return;
    assert.equal(again.created, false);
    assert.equal(again.job.id, first.job.id);
    assert.equal(await db.companySheetsDeliveryRow.count({ where: { jobId: first.job.id } }), 1);

    await db.companySheetsDestination.update({
      where: { clientAccountId: client.lead },
      data: { spreadsheetId: leadRetarget, spreadsheetUrl: sheetUrl(leadRetarget) },
    });
    const snapshotted = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: first.job.id } });
    assert.equal(snapshotted.spreadsheetId, sheetId.lead);
    assert.equal(snapshotted.spreadsheetUrl, sheetUrl(sheetId.lead));

    const executed = await executeCompanySheetsDeliveryJob(first.job.id, deps());
    assert.equal(executed.ok, true);
    if (!executed.ok) return;
    assert.equal(executed.status, "succeeded");
    assert.equal(executed.rowsWritten, 1);
    const leadSheet = sheetFor(sheetId.lead);
    const movedSheet = sheetFor(leadRetarget);
    assert.equal(movedSheet.calls, 0);
    assert.equal(leadSheet.updates.length, 1);
    assert.deepEqual(leadSheet.updates[0]?.[0], [...COMPANY_SHEETS_LEAD_HEADER]);
    assert.equal(leadSheet.appends.length, 1);
    const appended = leadSheet.appends[0]?.[0] ?? [];
    assert.equal(appended[0], `lead:${client.lead}:${lead.id}`);
    assert.equal(appended[6], "=15551212");
    assert.equal(snapshotted.worksheetId, 0);
    assert.equal(snapshotted.schemaVersion, "company_sheets_campaign_v1");
    assert.equal(appended.join("|").includes("''="), false);
    const storedRow = await db.companySheetsDeliveryRow.findFirstOrThrow({ where: { jobId: first.job.id } });
    assert.equal((storedRow.valuesJson as string[])[6], "=15551212");
    assert.equal(storedRow.status, "written");

    const replay = await executeCompanySheetsDeliveryJob(first.job.id, deps());
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.code, "already_succeeded");
    assert.equal(leadSheet.appends.length, 1);

    const afterLead = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: lead.id } });
    assert.equal(afterLead.status, beforeLead.status);
    assert.equal(afterLead.updatedAt.getTime(), beforeLead.updatedAt.getTime());
    assert.deepEqual(afterLead.deliveryResultJson, beforeLead.deliveryResultJson);
    assert.deepEqual(await sideCounts(), beforeCounts);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({
      where: { clientAccountId: client.lead },
    });
    assert.equal(destination.enabled, false);
    assert.equal(destination.writeReadiness, "not_verified");
    assert.equal(destination.deliveryExecution, "disabled");
    await db.companySheetsDestination.update({
      where: { clientAccountId: client.lead },
      data: { spreadsheetId: sheetId.lead, spreadsheetUrl: sheetUrl(sheetId.lead) },
    });
  });

  it("reconciles a timeout after Google accepted the lead row and does not append it again", async () => {
    const lead = await createLead(client.lead, "5550199");
    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const leadSheet = sheetFor(sheetId.lead);
    const beforeAppends = leadSheet.appends.length;
    leadSheet.failAppend = "throw-after-write";
    const timedOut = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    leadSheet.failAppend = null;
    assert.equal(timedOut.ok, true);
    if (!timedOut.ok) return;
    assert.equal(timedOut.status, "succeeded");
    assert.equal(leadSheet.appends.length, beforeAppends + 1);
    const ids = leadSheet.rows.map((row) => row[0]);
    assert.equal(ids.filter((id) => id === `lead:${client.lead}:${lead.id}`).length, 1);

    const serverLead = await createLead(client.lead, "5550188");
    const serverJob = await enqueueConfirmedLeadSheetsDelivery(serverLead.id, deps());
    assert.equal(serverJob.ok, true);
    if (!serverJob.ok) return;
    leadSheet.failAppend = "server-after-write";
    const server = await executeCompanySheetsDeliveryJob(serverJob.job.id, deps());
    leadSheet.failAppend = null;
    assert.equal(server.ok, true);
    if (!server.ok) return;
    assert.equal(server.status, "succeeded");
    assert.equal(leadSheet.rows.filter((row) => row[0] === `lead:${client.lead}:${serverLead.id}`).length, 1);
  });

  it("delivers the authorized CSV set without retargeting or touching release state", async () => {
    const order = await createOrder(client.aged);
    const supplemental = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: order.id,
      rows: [["Ada", "supplemental"]],
      allocationIds: ["alloc-supplemental"],
      released: true,
    });
    const replacement = await createPackage({
      clientAccountId: client.aged,
      leadOrderId: order.id,
      rows: [["Grace", "=1+1"]],
      allocationIds: ["alloc-replacement"],
      released: true,
    });
    const beforePackage = await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: supplemental.id } });
    const beforeOrder = await db.leadOrder.findUniqueOrThrow({ where: { id: order.id } });
    const beforeCounts = await sideCounts();
    const first = await enqueueAuthorizedAgedReleaseSheetsDelivery(supplemental.id, deps());
    const second = await enqueueAuthorizedAgedReleaseSheetsDelivery(replacement.id, deps());
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    const replay = await enqueueAuthorizedAgedReleaseSheetsDelivery(supplemental.id, deps());
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.created, false);
    assert.equal(replay.job.id, first.job.id);

    await db.companySheetsDestination.update({
      where: { clientAccountId: client.aged },
      data: { spreadsheetId: agedRetarget, spreadsheetUrl: sheetUrl(agedRetarget) },
    });
    const evidence = await db.companySheetsOrderDeliveryEvidence.findMany({
      where: { leadOrderId: order.id },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(
      evidence.map((row) => row.spreadsheetId),
      [sheetId.aged, sheetId.aged]
    );
    assert.equal(evidence.every((row) => row.spreadsheetUrl === sheetUrl(sheetId.aged)), true);

    const ranFirst = await executeCompanySheetsDeliveryJob(first.job.id, deps());
    const ranSecond = await executeCompanySheetsDeliveryJob(second.job.id, deps());
    assert.equal(ranFirst.ok, true);
    assert.equal(ranSecond.ok, true);
    const agedSheet = sheetFor(sheetId.aged);
    assert.equal(sheetFor(agedRetarget).calls, 0);
    assert.equal(agedSheet.updates.length, 1);
    assert.deepEqual(agedSheet.updates[0]?.[0], ["delivery_row_id", "first_name", "note"]);
    const replacementAppend = agedSheet.appends[1]?.[0] ?? [];
    assert.equal(replacementAppend[2], "=1+1");
    assert.equal(first.job.worksheetId, 1);
    assert.equal(second.job.worksheetId, 1);
    assert.equal(
      replacementAppend[0],
      `release:${client.aged}:${order.id}:${replacement.id}:alloc-replacement`
    );
    const stored = await db.companySheetsDeliveryRow.findFirstOrThrow({
      where: { jobId: second.job.id },
    });
    assert.equal((stored.valuesJson as string[])[2], "=1+1");

    const afterPackage = await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: supplemental.id } });
    const afterOrder = await db.leadOrder.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(afterPackage.spreadsheetDeliveredAt?.getTime(), beforePackage.spreadsheetDeliveredAt?.getTime());
    assert.equal(afterPackage.csvContent, beforePackage.csvContent);
    assert.equal(afterPackage.contentSha256, beforePackage.contentSha256);
    assert.equal(afterPackage.customerReleaseNotifyStatus, null);
    assert.equal(afterOrder.updatedAt.getTime(), beforeOrder.updatedAt.getTime());
    assert.equal(afterOrder.leadVolume, beforeOrder.leadVolume);
    assert.deepEqual(await sideCounts(), beforeCounts);
    const refreshed = await db.companySheetsOrderDeliveryEvidence.findMany({
      where: { clientAccountId: client.aged, leadOrderId: order.id },
    });
    assert.equal(refreshed.every((row) => row.status === "succeeded"), true);
    assert.equal(await db.leadAllocation.count({ where: { leadOrderId: order.id } }), 0);
  });

  it("isolates portal evidence from the other client and from the current destination", async () => {
    const recorded = await db.companySheetsOrderDeliveryEvidence.findFirstOrThrow({
      where: { clientAccountId: client.aged, spreadsheetId: sheetId.aged },
    });
    const order = { id: recorded.leadOrderId };
    const app = Fastify({ logger: false });
    await app.register(clientCompanySheetsDeliveryRoutes, {
      prefix: "/client/v1",
      deps: deps(),
      requirePortalTenant: async (request) => {
        const header = request.headers["x-test-client"];
        const id = Array.isArray(header) ? header[0] : header;
        return { clientAccountId: typeof id === "string" ? id : client.aged };
      },
    });
    const foreign = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/google-sheets-delivery`,
      headers: { "x-test-client": client.lead },
    });
    assert.equal(foreign.statusCode, 200);
    assert.deepEqual(foreign.json().evidence, []);

    const supplied = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/google-sheets-delivery?clientAccountId=${client.aged}`,
      headers: { "x-test-client": client.aged },
    });
    assert.equal(supplied.statusCode, 400);

    const own = await app.inject({
      method: "GET",
      url: `/client/v1/lead-orders/${order.id}/google-sheets-delivery`,
      headers: { "x-test-client": client.aged },
    });
    assert.equal(own.statusCode, 200);
    const body = own.json();
    assert.equal(body.usesCurrentDestination, false);
    assert.equal(body.portalLinkGrantsGoogleAccess, false);
    assert.equal(body.evidence.length >= 2, true);
    assert.equal(
      body.evidence.every((row: { spreadsheetUrl: string }) => row.spreadsheetUrl === sheetUrl(sheetId.aged)),
      true
    );
    assert.equal(
      body.evidence.every((row: { tabUrl: string; worksheetId: number }) => row.worksheetId === 1 && row.tabUrl.endsWith("#gid=1")),
      true
    );
    assert.equal(JSON.stringify(body).includes(agedRetarget), false);
    await app.close();
  });

  it("records partial batch progress and holds a batch that timed out after one row", async () => {
    const order = await createOrder(client.partial);
    const rows = ["a", "b", "c", "d", "e"].map((note) => ["Ada", note]);
    const pkg = await createPackage({
      clientAccountId: client.partial,
      leadOrderId: order.id,
      rows,
      allocationIds: rows.map((_, index) => `alloc-${index}`),
      released: true,
    });
    const queued = await enqueueAuthorizedAgedReleaseSheetsDelivery(pkg.id, deps({ batchSize: 2, maxBatches: 1 }));
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const partialSheet = sheetFor(sheetId.partial);
    const first = await executeCompanySheetsDeliveryJob(queued.job.id, deps({ batchSize: 2, maxBatches: 1 }));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.status, "retryable");
    assert.equal(first.rowsWritten, 2);
    let stored = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.job.id } });
    assert.equal(stored.lastError, "batch_limit");
    const second = await executeCompanySheetsDeliveryJob(queued.job.id, deps({ batchSize: 2, maxBatches: 1 }));
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.rowsWritten, 4);
    const third = await executeCompanySheetsDeliveryJob(queued.job.id, deps({ batchSize: 2, maxBatches: 1 }));
    assert.equal(third.ok, true);
    if (!third.ok) return;
    assert.equal(third.status, "succeeded");
    assert.equal(third.rowsWritten, 5);
    assert.equal(partialSheet.updates.length, 1);
    assert.equal(partialSheet.appends.length, 3);

    const ambiguous = await createPackage({
      clientAccountId: client.partial,
      leadOrderId: order.id,
      rows: [
        ["Grace", "one"],
        ["Grace", "two"],
      ],
      allocationIds: ["alloc-left", "alloc-right"],
      released: true,
    });
    const ambiguousJob = await enqueueAuthorizedAgedReleaseSheetsDelivery(ambiguous.id, deps({ batchSize: 2 }));
    assert.equal(ambiguousJob.ok, true);
    if (!ambiguousJob.ok) return;
    partialSheet.failAppend = "partial";
    const timedOut = await executeCompanySheetsDeliveryJob(ambiguousJob.job.id, deps({ batchSize: 2 }));
    partialSheet.failAppend = null;
    assert.equal(timedOut.ok, false);
    if (timedOut.ok) return;
    assert.equal(timedOut.code, "uncertain");
    const pending = await db.companySheetsDeliveryRow.findMany({
      where: { jobId: ambiguousJob.job.id, status: "pending" },
    });
    assert.equal(pending.length, 1);
    const held = await executeCompanySheetsDeliveryJob(ambiguousJob.job.id, deps({ batchSize: 2 }));
    assert.equal(held.ok, false);
    if (!held.ok) assert.equal(held.code, "uncertain");
    const appendsBeforeRelease = partialSheet.appends.length;
    const released = await releaseCompanySheetsDeliveryHold(
      ambiguousJob.job.id,
      COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
      deps()
    );
    assert.equal(released.ok, false);
    if (!released.ok) assert.equal(released.code, "append_outcome_unresolved");
    const stillHeld = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: ambiguousJob.job.id } });
    assert.equal(stillHeld.status, "uncertain");
    assert.ok(stillHeld.appendStartedAt);
    assert.equal(partialSheet.appends.length, appendsBeforeRelease);
    const left = `release:${client.partial}:${order.id}:${ambiguous.id}:alloc-left`;
    const right = `release:${client.partial}:${order.id}:${ambiguous.id}:alloc-right`;
    assert.equal(partialSheet.rows.filter((row) => row[0] === left).length, 1);
    assert.equal(partialSheet.rows.filter((row) => row[0] === right).length, 0);
    const delivered = await db.leadDeliveryExportPackage.findUniqueOrThrow({ where: { id: ambiguous.id } });
    assert.equal(delivered.spreadsheetDeliveredAt?.toISOString(), "2026-08-20T15:00:00.000Z");
  });

  it("holds a timeout that cannot be reconciled until an operator releases it", async () => {
    const lead = await createLead(client.uncertain, "5550177");
    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const uncertainSheet = sheetFor(sheetId.uncertain);
    uncertainSheet.failAppend = "throw-after-write-blind";
    const timedOut = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    uncertainSheet.failAppend = null;
    assert.equal(timedOut.ok, false);
    if (timedOut.ok) return;
    assert.equal(timedOut.code, "uncertain");
    assert.equal(uncertainSheet.appends.length, 1);
    const blocked = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "uncertain");
    assert.equal(uncertainSheet.appends.length, 1);
    const wrong = await releaseCompanySheetsDeliveryHold(queued.job.id, "retry", deps());
    assert.equal(wrong.ok, false);
    if (!wrong.ok) assert.equal(wrong.code, "confirmation_required");
    const released = await releaseCompanySheetsDeliveryHold(queued.job.id, COMPANY_SHEETS_RELEASE_HOLD_PHRASE, deps());
    assert.equal(released.ok, true);
    if (!released.ok) return;
    assert.equal(released.status, "succeeded");
    assert.equal(released.appended, false);
    const recovered = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(recovered.ok, false);
    if (!recovered.ok) assert.equal(recovered.code, "already_succeeded");
    assert.equal(uncertainSheet.appends.length, 1);
    assert.equal(uncertainSheet.rows.filter((row) => row[0] === `lead:${client.uncertain}:${lead.id}`).length, 1);
  });

  it("stays held when a timeout leaves the row absent", async () => {
    const lead = await createLead(client.blind, "+15551212");
    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const blindSheet = sheetFor(sheetId.blind);
    blindSheet.failAppend = "throw-before-write";
    const timedOut = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    blindSheet.failAppend = null;
    assert.equal(timedOut.ok, false);
    if (timedOut.ok) return;
    assert.equal(timedOut.code, "uncertain");
    assert.equal(blindSheet.rows.some((row) => row[0]?.startsWith("lead:")), false);
    assert.equal(blindSheet.appends.length, 1);
    const blocked = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "uncertain");
    assert.equal(blindSheet.appends.length, 1);
    const released = await releaseCompanySheetsDeliveryHold(queued.job.id, COMPANY_SHEETS_RELEASE_HOLD_PHRASE, deps());
    assert.equal(released.ok, false);
    if (!released.ok) assert.equal(released.code, "append_outcome_unresolved");
    const stillHeld = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.job.id } });
    assert.equal(stillHeld.status, "uncertain");
    assert.ok(stillHeld.appendStartedAt);
    assert.equal(blindSheet.appends.length, 1);
    assert.equal(blindSheet.appends[0]?.[0]?.[6], "+15551212");
    const again = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.code, "uncertain");
    assert.equal(blindSheet.appends.length, 1);
  });

  it("does not overwrite a company header or existing rows", async () => {
    sheetFor(sheetId.mismatch).rows = [["Company column"]];
    sheetFor(sheetId.conflict).rows = [[], ["keep-me"]];
    sheetFor(sheetId.buried).rows = [[], [], ["buried"]];
    sheetFor(sheetId.truncate).rows = [[...COMPANY_SHEETS_LEAD_HEADER]];
    sheetFor(sheetId.truncate).truncateColumn = true;
    for (const name of ["mismatch", "conflict", "buried", "truncate"] as const) {
      const lead = await createLead(client[name]);
      const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
      assert.equal(queued.ok, true);
      if (!queued.ok) return;
      const result = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "uncertain");
      const tab = sheetFor(sheetId[name]);
      assert.equal(tab.updates.length, 0);
      assert.equal(tab.appends.length, 0);
    }
    assert.deepEqual(sheetFor(sheetId.mismatch).rows, [["Company column"]]);
    assert.deepEqual(sheetFor(sheetId.conflict).rows[1], ["keep-me"]);
    assert.deepEqual(sheetFor(sheetId.buried).rows[2], ["buried"]);
  });

  it("stops on lost control, expired credentials, disconnect, and a changed company connection", async () => {
    const lead = await createLead(client.control);
    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const cases: Array<{ name: string; prepare: () => void; code: string; status: string }> = [
      { name: "foreign", prepare: () => { world.drive = "foreign"; }, code: "not_company_controlled", status: "retryable" },
      { name: "shared", prepare: () => { world.drive = "shared"; }, code: "shared_drive_unsupported", status: "retryable" },
      { name: "expired", prepare: () => { world.token = "expired"; }, code: "google_reconnect_required", status: "retryable" },
      { name: "other", prepare: () => { world.token = "other"; }, code: "company_connection_changed", status: "uncertain" },
      { name: "metadata", prepare: () => { world.metadata = "network"; }, code: "network_error", status: "retryable" },
    ];
    for (const item of cases) {
      await db.companySheetsDeliveryJob.update({
        where: { id: queued.job.id },
        data: { status: "queued", claimToken: null, uncertainReason: null },
      });
      item.prepare();
      const result = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
      world.drive = "owned";
      world.token = "ok";
      world.metadata = "ok";
      assert.equal(result.ok, false, item.name);
      if (!result.ok) assert.equal(result.code, item.code, item.name);
      const jobRow: { status: string } = await db.companySheetsDeliveryJob.findUniqueOrThrow({
        where: { id: queued.job.id },
      });
      assert.equal(jobRow.status, item.status, item.name);
    }
    await db.companyGoogleConnection.update({ where: { id: connectionId }, data: { status: "disconnected" } });
    await db.companySheetsDeliveryJob.update({
      where: { id: queued.job.id },
      data: { status: "queued", claimToken: null, uncertainReason: null },
    });
    const disconnected = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    await db.companyGoogleConnection.update({ where: { id: connectionId }, data: { status: "connected" } });
    assert.equal(disconnected.ok, false);
    if (!disconnected.ok) assert.equal(disconnected.code, "google_not_connected");
    assert.equal(sheetFor(sheetId.control).calls, 0);
    assert.equal(sheetFor(sheetId.control).appends.length, 0);
    assert.equal(sheetFor(sheetId.control).updates.length, 0);
  });

  it("serializes two jobs and ignores a duplicate execute of the running job", async () => {
    const firstLead = await createLead(client.race, "5550155");
    const secondLead = await createLead(client.race, "5550144");
    const firstJob = await enqueueConfirmedLeadSheetsDelivery(firstLead.id, deps());
    const secondJob = await enqueueConfirmedLeadSheetsDelivery(secondLead.id, deps());
    assert.equal(firstJob.ok, true);
    assert.equal(secondJob.ok, true);
    if (!firstJob.ok || !secondJob.ok) return;
    let release = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = () => {};
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const raceSheet = sheetFor(sheetId.race);
    raceSheet.holdAppend = hold;
    raceSheet.onAppendEntered = () => entered();
    const running = executeCompanySheetsDeliveryJob(firstJob.job.id, deps());
    try {
      await Promise.race([
        enteredPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error("append did not start")), 5000)),
      ]);
      const duplicate = await executeCompanySheetsDeliveryJob(firstJob.job.id, deps());
      const busy = await executeCompanySheetsDeliveryJob(secondJob.job.id, deps());
      assert.equal(duplicate.ok, false);
      if (!duplicate.ok) assert.equal(duplicate.code, "already_running");
      assert.equal(busy.ok, false);
      if (!busy.ok) assert.equal(busy.code, "worksheet_busy");
      const paused = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: secondJob.job.id } });
      assert.equal(paused.status, "queued");
      assert.equal(paused.spreadsheetId, sheetId.race);
    } finally {
      release();
      raceSheet.holdAppend = null;
    }
    const finished = await running;
    assert.equal(finished.ok, true);
    if (!finished.ok) return;
    assert.equal(finished.status, "succeeded");
    const attempts = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: firstJob.job.id } });
    assert.equal(attempts.attemptCount, 1);
    assert.equal(raceSheet.appends.length, 1);
    const continued = await executeCompanySheetsDeliveryJob(secondJob.job.id, deps());
    assert.equal(continued.ok, true);
    if (!continued.ok) return;
    assert.equal(continued.status, "succeeded");
    assert.equal(raceSheet.appends.length, 2);
  });

  it("requires admin approval for a synthetic canary and refuses a moved destination", async () => {
    const canarySheet = sheetFor(sheetId.canary);
    const setupOff = await setCompanySheetsCanaryApproval(client.canary, true, deps({ env: testEnv(true, false) }));
    assert.equal(setupOff.ok, false);
    if (!setupOff.ok) assert.equal(setupOff.code, "destination_disabled");
    const approved = await setCompanySheetsCanaryApproval(client.canary, true, deps({ env: testEnv(false, true) }));
    assert.equal(approved.ok, true);
    if (!approved.ok) return;
    assert.equal(approved.canaryApproved, true);
    assert.equal(canarySheet.calls, 0);
    const blocked = await enqueueCompanySheetsCanary(
      { clientAccountId: client.canary, idempotencyKey: "synthetic-1", rowCount: 2 },
      deps({ env: testEnv(false, true) })
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "execution_disabled");
    await setCompanySheetsCanaryApproval(client.canary, false, deps({ env: testEnv(false, true) }));
    const unapproved = await enqueueCompanySheetsCanary(
      { clientAccountId: client.canary, idempotencyKey: "synthetic-1" },
      deps()
    );
    assert.equal(unapproved.ok, false);
    if (!unapproved.ok) assert.equal(unapproved.code, "canary_not_approved");
    await setCompanySheetsCanaryApproval(client.canary, true, deps({ env: testEnv(false, true) }));
    const queued = await enqueueCompanySheetsCanary(
      { clientAccountId: client.canary, idempotencyKey: "synthetic-1", rowCount: 2 },
      deps()
    );
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    assert.equal(queued.job.status, "queued");
    const ran = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(ran.ok, true);
    if (!ran.ok) return;
    assert.equal(ran.status, "succeeded");
    const body = JSON.stringify(canarySheet.appends);
    assert.match(body, /=1\+1/);
    assert.match(body, /\+SUM\(A1\)/);
    assert.equal(body.includes("'=1+1"), false);
    assert.equal(body.includes("'+SUM"), false);
    assert.equal(canarySheet.updates.length, 1);

    const next = await enqueueCompanySheetsCanary(
      { clientAccountId: client.canary, idempotencyKey: "synthetic-2", rowCount: 1 },
      deps()
    );
    assert.equal(next.ok, true);
    if (!next.ok) return;
    await db.companySheetsDestination.update({
      where: { clientAccountId: client.canary },
      data: { spreadsheetId: canaryRetarget, spreadsheetUrl: sheetUrl(canaryRetarget) },
    });
    const moved = await executeCompanySheetsDeliveryJob(next.job.id, deps());
    assert.equal(moved.ok, false);
    if (!moved.ok) assert.equal(moved.code, "canary_destination_changed");
    const stored = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: next.job.id } });
    assert.equal(stored.status, "uncertain");
    assert.equal(stored.spreadsheetId, sheetId.canary);
    assert.equal(canarySheet.appends.length, 1);
    assert.equal(sheetFor(canaryRetarget).calls, 0);
  });

  it("adopts a Google append when the following Prisma write throws", async () => {
    const lead = await createLead(client.uncertain, "+15550000");
    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    let thrown = false;
    const wrapRows = (rows: PrismaClient["companySheetsDeliveryRow"]) =>
      new Proxy(rows, {
        get(target, prop) {
          if (prop === "updateMany") {
            return async (args: { data?: { status?: string } }) => {
              if (!thrown && args?.data?.status === "written") {
                thrown = true;
                throw new Error("prisma_after_google_success");
              }
              return target.updateMany(args as never);
            };
          }
          const value = target[prop as keyof typeof target];
          return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      });
    const proxy = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "companySheetsDeliveryRow") return wrapRows(target.companySheetsDeliveryRow);
        if (prop === "$transaction") {
          return (fn: (tx: PrismaClient) => Promise<unknown>) =>
            target.$transaction(async (tx) =>
              fn(
                new Proxy(tx, {
                  get(txTarget, txProp, txReceiver) {
                    if (txProp === "companySheetsDeliveryRow") {
                      return wrapRows(txTarget.companySheetsDeliveryRow as PrismaClient["companySheetsDeliveryRow"]);
                    }
                    const value = Reflect.get(txTarget, txProp, txReceiver);
                    return typeof value === "function" ? value.bind(txTarget) : value;
                  },
                }) as PrismaClient
              )
            );
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as PrismaClient;
    const agedSheet = sheetFor(sheetId.uncertain);
    const before = agedSheet.appends.length;
    const failed = await executeCompanySheetsDeliveryJob(queued.job.id, deps({ db: proxy }));
    assert.equal(failed.ok, false);
    if (!failed.ok) assert.equal(failed.code, "uncertain");
    assert.equal(thrown, true);
    assert.equal(agedSheet.appends.length, before + 1);
    const heldJob = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.job.id } });
    assert.equal(heldJob.status, "uncertain");
    assert.ok(heldJob.appendStartedAt);
    const sibling = await enqueueConfirmedLeadSheetsDelivery(
      (await createLead(client.uncertain, "5550199")).id,
      deps()
    );
    assert.equal(sibling.ok, true);
    if (!sibling.ok) return;
    const blocked = await executeCompanySheetsDeliveryJob(sibling.job.id, deps());
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "worksheet_busy");
    assert.equal(agedSheet.appends.length, before + 1);
    const adopted = await releaseCompanySheetsDeliveryHold(
      queued.job.id,
      COMPANY_SHEETS_RELEASE_HOLD_PHRASE,
      deps({ db: proxy })
    );
    assert.equal(adopted.ok, true);
    if (!adopted.ok) return;
    assert.equal(adopted.status, "succeeded");
    assert.equal(adopted.appended, false);
    assert.equal(agedSheet.appends.length, before + 1);
    const replay = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(replay.ok, false);
    if (!replay.ok) assert.equal(replay.code, "already_succeeded");
    assert.equal(agedSheet.appends.length, before + 1);
  });

  it("holds duplicate stable ids and a destination change without a second append", async () => {
    const lead = await createLead(client.race, "=15550101");
    const queued = await enqueueConfirmedLeadSheetsDelivery(lead.id, deps());
    assert.equal(queued.ok, true);
    if (!queued.ok) return;
    const stable = `lead:${client.race}:${lead.id}`;
    const canarySheet = sheetFor(sheetId.race);
    canarySheet.rows = [[...COMPANY_SHEETS_LEAD_HEADER], [stable, "a"], [stable, "b"]];
    const appendsBefore = canarySheet.appends.length;
    const duplicated = await executeCompanySheetsDeliveryJob(queued.job.id, deps());
    assert.equal(duplicated.ok, false);
    if (!duplicated.ok) assert.equal(duplicated.code, "uncertain");
    const dupJob = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.job.id } });
    assert.equal(dupJob.uncertainReason, "duplicate_row_id");
    assert.equal(canarySheet.appends.length, appendsBefore);
    const phrase = await releaseCompanySheetsDeliveryHold(queued.job.id, COMPANY_SHEETS_RELEASE_HOLD_PHRASE, deps());
    assert.equal(phrase.ok, false);
    if (!phrase.ok) assert.equal(phrase.code, "duplicate_row_id");
    assert.equal(
      (await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: queued.job.id } })).status,
      "uncertain"
    );
    canarySheet.rows = [];

    const movedLead = await createLead(client.lead, "+15550102");
    const movedJob = await enqueueConfirmedLeadSheetsDelivery(movedLead.id, deps());
    assert.equal(movedJob.ok, true);
    if (!movedJob.ok) return;
    const leadSheet = sheetFor(sheetId.lead);
    const leadAppendsBefore = leadSheet.appends.length;
    let appendedSpreadsheetId = "";
    const moved = await executeCompanySheetsDeliveryJob(
      movedJob.job.id,
      deps({
        appendValues: async (input) => {
          await db.companySheetsDestination.update({
            where: { clientAccountId: client.lead },
            data: { spreadsheetId: leadRetarget, spreadsheetUrl: sheetUrl(leadRetarget) },
          });
          appendedSpreadsheetId = input.spreadsheetId;
          leadSheet.appends.push(input.values);
          for (const row of input.values) leadSheet.rows.push(row);
          return { ok: true as const };
        },
      })
    );
    assert.equal(moved.ok, true);
    if (!moved.ok) return;
    assert.equal(appendedSpreadsheetId, sheetId.lead);
    assert.equal(leadSheet.appends.length, leadAppendsBefore + 1);
    assert.equal(leadSheet.appends.at(-1)?.[0]?.[6], "+15550102");
    assert.equal(sheetFor(leadRetarget).appends.length, 0);
    const changed = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: movedJob.job.id } });
    assert.equal(changed.spreadsheetId, sheetId.lead);
    assert.equal(changed.status, "succeeded");
    await db.companySheetsDestination.update({
      where: { clientAccountId: client.lead },
      data: { spreadsheetId: sheetId.lead, spreadsheetUrl: sheetUrl(sheetId.lead) },
    });
  });

  it("keeps admin execution routes admin-only and does not execute on enqueue", async () => {
    const previous = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "writer-test-admin-key";
    const lead = await createLead(client.lead, "5550133");
    const app = Fastify({ logger: false });
    try {
      await app.register(adminCompanySheetsDeliveryRoutes, { prefix: "/admin/v1", deps: deps() });
      const unauthorized = await app.inject({
        method: "POST",
        url: "/admin/v1/company-sheets/deliveries/lead",
        payload: { sourceLeadEventId: lead.id },
      });
      assert.equal(unauthorized.statusCode, 401);
      assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);

      const created = await app.inject({
        method: "POST",
        url: "/admin/v1/company-sheets/deliveries/lead",
        headers: { [HEADER]: "writer-test-admin-key" },
        payload: { sourceLeadEventId: lead.id },
      });
      assert.equal(created.statusCode, 201);
      const createdBody = created.json();
      assert.equal(createdBody.executed, false);
      assert.equal(createdBody.status, "queued");
      const callsBefore = sheetFor(sheetId.lead).appends.length;
      const ran = await app.inject({
        method: "POST",
        url: `/admin/v1/company-sheets/delivery-jobs/${createdBody.jobId}/execute`,
        headers: { [HEADER]: "writer-test-admin-key" },
      });
      assert.equal(ran.statusCode, 200);
      assert.equal(ran.json().status, "succeeded");
      assert.equal(sheetFor(sheetId.lead).appends.length, callsBefore + 1);

      const approval = await app.inject({
        method: "PUT",
        url: `/admin/v1/clients/${client.control}/google-sheets/canary-approval`,
        headers: { [HEADER]: "writer-test-admin-key" },
        payload: { approved: false },
      });
      assert.equal(approval.statusCode, 200);
      assert.equal(approval.json().executionStarted, false);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previous;
    }
  });
});
