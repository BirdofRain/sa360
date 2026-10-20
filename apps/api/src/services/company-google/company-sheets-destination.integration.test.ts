/**
 * Local sa360_test company Sheets foundation. No live Google HTTP.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { COMPANY_GOOGLE_CONNECTION_KEY } from "../../lib/company-google-sheets-env.js";
import { decryptGoogleToken } from "../../lib/google-token-encryption.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  compareAndSetCompanyGoogleTokenRefresh,
  markCompanyGoogleReconnectRequired,
  upsertCompanyGoogleConnection,
} from "./company-google-connection.service.js";
import { disconnectCompanyGoogleOAuth } from "./company-google-oauth.service.js";
import {
  createCompanySpreadsheetForClient,
  presentCompanySheetsPortal,
  resolveCompanySpreadsheetForClient,
  saveCompanySheetsDestinationForClient,
  type CompanySheetsDeps,
} from "./company-sheets-destination.service.js";
import type { GoogleSpreadsheetMetadata } from "../google-sheets/google-sheets-http-client.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const GOOGLE_TEST_KEY = "test-google-encryption-key-for-unit-tests-only";

const SHEET = "1companySheetIdValue0001";
const scopes = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.file",
];

function metadata(id = SHEET): GoogleSpreadsheetMetadata {
  return {
    spreadsheetId: id,
    title: "Acme Leads",
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
    worksheets: [
      { sheetId: 0, title: "Leads", index: 0, hidden: false, sheetType: "GRID" },
    ],
  };
}

describe("company Google Sheets foundation (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const clientA = `cgs_a_${suffix}`;
  const clientB = `cgs_b_${suffix}`;
  const previousKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  let ordersBefore = 0;
  let instructionsBefore = 0;
  let targetsBefore = 0;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = GOOGLE_TEST_KEY;
    process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED = "true";
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: clientA, clientDisplayName: "Acme Insurance", status: "active" },
        { clientAccountId: clientB, clientDisplayName: "Other Agency", status: "active" },
      ],
    });
    ordersBefore = await db.leadOrder.count();
    instructionsBefore = await db.deliveryInstruction.count();
    targetsBefore = await db.deliveryTarget.count();
    const connected = await upsertCompanyGoogleConnection(
      {
        googleUserId: `company-sub-${suffix}`,
        googleEmail: "sheets@lifeagentlaunch.test",
        googleDisplayName: "Life Agent Launch",
        accessToken: "ya29.company-access",
        refreshToken: "1//company-refresh",
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        scopes,
        tokenType: "Bearer",
      },
      db
    );
    assert.equal(connected.ok, true);
    if (connected.ok) {
      assert.equal(JSON.stringify(connected.connection).includes("company-access"), false);
      assert.equal(JSON.stringify(connected.connection).includes("company-refresh"), false);
    }
  });

  after(async () => {
    if (previousKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
    else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = previousKey;
    delete process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED;
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup() {
    await db.companySheetsDestination.deleteMany({
      where: { clientAccountId: { in: [clientA, clientB] } },
    });
    await db.companySpreadsheetCreation.deleteMany({
      where: { spreadsheetId: { in: [SHEET, `${SHEET}b`, `${SHEET}missing`] } },
    });
    await db.companyGoogleOAuthPendingAuth.deleteMany({});
    await db.companyGoogleConnection.deleteMany({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
    });
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [clientA, clientB] } },
    });
  }

  function deps(overrides: CompanySheetsDeps = {}): CompanySheetsDeps {
    return {
      env: process.env,
      db,
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.company-access",
        connectionId: "company",
        tokenVersion: 1,
        googleEmail: "sheets@lifeagentlaunch.test",
      }),
      getMetadata: async () => ({ ok: true, metadata: metadata() }),
      getDriveFile: async () => ({
        ok: true,
        file: {
          id: SHEET,
          name: "Acme Leads",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: ["sheets@lifeagentlaunch.test"],
          driveId: null,
        },
      }),
      ...overrides,
    };
  }

  it("resolves a company-owned sheet and does not save a destination", async () => {
    const resolved = await resolveCompanySpreadsheetForClient(clientA, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`, deps());
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.spreadsheet.controlBasis, "drive_owner_verified");
    assert.equal(resolved.spreadsheet.writable, false);
    assert.equal(await db.companySheetsDestination.count({ where: { clientAccountId: clientA } }), 0);
  });

  it("rejects a readable sheet the company account does not own", async () => {
    const resolved = await resolveCompanySpreadsheetForClient(
      clientA,
      SHEET,
      deps({
        getDriveFile: async () => ({
          ok: true,
          file: {
            id: SHEET,
            name: "Foreign",
            mimeType: "application/vnd.google-apps.spreadsheet",
            ownedByMe: false,
            ownerEmails: ["someone-else@example.com"],
            driveId: null,
          },
        }),
      })
    );
    assert.equal(resolved.ok, false);
    if (resolved.ok) return;
    assert.equal(resolved.code, "not_company_controlled");
  });

  it("does not treat a pasted URL as company-owned when Drive scope is missing", async () => {
    await db.companyGoogleConnection.update({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
      data: { scopes: ["https://www.googleapis.com/auth/spreadsheets"] },
    });
    try {
      const resolved = await resolveCompanySpreadsheetForClient(clientA, SHEET, deps());
      assert.equal(resolved.ok, false);
      if (resolved.ok) return;
      assert.equal(resolved.code, "drive_scope_required");
    } finally {
      await db.companyGoogleConnection.update({
        where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
        data: { scopes },
      });
    }
  });

  it("saves one dormant destination and refuses the same sheet for another client", async () => {
    const saved = await saveCompanySheetsDestinationForClient(
      clientA,
      {
        spreadsheetId: SHEET,
        worksheetId: 0,
        intendedRecipientEmail: "Buyer@Example.com",
        createdBySa360: true,
        ownedByCompany: true,
        enabled: true,
      } as never,
      "admin_api",
      deps()
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.destination.controlBasis, "drive_owner_verified");
    assert.equal(saved.destination.enabled, false);
    assert.equal(saved.destination.writeReadiness, "not_verified");
    assert.equal(saved.destination.deliveryExecution, "disabled");
    assert.equal(saved.destination.liveDeliveryEnabled, false);
    assert.equal(saved.destination.sharing.status, "intended_recipient_recorded_not_applied");
    assert.equal(saved.destination.sharing.anyoneWithLink, false);
    assert.equal(saved.destination.sharing.portalLinkGrantsGoogleAccess, false);
    const portal = presentCompanySheetsPortal(saved.destination);
    assert.equal(JSON.stringify(portal).includes("sheets@lifeagentlaunch.test"), false);
    assert.equal(portal.orderDelivery.automatedWritesEnabled, false);
    assert.equal(portal.clientAccountId, clientA);

    const other = await saveCompanySheetsDestinationForClient(
      clientB,
      { spreadsheetId: SHEET, worksheetId: 0 },
      "admin_api",
      deps()
    );
    assert.equal(other.ok, false);
    if (other.ok) return;
    assert.equal(other.code, "spreadsheet_bound_to_other_client");
    const visibleToB = await db.companySheetsDestination.findUnique({ where: { clientAccountId: clientB } });
    assert.equal(visibleToB, null);
  });

  it("records a company-created spreadsheet without saving a destination or retrying a timeout", async () => {
    const unknown = await createCompanySpreadsheetForClient(
      clientA,
      undefined,
      "admin_api",
      deps({
        createSpreadsheet: async () => ({ ok: false, reason: "network_error" }),
      })
    );
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.equal(unknown.code, "create_outcome_unknown");
    assert.equal(await db.companySpreadsheetCreation.count({ where: { spreadsheetId: `${SHEET}b` } }), 0);

    let requestedTitle = "";
    const created = await createCompanySpreadsheetForClient(
      clientB,
      undefined,
      "admin_api",
      deps({
        createSpreadsheet: async (input) => {
          requestedTitle = input.title;
          return { ok: true, metadata: metadata(`${SHEET}b`) };
        },
      })
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(requestedTitle, "Other Agency Leads");
    assert.equal(created.spreadsheet.controlBasis, "company_created");
    assert.equal(created.spreadsheet.destinationSaved, false);
    assert.equal(created.spreadsheet.folderPlacement, "root_unconfigured");
    const marker = await db.companySpreadsheetCreation.findUnique({ where: { spreadsheetId: `${SHEET}b` } });
    assert.ok(marker);
    assert.equal(await db.companySheetsDestination.count({ where: { spreadsheetId: `${SHEET}b` } }), 0);
  });

  it("does not change orders, instructions, or delivery targets", async () => {
    assert.equal(await db.leadOrder.count(), ordersBefore);
    assert.equal(await db.deliveryInstruction.count(), instructionsBefore);
    assert.equal(await db.deliveryTarget.count(), targetsBefore);
  });

  it("rejects a shared drive and a missing Drive file even when a creation marker exists", async () => {
    const shared = await resolveCompanySpreadsheetForClient(
      clientA,
      SHEET,
      deps({
        getDriveFile: async () => ({
          ok: true,
          file: {
            id: SHEET,
            name: "Shared",
            mimeType: "application/vnd.google-apps.spreadsheet",
            ownedByMe: true,
            ownerEmails: ["sheets@lifeagentlaunch.test"],
            driveId: "0AShared",
          },
        }),
      })
    );
    assert.equal(shared.ok, false);
    if (shared.ok) return;
    assert.equal(shared.code, "shared_drive_unsupported");

    const connection = await db.companyGoogleConnection.findUniqueOrThrow({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
    });
    await db.companySpreadsheetCreation.create({
      data: {
        companyConnectionId: connection.id,
        spreadsheetId: `${SHEET}missing`,
        spreadsheetTitle: "Missing",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}missing`,
        worksheetId: 0,
        worksheetTitle: "Leads",
        folderPlacement: "root_unconfigured",
      },
    });
    const missing = await resolveCompanySpreadsheetForClient(
      clientA,
      `${SHEET}missing`,
      deps({
        getMetadata: async () => ({ ok: true, metadata: metadata(`${SHEET}missing`) }),
        getDriveFile: async () => ({ ok: false, reason: "not_found" }),
      })
    );
    assert.equal(missing.ok, false);
    if (missing.ok) return;
    assert.equal(missing.code, "spreadsheet_unavailable");
    await db.companySpreadsheetCreation.deleteMany({ where: { spreadsheetId: `${SHEET}missing` } });
  });

  it("does not let a refresh undo reconnect or swap the company identity", async () => {
    const before = await db.companyGoogleConnection.findUniqueOrThrow({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
    });
    const marked = await markCompanyGoogleReconnectRequired(
      { id: before.id, expectedTokenVersion: before.tokenVersion, lastError: "revoked" },
      db
    );
    assert.equal(marked.ok, true);
    const staleRefresh = await compareAndSetCompanyGoogleTokenRefresh(
      {
        id: before.id,
        expectedTokenVersion: before.tokenVersion,
        accessToken: "ya29.stale",
        tokenExpiresAt: new Date(Date.now() + 60_000),
      },
      db
    );
    assert.equal(staleRefresh.ok, false);
    const afterMark = await db.companyGoogleConnection.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(afterMark.status, "reconnect_required");
    const otherIdentity = await upsertCompanyGoogleConnection(
      {
        googleUserId: `other-company-${suffix}`,
        googleEmail: "other@lifeagentlaunch.test",
        accessToken: "ya29.other",
        refreshToken: "1//other",
        tokenExpiresAt: new Date(Date.now() + 60_000),
        scopes,
      },
      db
    );
    assert.equal(otherIdentity.ok, false);
    if (otherIdentity.ok) return;
    assert.equal(otherIdentity.reason, "company_account_already_connected");
    await db.companyGoogleConnection.update({
      where: { id: before.id },
      data: { status: "connected", reconnectRequiredAt: null, lastError: null },
    });
  });

  it("disconnects credentials without deleting the destination or the Google file", async () => {
    const before = await db.companySheetsDestination.count({ where: { clientAccountId: clientA } });
    assert.equal(before, 1);
    delete process.env.SA360_COMPANY_GOOGLE_OAUTH_ENABLED;
    let googleCalls = 0;
    const revoked = await disconnectCompanyGoogleOAuth({
      env: process.env,
      db,
      fetchImpl: async () => {
        googleCalls += 1;
        return new Response("", { status: 200 });
      },
    });
    assert.equal(googleCalls, 0);
    assert.equal(revoked.ok, true);
    const row = await db.companyGoogleConnection.findUnique({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
    });
    assert.equal(row?.status, "disconnected");
    assert.equal(row?.accessTokenEncrypted, null);
    assert.equal(row?.refreshTokenEncrypted, null);
    assert.equal(await db.companySheetsDestination.count({ where: { clientAccountId: clientA } }), 1);
    const stored = await db.companyGoogleConnection.findUnique({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
    });
    assert.equal(stored?.accessTokenEncrypted, null);
    assert.equal(decryptGoogleToken.length > 0, true);
  });
});
