import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { COMPANY_GOOGLE_CONNECTION_KEY } from "../lib/company-google-sheets-env.js";
import { prisma } from "../lib/db.js";
import { recordCompanySheetsConfigRequest } from "../services/company-sheets-config-request.js";
import type { CompanyDriveFile } from "../services/company-google/company-google-drive-http.js";
import type { CompanySheetsDeps } from "../services/company-google/company-sheets-destination.service.js";
import type { GoogleSpreadsheetMetadata } from "../services/google-sheets/google-sheets-http-client.js";
import { adminCompanySheetsConfigRequestRoutes } from "./admin-company-sheets-config-request.js";

const ADMIN_KEY = "company-sheets-config-request-test-key";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPROVED_DRIVE = "0AApprovedDrive00";
const APPROVED_PARENT = "1ApprovedParentFolder";
const EMAIL = "sheets@lifeagentlaunch.test";

const clientIds: string[] = [];
let app: FastifyInstance;
let connectionId = "";
let seq = 0;

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  flag: process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED,
  drive: process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID,
  parent: process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID,
};

test("the configuration request does not touch operational writers", () => {
  const service = readFileSync(new URL("../services/company-sheets-config-request.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("./admin-company-sheets-config-request.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    path.join(repoRoot, "prisma/migrations/20261110221500_company_sheets_destination_configuration_request/migration.sql"),
    "utf8"
  );
  const observer = readFileSync(
    path.join(repoRoot, "apps/admin-coc/src/lib/admin-coc-observer-access.ts"),
    "utf8"
  );
  for (const source of [service, route]) {
    for (const forbidden of [
      "saveCompanySheetsDestination",
      "deleteCompanySheetsDestination",
      "updateCompanySheetsAccess",
      "createCompanyDriveFile",
      "publishColumnMap",
      "setCompanySheetsDispatchActivation",
      "processDueCompanySheetsDispatches",
      "enqueueConfirmedLeadSheetsDelivery",
      "enqueueAuthorizedAgedReleaseSheetsDelivery",
      "enqueueCompanySheetsCanary",
      "enqueueOnboardingCapturedTestJob",
      "appendSheetValues",
      "addSpreadsheetSheet",
      "spreadsheetDeliveredAt",
      "companySheetsDestination.update",
      "companySheetsDestination.create",
      "companySheetsDestination.delete",
      "companySheetsTabContract",
      "companySheetsDeliveryJob",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  }
  assert.equal(service.includes('FROM "CompanySheetsDestination"'), true);
  assert.equal(service.includes("FOR UPDATE"), true);
  assert.equal(service.includes("establishControl"), true);
  assert.equal(observer.includes("company-sheets-destination-configuration"), false);
  assert.match(migration, /SET LOCAL lock_timeout = '3s'/);
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;$/m);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE/);
  assert.equal(migration.includes("GRANT SELECT, INSERT, UPDATE, DELETE"), false);
  assert.equal(migration.includes('UPDATE "CompanySheetsDestination"'), false);
  assert.equal(migration.includes('UPDATE "CompanySheetsTabContract"'), false);
  assert.equal(migration.includes("campaignDispatchEnabled"), true);
  for (const relative of [
    "services/company-sheets-delivery/company-sheets-delivery.service.ts",
    "services/company-sheets-delivery/company-sheets-tab-contract.service.ts",
    "services/company-sheets-dispatch/company-sheets-dispatch.service.ts",
    "services/company-google/company-sheets-destination.service.ts",
    "services/client-onboarding-v2/column-maps.ts",
    "services/delivery-success-notification/scan.ts",
    "repositories/company-sheets-destination.repository.ts",
  ]) {
    const source = readFileSync(path.join(apiSrc, relative), "utf8");
    assert.equal(source.includes("CompanySheetsDestinationConfigurationRequest"), false, relative);
  }
});

describe("Company Sheets destination configuration requests", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED = "true";
    process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID = APPROVED_DRIVE;
    process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID = APPROVED_PARENT;
    delete process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED;
    delete process.env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED;
    delete process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;
    await prisma.companyGoogleConnection.deleteMany({ where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY } });
    const connection = await prisma.companyGoogleConnection.create({
      data: {
        connectionKey: COMPANY_GOOGLE_CONNECTION_KEY,
        googleUserId: `company-config-${Date.now()}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    app = Fastify({ logger: false });
    await app.register(adminCompanySheetsConfigRequestRoutes, { prefix: "/admin/v1", deps: sheets() });
  });

  after(async () => {
    await app.close();
    if (clientIds.length > 0) {
      await prisma.companySheetsDestinationConfigurationRequest.deleteMany({
        where: { clientAccountId: { in: clientIds } },
      }).catch(() => undefined);
      await prisma.companySheetsDeliveryJob.deleteMany({
        where: { clientAccountId: { in: clientIds } },
      }).catch(() => undefined);
      await prisma.companySheetsTabContract.deleteMany({
        where: { destination: { clientAccountId: { in: clientIds } } },
      }).catch(() => undefined);
      await prisma.companySheetsDestination.deleteMany({
        where: { clientAccountId: { in: clientIds } },
      }).catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    if (connectionId) {
      await prisma.companyGoogleConnection.deleteMany({ where: { id: connectionId } }).catch(() => undefined);
    }
    restoreEnv("ADMIN_API_KEY", savedEnv.admin);
    restoreEnv("SA360_ADMIN_KEY", savedEnv.alias);
    restoreEnv("SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED", savedEnv.flag);
    restoreEnv("COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID", savedEnv.drive);
    restoreEnv("COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID", savedEnv.parent);
  });

  test("the partial unique index and snapshot trigger exist only in SQL", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'CompanySheetsDestConfigRequest_one_stored_key'
    `;
    assert.equal(indexes.length, 1);
    assert.match(indexes[0]?.indexdef ?? "", /UNIQUE/i);
    assert.match(indexes[0]?.indexdef ?? "", /status.*=.*'stored'/);
    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname::text AS tgname
      FROM pg_trigger
      WHERE tgname = 'CompanySheetsDestConfigRequest_snapshot_guard'
        AND NOT tgisinternal
    `;
    assert.equal(triggers.length, 1);
    const schema = readFileSync(path.join(repoRoot, "prisma/schema.prisma"), "utf8");
    assert.equal(schema.includes("CompanySheetsDestConfigRequest_one_stored_key"), false);
    assert.equal(schema.includes("CompanySheetsDestConfigRequest_snapshot_guard"), false);
  });

  test("admin auth, portal and workspace credentials, observers, and the exact-true flag refuse the route", async () => {
    const world = await createClient();
    const missing = await app.inject({ method: "POST", url: url(world), payload: body(world) });
    assert.equal(missing.statusCode, 401);

    const portal = await post(world, { "x-sa360-client-portal-key": "portal-key" });
    assert.equal(portal.statusCode, 403);
    const workspace = await post(world, { "x-sa360-workspace-key": "workspace-key" });
    assert.equal(workspace.statusCode, 403);
    const assertion = await post(world, { "x-sa360-client-portal-assertion": "assertion" });
    assert.equal(assertion.statusCode, 403);

    const previousAdmin = process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY;
    delete process.env.SA360_ADMIN_KEY;
    const unconfigured = await post(world);
    assert.equal(unconfigured.statusCode, 503);
    process.env.ADMIN_API_KEY = previousAdmin;

    process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED = "TRUE";
    const flagged = await post(world);
    assert.equal(flagged.statusCode, 404);
    assert.equal(flagged.json().error, "company_sheets_config_request_disabled");
    const direct = await recordCompanySheetsConfigRequest(prisma, command(world), process.env, sheets());
    assert.equal(direct.ok, false);
    if (!direct.ok) assert.equal(direct.error, "feature_disabled");
    process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED = "true";
    assert.equal(await requestCount(world), 0);
    assert.equal(await prisma.companySheetsDestination.count({ where: { clientAccountId: world } }), 0);
  });

  test("a client without a destination stores the request and does not create a destination", async () => {
    const world = await createClient();
    const before = await operationalSnapshot(world);
    const saved = await post(world);
    assert.equal(saved.statusCode, 200);
    const json = saved.json();
    assert.equal(json.ok, true);
    assert.equal(json.replayed, false);
    assert.equal(json.spreadsheetId, sheetId(world));
    assert.equal(json.worksheetId, 7);
    assert.equal(json.spreadsheetTitle, "Acme Leads");
    assert.equal(json.worksheetTitle, "Campaign");
    assert.equal(json.controlBasis, "approved_shared_drive");
    assert.equal(json.operationalDestination.exists, false);
    assert.equal(json.operationalDestination.destinationRevision, null);
    assert.equal(json.operationalDestination.campaignDispatchEnabled, false);
    assert.equal(json.destinationUpdated, false);
    assert.equal(json.deliveryArmed, false);
    assert.equal(json.driveChanged, false);
    assert.equal(json.operationalWrite, false);
    assert.equal(await prisma.companySheetsDestination.count({ where: { clientAccountId: world } }), 0);
    assert.equal(await requestCount(world), 1);
    assert.deepEqual(await operationalSnapshot(world), before);

    const read = await app.inject({ method: "GET", url: url(world), headers: adminHeaders() });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().revision, 1);
    assert.equal(read.json().configuration.spreadsheetId, sheetId(world));
    assert.equal(read.json().configuration.worksheetId, 7);
    assert.equal(read.json().operationalDestination.exists, false);
    assert.equal(read.json().operationalWrite, false);
  });

  test("an inactive destination and an active destination stay unchanged", async () => {
    const inactive = await createClient();
    await createDestination(inactive, { dispatch: false, revision: 4 });
    const inactiveBefore = await destinationRow(inactive);
    const inactiveSaved = await post(inactive, undefined, { expectedDestinationRevision: 4 });
    assert.equal(inactiveSaved.statusCode, 200);
    assert.equal(inactiveSaved.json().operationalDestination.campaignDispatchEnabled, false);
    assert.equal(inactiveSaved.json().operationalDestination.destinationRevision, 4);
    assert.deepEqual(await destinationRow(inactive), inactiveBefore);

    const active = await createClient();
    await createDestination(active, { dispatch: true, revision: 3, spreadsheetId: `1other${active}` });
    const activeBefore = await destinationRow(active);
    const activeSaved = await post(active, undefined, { expectedDestinationRevision: 3 });
    assert.equal(activeSaved.statusCode, 200);
    assert.equal(activeSaved.json().operationalDestination.campaignDispatchEnabled, true);
    assert.equal(activeSaved.json().operationalDestination.agedDispatchEnabled, true);
    assert.equal(activeSaved.json().spreadsheetId, sheetId(active));
    const activeAfter = await destinationRow(active);
    assert.equal(activeAfter.spreadsheetId, activeBefore.spreadsheetId);
    assert.equal(activeAfter.campaignDispatchEnabled, true);
    assert.equal(activeAfter.agedDispatchEnabled, true);
    assert.equal(activeAfter.destinationRevision, 3);
    assert.equal(activeAfter.enabled, false);
    assert.equal(activeAfter.deliveryExecution, "disabled");
    assert.equal(await prisma.companySheetsDeliveryJob.count({ where: { clientAccountId: { in: [inactive, active] } } }), 0);
    assert.equal(await prisma.companySheetsTabContract.count({
      where: { destination: { clientAccountId: { in: [inactive, active] } } },
    }), 0);
  });

  test("another client's spreadsheet, unapproved storage, and a bad worksheet are rejected", async () => {
    const owner = await createClient();
    const requester = await createClient();
    await createDestination(owner, { dispatch: false, revision: 1, spreadsheetId: sheetId(requester) });
    const bound = await post(requester);
    assert.equal(bound.statusCode, 409);
    assert.equal(bound.json().error, "spreadsheet_bound_to_other_client");
    assert.equal(await requestCount(requester), 0);
    assert.equal((await destinationRow(owner)).spreadsheetId, sheetId(requester));

    const outside = await createClient();
    const unapproved = await recordCompanySheetsConfigRequest(prisma, command(outside), process.env, sheets({ driveId: "0AOtherDrive0001" }));
    assert.equal(unapproved.ok, false);
    if (!unapproved.ok) assert.equal(unapproved.error, "unapproved_shared_drive");

    const shortcutClient = await createClient();
    const shortcut = await recordCompanySheetsConfigRequest(prisma, command(shortcutClient), process.env, sheets({ shortcutTargetId: "1shortcutTarget" }));
    assert.equal(shortcut.ok, false);
    if (!shortcut.ok) assert.equal(shortcut.error, "shortcut_bypass");

    const trashedClient = await createClient();
    const trashed = await recordCompanySheetsConfigRequest(prisma, command(trashedClient), process.env, sheets({ trashed: true }));
    assert.equal(trashed.ok, false);
    if (!trashed.ok) assert.equal(trashed.error, "trashed_file");

    const deniedClient = await createClient();
    const denied = await recordCompanySheetsConfigRequest(prisma, command(deniedClient), process.env, sheets({ driveReason: "access_denied" }));
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error, "access_denied");

    const missingClient = await createClient();
    const missingSheet = await recordCompanySheetsConfigRequest(prisma, command(missingClient), process.env, sheets({ metadataReason: "not_found" }));
    assert.equal(missingSheet.ok, false);
    if (!missingSheet.ok) assert.equal(missingSheet.error, "spreadsheet_unavailable");

    const missingTabClient = await createClient();
    const missingTab = await recordCompanySheetsConfigRequest(prisma, command(missingTabClient, { worksheetId: 99 }), process.env, sheets());
    assert.equal(missingTab.ok, false);
    if (!missingTab.ok) assert.equal(missingTab.error, "worksheet_unavailable");

    const chartClient = await createClient();
    const chart = await recordCompanySheetsConfigRequest(prisma, command(chartClient, { worksheetId: 8 }), process.env, sheets());
    assert.equal(chart.ok, false);
    if (!chart.ok) assert.equal(chart.error, "worksheet_not_grid");
    assert.equal(await prisma.companySpreadsheetCreation.count({ where: { spreadsheetId: { startsWith: "1cfg" } } }), 0);
  });

  test("a company-owned My Drive file remains an allowed control basis", async () => {
    const world = await createClient();
    const saved = await recordCompanySheetsConfigRequest(prisma, command(world), process.env, sheets({ myDrive: true }));
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.controlBasis, "drive_owner_verified");
    assert.equal(saved.driveChanged, false);
    assert.equal(await prisma.companySheetsDestination.count({ where: { clientAccountId: world } }), 0);
  });

  test("missing and revoked company OAuth do not store a request", async () => {
    const missing = await createClient();
    const disconnected = await recordCompanySheetsConfigRequest(
      prisma,
      command(missing),
      process.env,
      sheets({ token: "google_not_connected" })
    );
    assert.equal(disconnected.ok, false);
    if (!disconnected.ok) assert.equal(disconnected.error, "google_not_connected");

    const revoked = await createClient();
    const reconnect = await recordCompanySheetsConfigRequest(
      prisma,
      command(revoked),
      process.env,
      sheets({ token: "google_reconnect_required" })
    );
    assert.equal(reconnect.ok, false);
    if (!reconnect.ok) assert.equal(reconnect.error, "google_reconnect_required");
    assert.equal(await requestCount(missing) + await requestCount(revoked), 0);
  });

  test("a stale destination version is rejected and a matching replay does not write again", async () => {
    const world = await createClient();
    await createDestination(world, { dispatch: true, revision: 2 });
    const stale = await post(world, undefined, { expectedDestinationRevision: 1 });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, "destination_stale");
    assert.equal(await requestCount(world), 0);
    assert.equal((await destinationRow(world)).destinationRevision, 2);

    const absent = await createClient();
    const wrongAbsent = await post(absent, undefined, { expectedDestinationRevision: 1 });
    assert.equal(wrongAbsent.statusCode, 409);
    assert.equal(wrongAbsent.json().error, "destination_stale");

    const saved = await post(world, undefined, { expectedDestinationRevision: 2 });
    assert.equal(saved.statusCode, 200);
    const requestId = saved.json().requestId as string;
    const replay = await post(world, undefined, { requestId, expectedDestinationRevision: 2, expectedRevision: 0 });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(replay.json().revision, 1);
    assert.equal(await requestCount(world), 1);

    const conflict = await post(world, undefined, {
      requestId,
      expectedDestinationRevision: 2,
      expectedRevision: 0,
      worksheetId: 7,
      spreadsheetId: `1different${world}`,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, "request_id_reused");
    assert.equal(await requestCount(world), 1);
  });

  test("a second request supersedes the first and concurrent first writes conflict", async () => {
    const world = await createClient();
    const first = await post(world);
    assert.equal(first.statusCode, 200);
    const firstId = first.json().requestId as string;
    const second = await post(world, undefined, { expectedRevision: 1, worksheetId: 7 });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().revision, 2);
    assert.equal(second.json().replayed, false);
    const rows = await prisma.companySheetsDestinationConfigurationRequest.findMany({
      where: { clientAccountId: world },
      orderBy: { revision: "asc" },
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.status, "superseded");
    assert.equal(rows[0]?.supersededByRequestId, second.json().requestId);
    assert.equal(rows[1]?.status, "stored");
    const oldReplay = await post(world, undefined, { requestId: firstId, expectedRevision: 0 });
    assert.equal(oldReplay.statusCode, 200);
    assert.equal(oldReplay.json().replayed, true);
    assert.equal(oldReplay.json().revision, 1);
    assert.equal(await requestCount(world), 2);

    const raced = await createClient();
    const [left, right] = await Promise.all([
      recordCompanySheetsConfigRequest(prisma, command(raced), process.env, sheets()),
      recordCompanySheetsConfigRequest(prisma, { ...command(raced), requestId: randomUUID() }, process.env, sheets()),
    ]);
    const outcomes = [left, right];
    assert.equal(outcomes.filter((item) => item.ok).length, 1);
    assert.equal(outcomes.filter((item) => !item.ok && item.error === "revision_conflict").length, 1);
    assert.equal(await requestCount(raced), 1);
    assert.equal(await prisma.companySheetsDestination.count({ where: { clientAccountId: raced } }), 0);
  });

  test("a destination revision that changes inside the lock rolls back", async () => {
    const world = await createClient();
    await createDestination(world, { dispatch: false, revision: 1 });
    const changed = await recordCompanySheetsConfigRequest(prisma, command(world, { expectedDestinationRevision: 1 }), process.env, {
      ...sheets(),
      afterDestinationLock: async (tx, clientAccountId) => {
        await tx.companySheetsDestination.update({
          where: { clientAccountId },
          data: { destinationRevision: { increment: 1 } },
        });
      },
    });
    assert.equal(changed.ok, false);
    if (!changed.ok) assert.equal(changed.error, "destination_stale");
    assert.equal(await requestCount(world), 0);
    assert.equal((await destinationRow(world)).destinationRevision, 1);
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function adminHeaders(extra: Record<string, string> = {}) {
  return { "x-sa360-admin-key": ADMIN_KEY, ...extra };
}

function url(clientAccountId: string) {
  return `/admin/v1/clients/${clientAccountId}/company-sheets-destination-configuration`;
}

function sheetId(clientAccountId: string) {
  return `1cfg${clientAccountId}`.slice(0, 40);
}

function body(
  clientAccountId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    requestId: randomUUID(),
    expectedRevision: 0,
    expectedDestinationRevision: null,
    spreadsheetId: sheetId(clientAccountId),
    worksheetId: 7,
    ...overrides,
  };
}

function command(clientAccountId: string, overrides: Record<string, unknown> = {}) {
  const payload = body(clientAccountId, overrides);
  return {
    clientAccountId,
    requestId: String(payload.requestId),
    expectedRevision: Number(payload.expectedRevision),
    expectedDestinationRevision: payload.expectedDestinationRevision as number | null,
    spreadsheetId: String(payload.spreadsheetId),
    worksheetId: Number(payload.worksheetId),
  };
}

function post(
  clientAccountId: string,
  headers: Record<string, string> = {},
  overrides: Record<string, unknown> = {}
) {
  return app.inject({
    method: "POST",
    url: url(clientAccountId),
    headers: adminHeaders(headers),
    payload: body(clientAccountId, overrides),
  });
}

function sheets(options: {
  driveId?: string;
  shortcutTargetId?: string | null;
  trashed?: boolean;
  canEdit?: boolean;
  driveReason?: "access_denied";
  metadataReason?: "not_found";
  token?: "google_not_connected" | "google_reconnect_required";
  myDrive?: boolean;
} = {}) {
  const deps: import("../services/company-sheets-config-request.js").CompanySheetsConfigDeps = {
    now: new Date("2026-11-10T22:30:00.000Z"),
    sheets: googleDeps(options),
  };
  return deps;
}

function googleDeps(options: {
  driveId?: string;
  shortcutTargetId?: string | null;
  trashed?: boolean;
  canEdit?: boolean;
  driveReason?: "access_denied";
  metadataReason?: "not_found";
  token?: "google_not_connected" | "google_reconnect_required";
  myDrive?: boolean;
} = {}): CompanySheetsDeps {
  return {
    env: process.env,
    db: prisma,
    fetchImpl: async () => {
      throw new Error("configuration request must not call fetch");
    },
    getAccessToken: async () => {
      if (options.token) return { ok: false, code: options.token };
      return {
        ok: true,
        accessToken: "ya29.company-config",
        connectionId,
        tokenVersion: 1,
        googleEmail: EMAIL,
      };
    },
    getMetadata: async ({ spreadsheetId }) => {
      if (options.metadataReason) return { ok: false, reason: options.metadataReason };
      return { ok: true, metadata: metadata(spreadsheetId) };
    },
    getDriveFile: async ({ fileId }) => {
      if (options.driveReason) return { ok: false, reason: options.driveReason };
      if (fileId === APPROVED_PARENT) return { ok: true, file: folderFile(APPROVED_PARENT) };
      return {
        ok: true,
        file: sheetFile(fileId, options),
      };
    },
  };
}

function metadata(id: string): GoogleSpreadsheetMetadata {
  return {
    spreadsheetId: id,
    title: "Acme Leads",
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
    worksheets: [
      { sheetId: 7, title: "Campaign", index: 0, hidden: false, sheetType: "GRID" },
      { sheetId: 8, title: "Chart", index: 1, hidden: false, sheetType: "OBJECT" },
    ],
  };
}

function sheetFile(id: string, options: {
  driveId?: string;
  shortcutTargetId?: string | null;
  trashed?: boolean;
  canEdit?: boolean;
  myDrive?: boolean;
}): CompanyDriveFile {
  return {
    id,
    name: "Acme Leads",
    mimeType: "application/vnd.google-apps.spreadsheet",
    ownedByMe: true,
    ownerEmails: [EMAIL],
    driveId: options.myDrive ? null : options.driveId ?? APPROVED_DRIVE,
    parents: options.myDrive ? [] : [APPROVED_PARENT],
    capabilities: { canEdit: options.canEdit ?? true, canAddChildren: null },
    trashed: options.trashed ?? false,
    shortcutTargetId: options.shortcutTargetId ?? null,
  };
}

function folderFile(id: string): CompanyDriveFile {
  return {
    id,
    name: "Approved parent",
    mimeType: "application/vnd.google-apps.folder",
    ownedByMe: true,
    ownerEmails: [EMAIL],
    driveId: APPROVED_DRIVE,
    parents: [],
    capabilities: { canEdit: true, canAddChildren: true },
    trashed: false,
    shortcutTargetId: null,
  };
}

async function createClient() {
  seq += 1;
  const clientAccountId = `csc${Date.now().toString(36)}${seq}`;
  clientIds.push(clientAccountId);
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: clientAccountId, status: "onboarding" },
  });
  return clientAccountId;
}

async function createDestination(
  clientAccountId: string,
  input: { dispatch: boolean; revision: number; spreadsheetId?: string }
) {
  await prisma.companySheetsDestination.create({
    data: {
      clientAccountId,
      companyConnectionId: connectionId,
      spreadsheetId: input.spreadsheetId ?? `1saved${clientAccountId}`.slice(0, 40),
      spreadsheetTitle: "Saved",
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${input.spreadsheetId ?? clientAccountId}`,
      worksheetId: 1,
      worksheetTitle: "Saved tab",
      controlBasis: "approved_shared_drive",
      accessStatus: "readable",
      sharingStatus: "missing_recipient",
      enabled: false,
      deliveryExecution: "disabled",
      campaignDispatchEnabled: input.dispatch,
      agedDispatchEnabled: input.dispatch,
      destinationRevision: input.revision,
    },
  });
}

async function destinationRow(clientAccountId: string) {
  const row = await prisma.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId } });
  return {
    spreadsheetId: row.spreadsheetId,
    worksheetId: row.worksheetId,
    destinationRevision: row.destinationRevision,
    campaignDispatchEnabled: row.campaignDispatchEnabled,
    agedDispatchEnabled: row.agedDispatchEnabled,
    enabled: row.enabled,
    deliveryExecution: row.deliveryExecution,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requestCount(clientAccountId: string) {
  return prisma.companySheetsDestinationConfigurationRequest.count({ where: { clientAccountId } });
}

async function operationalSnapshot(clientAccountId: string) {
  const where = { clientAccountId };
  const [destinations, jobs, contracts, creations, rules, suggested, origin] = await Promise.all([
    prisma.companySheetsDestination.count({ where }),
    prisma.companySheetsDeliveryJob.count({ where }),
    prisma.companySheetsTabContract.count({ where: { destination: where } }),
    prisma.companySpreadsheetCreation.count(),
    prisma.campaignRoutingRule.count({ where }),
    prisma.sourceFunnel.count({ where: { suggestedClientAccountId: clientAccountId } }),
    prisma.sourceFunnel.count({ where: { originClientAccountId: clientAccountId } }),
  ]);
  return { destinations, jobs, contracts, creations, rules, funnels: suggested + origin };
}

