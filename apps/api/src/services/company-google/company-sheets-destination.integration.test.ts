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
  ensureCompanyClientFolder,
  presentCompanySheetsPortal,
  resolveCompanyClientFolder,
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

const APPROVED_DRIVE = "0AApprovedDrive00";
const APPROVED_PARENT = "1ApprovedParentFolder";

function ownedSheet(id: string) {
  return {
    id,
    name: "Acme Leads",
    mimeType: "application/vnd.google-apps.spreadsheet",
    ownedByMe: true,
    ownerEmails: ["sheets@lifeagentlaunch.test"],
    driveId: null as string | null,
    parents: [] as string[],
    capabilities: { canEdit: true as boolean | null, canAddChildren: null as boolean | null },
    trashed: false as boolean | null,
    shortcutTargetId: null as string | null,
  };
}

function folderFile(id: string, parents: string[] = []) {
  return {
    id,
    name: "Client folder",
    mimeType: "application/vnd.google-apps.folder",
    ownedByMe: true,
    ownerEmails: ["sheets@lifeagentlaunch.test"],
    driveId: null as string | null,
    parents,
    capabilities: { canEdit: true as boolean | null, canAddChildren: true as boolean | null },
    trashed: false as boolean | null,
    shortcutTargetId: null as string | null,
  };
}

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
    delete process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID;
    delete process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID;
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
        file: ownedSheet(SHEET),
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
            ...ownedSheet(SHEET),
            name: "Foreign",
            ownedByMe: false,
            ownerEmails: ["someone-else@example.com"],
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

  it("records a company-created spreadsheet in an explicit folder and does not fall back to Drive root", async () => {
    const folderId = "1explicitFolder00";
    let createCalls = 0;
    const missingParent = await createCompanySpreadsheetForClient(clientA, undefined, "admin_api", deps({
      createDriveFile: async () => {
        createCalls += 1;
        return { ok: false, reason: "network_error" };
      },
    }));
    assert.equal(missingParent.ok, false);
    if (missingParent.ok) return;
    assert.equal(missingParent.code, "approved_parent_unconfigured");
    assert.equal(createCalls, 0);
    assert.equal(await db.companySpreadsheetCreation.count({ where: { spreadsheetId: `${SHEET}b` } }), 0);

    let unknownCreates = 0;
    const unknown = await createCompanySpreadsheetForClient(
      clientA,
      undefined,
      "admin_api",
      deps({
        getDriveFile: async () => ({
          ok: true,
          file: folderFile(folderId),
        }),
        findNamedChild: async () => ({ ok: true, files: [] }),
        createDriveFile: async () => {
          unknownCreates += 1;
          return { ok: false, reason: "network_error" };
        },
      }),
      folderId
    );
    assert.equal(unknown.ok, false);
    if (unknown.ok) return;
    assert.equal(unknown.code, "create_outcome_unknown");
    assert.equal(unknownCreates, 1);
    assert.equal(await db.companySpreadsheetCreation.count({ where: { spreadsheetId: `${SHEET}b` } }), 0);

    let createdParent = "";
    const created = await createCompanySpreadsheetForClient(
      clientB,
      undefined,
      "admin_api",
      deps({
        getDriveFile: async (input) => ({
          ok: true,
          file:
            input.fileId === `${SHEET}b`
              ? { ...ownedSheet(`${SHEET}b`), name: "Other Agency Leads", parents: [folderId] }
              : folderFile(folderId),
        }),
        findNamedChild: async () => ({ ok: true, files: [] }),
        createDriveFile: async (input) => {
          createdParent = input.parentId;
          assert.equal(input.mimeType, "application/vnd.google-apps.spreadsheet");
          assert.notEqual(input.parentId, "root");
          return {
            ok: true,
            file: {
              ...ownedSheet(`${SHEET}b`),
              name: input.name,
              mimeType: input.mimeType,
              parents: [input.parentId],
            },
          };
        },
        getMetadata: async () => ({ ok: true, metadata: metadata(`${SHEET}b`) }),
      }),
      folderId
    );
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(createdParent, folderId);
    assert.equal(created.spreadsheet.controlBasis, "company_created");
    assert.equal(created.spreadsheet.destinationSaved, false);
    assert.equal(created.spreadsheet.folderPlacement, "placed");
    const marker = await db.companySpreadsheetCreation.findUnique({ where: { spreadsheetId: `${SHEET}b` } });
    assert.equal(marker?.folderId, folderId);
    assert.equal(marker?.folderPlacement, "placed");
    assert.equal(await db.companySheetsDestination.count({ where: { spreadsheetId: `${SHEET}b` } }), 0);
  });

  it("does not change orders, instructions, or delivery targets", async () => {
    assert.equal(await db.leadOrder.count(), ordersBefore);
    assert.equal(await db.deliveryInstruction.count(), instructionsBefore);
    assert.equal(await db.deliveryTarget.count(), targetsBefore);
  });

  it("rejects an unconfigured shared drive and a missing Drive file even when a creation marker exists", async () => {
    const shared = await resolveCompanySpreadsheetForClient(
      clientA,
      SHEET,
      deps({
        getDriveFile: async () => ({
          ok: true,
          file: { ...ownedSheet(SHEET), name: "Shared", driveId: "0ASharedDrive1" },
        }),
      })
    );
    assert.equal(shared.ok, false);
    if (shared.ok) return;
    assert.equal(shared.code, "approved_drive_unconfigured");

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

  it("accepts only the approved shared drive under the parent and keeps the saved destination", async () => {
    process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID = APPROVED_DRIVE;
    process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID = APPROVED_PARENT;
    const child = "1ClientSubfolder0001";
    const approvedSheet = `${SHEET}shared`;
    const files = new Map<string, ReturnType<typeof ownedSheet>>([
      [APPROVED_PARENT, { ...folderFile(APPROVED_PARENT), name: "Client Folders", ownedByMe: false, ownerEmails: [], driveId: APPROVED_DRIVE }],
      [child, { ...folderFile(child, [APPROVED_PARENT]), name: clientA, ownedByMe: false, ownerEmails: [], driveId: APPROVED_DRIVE }],
      [approvedSheet, { ...ownedSheet(approvedSheet), name: "Approved", ownedByMe: false, ownerEmails: [], driveId: APPROVED_DRIVE, parents: [child] }],
    ]);
    const driveDeps = deps({
      getMetadata: async () => ({ ok: true, metadata: metadata(approvedSheet) }),
      getDriveFile: async (input) => {
        const file = files.get(input.fileId);
        if (!file) return { ok: false, reason: "not_found" as const };
        return { ok: true, file };
      },
    });
    const resolved = await resolveCompanySpreadsheetForClient(clientA, approvedSheet, driveDeps);
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.equal(resolved.spreadsheet.controlBasis, "approved_shared_drive");
    const saved = await saveCompanySheetsDestinationForClient(
      clientA,
      { spreadsheetId: approvedSheet, worksheetId: 0 },
      "admin_api",
      driveDeps
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.destination.controlBasis, "approved_shared_drive");
    assert.equal(saved.destination.enabled, false);

    const otherDrive = await resolveCompanySpreadsheetForClient(clientA, approvedSheet, deps({
      getMetadata: async () => ({ ok: true, metadata: metadata(approvedSheet) }),
      getDriveFile: async () => ({
        ok: true,
        file: { ...ownedSheet(approvedSheet), driveId: "0AOtherDrive0001", parents: [child], ownedByMe: false, ownerEmails: [] },
      }),
    }));
    assert.equal(otherDrive.ok, false);
    if (otherDrive.ok) return;
    assert.equal(otherDrive.code, "unapproved_shared_drive");

    const outside = await resolveCompanySpreadsheetForClient(clientA, approvedSheet, deps({
      getMetadata: async () => ({ ok: true, metadata: metadata(approvedSheet) }),
      getDriveFile: async (input) => ({
        ok: true,
        file: input.fileId === "1OtherParentFolder"
          ? { ...folderFile("1OtherParentFolder"), driveId: APPROVED_DRIVE, ownedByMe: false, ownerEmails: [] }
          : { ...ownedSheet(approvedSheet), driveId: APPROVED_DRIVE, parents: ["1OtherParentFolder"], ownedByMe: false, ownerEmails: [] },
      }),
    }));
    assert.equal(outside.ok, false);
    if (outside.ok) return;
    assert.equal(outside.code, "outside_approved_parent");

    const locked = await resolveCompanySpreadsheetForClient(clientA, approvedSheet, deps({
      getMetadata: async () => ({ ok: true, metadata: metadata(approvedSheet) }),
      getDriveFile: async (input) => {
        const file = files.get(input.fileId);
        if (!file) return { ok: false, reason: "not_found" as const };
        return {
          ok: true,
          file: input.fileId === approvedSheet ? { ...file, capabilities: { canEdit: false, canAddChildren: null } } : file,
        };
      },
    }));
    assert.equal(locked.ok, false);
    if (locked.ok) return;
    assert.equal(locked.code, "insufficient_capability");

    const replaced = await saveCompanySheetsDestinationForClient(
      clientA,
      { spreadsheetId: approvedSheet, worksheetId: 0 },
      "admin_api",
      deps({
        getMetadata: async () => ({ ok: true, metadata: metadata(approvedSheet) }),
        getDriveFile: async () => ({
          ok: true,
          file: { ...ownedSheet(approvedSheet), driveId: "0AOtherDrive0001", ownedByMe: false, ownerEmails: [] },
        }),
      })
    );
    assert.equal(replaced.ok, false);
    const still = await db.companySheetsDestination.findUnique({ where: { clientAccountId: clientA } });
    assert.equal(still?.spreadsheetId, approvedSheet);
    assert.equal(still?.controlBasis, "approved_shared_drive");

    const selected = await resolveCompanyClientFolder(clientA, child, driveDeps);
    assert.equal(selected.ok, true);
    if (!selected.ok) return;
    assert.equal(selected.folder.folderId, child);
    assert.equal(selected.folder.basis, "approved_shared_drive");

    let lookups = 0;
    let creates = 0;
    const ensured = await ensureCompanyClientFolder(clientA, deps({
      getDriveFile: driveDeps.getDriveFile,
      findChildFolder: async () => {
        lookups += 1;
        return { ok: true, files: [files.get(child)!] };
      },
      createDriveFile: async () => {
        creates += 1;
        return { ok: false, reason: "invalid_request" };
      },
    }));
    assert.equal(ensured.ok, true);
    if (!ensured.ok) return;
    assert.equal(ensured.folder.created, false);
    assert.equal(ensured.folder.folderId, child);
    assert.equal(lookups, 1);
    assert.equal(creates, 0);

    const blocked = await ensureCompanyClientFolder(clientB, deps({
      getDriveFile: async (input) => {
        if (input.fileId === APPROVED_PARENT) return { ok: true, file: files.get(APPROVED_PARENT)! };
        return { ok: false, reason: "not_found" };
      },
      findChildFolder: async () => ({ ok: true, files: [] }),
      createDriveFile: async () => ({ ok: false, reason: "access_denied" }),
    }));
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.code, "create_placement_failed");
    delete process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID;
    delete process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID;
  });

  it("does not accept a creation marker when Drive metadata scope is missing", async () => {
    const connection = await db.companyGoogleConnection.findUniqueOrThrow({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
    });
    await db.companySpreadsheetCreation.create({
      data: {
        companyConnectionId: connection.id,
        spreadsheetId: `${SHEET}missing`,
        spreadsheetTitle: "Missing scope",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET}missing`,
        worksheetId: 0,
        worksheetTitle: "Leads",
        folderPlacement: "placed",
      },
    });
    await db.companyGoogleConnection.update({
      where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
      data: { scopes: ["https://www.googleapis.com/auth/spreadsheets"] },
    });
    let driveCalls = 0;
    try {
      const resolved = await resolveCompanySpreadsheetForClient(
        clientA,
        `${SHEET}missing`,
        deps({
          getMetadata: async () => ({ ok: true, metadata: metadata(`${SHEET}missing`) }),
          getDriveFile: async () => {
            driveCalls += 1;
            return { ok: true, file: ownedSheet(`${SHEET}missing`) };
          },
        })
      );
      assert.equal(resolved.ok, false);
      if (resolved.ok) return;
      assert.equal(resolved.code, "drive_scope_required");
      assert.equal(driveCalls, 0);
    } finally {
      await db.companyGoogleConnection.update({
        where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY },
        data: { scopes },
      });
      await db.companySpreadsheetCreation.deleteMany({ where: { spreadsheetId: `${SHEET}missing` } });
    }
  });

  it("rejects partial shared-drive settings and a My Drive folder once the policy is complete", async () => {
    process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID = APPROVED_DRIVE;
    delete process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID;
    try {
      const driveOnly = await resolveCompanySpreadsheetForClient(
        clientA,
        SHEET,
        deps({
          getDriveFile: async () => ({
            ok: true,
            file: {
              ...ownedSheet(SHEET),
              driveId: APPROVED_DRIVE,
              ownedByMe: false,
              ownerEmails: [],
              parents: [APPROVED_PARENT],
            },
          }),
        })
      );
      assert.equal(driveOnly.ok, false);
      if (driveOnly.ok) return;
      assert.equal(driveOnly.code, "approved_parent_unconfigured");

      delete process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID;
      process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID = APPROVED_PARENT;
      const parentOnly = await resolveCompanySpreadsheetForClient(
        clientA,
        SHEET,
        deps({
          getDriveFile: async () => ({
            ok: true,
            file: {
              ...ownedSheet(SHEET),
              driveId: APPROVED_DRIVE,
              ownedByMe: false,
              ownerEmails: [],
              parents: [APPROVED_PARENT],
            },
          }),
        })
      );
      assert.equal(parentOnly.ok, false);
      if (parentOnly.ok) return;
      assert.equal(parentOnly.code, "approved_drive_unconfigured");

      process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID = APPROVED_DRIVE;
      let creates = 0;
      let lookups = 0;
      const myDrive = await createCompanySpreadsheetForClient(
        clientB,
        "Elsewhere",
        "admin_api",
        deps({
          getDriveFile: async () => ({ ok: true, file: folderFile("1MyDriveFolder0001") }),
          findNamedChild: async () => {
            lookups += 1;
            return { ok: true, files: [] };
          },
          createDriveFile: async () => {
            creates += 1;
            return { ok: false, reason: "invalid_request" };
          },
        }),
        "1MyDriveFolder0001"
      );
      assert.equal(myDrive.ok, false);
      if (myDrive.ok) return;
      assert.equal(myDrive.code, "outside_approved_parent");
      assert.equal(creates, 0);
      assert.equal(lookups, 0);
    } finally {
      delete process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID;
      delete process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID;
    }
  });

  it("serializes folder creation and does not create a second file after an ambiguous Google response", async () => {
    process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID = APPROVED_DRIVE;
    process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID = APPROVED_PARENT;
    const raceId = "1RaceClientFolder01";
    const parent = {
      ...folderFile(APPROVED_PARENT),
      name: "Client Folders",
      ownedByMe: false,
      ownerEmails: [] as string[],
      driveId: APPROVED_DRIVE,
    };
    let stored: ReturnType<typeof folderFile> | null = null;
    let creates = 0;
    try {
      const raced = deps({
        getDriveFile: async (input) => {
          if (input.fileId === APPROVED_PARENT) return { ok: true as const, file: parent };
          if (stored && input.fileId === stored.id) return { ok: true as const, file: stored };
          return { ok: false as const, reason: "not_found" as const };
        },
        findNamedChild: async () => (stored ? { ok: true as const, files: [stored] } : { ok: true as const, files: [] }),
        createDriveFile: async (input) => {
          creates += 1;
          await new Promise((resolve) => setTimeout(resolve, 80));
          stored = {
            ...folderFile(raceId),
            name: input.name,
            parents: [input.parentId],
            driveId: APPROVED_DRIVE,
            ownedByMe: false,
            ownerEmails: [],
          };
          return { ok: true as const, file: stored };
        },
      });
      const [first, second] = await Promise.all([
        ensureCompanyClientFolder(clientA, raced),
        ensureCompanyClientFolder(clientA, raced),
      ]);
      assert.equal(creates, 1);
      assert.equal(first.ok, true);
      assert.equal(second.ok, true);
      if (!first.ok || !second.ok) return;
      assert.equal(first.folder.folderId, raceId);
      assert.equal(second.folder.folderId, raceId);
      assert.equal(Number(first.folder.created) + Number(second.folder.created), 1);

      const sheetId = `${SHEET}race`;
      const existing = {
        ...ownedSheet(sheetId),
        name: "Race Sheet",
        parents: [raceId],
        driveId: APPROVED_DRIVE,
        ownedByMe: false,
        ownerEmails: [] as string[],
      };
      let sheetCreates = 0;
      let lists = 0;
      const recovered = await createCompanySpreadsheetForClient(
        clientB,
        "Race Sheet",
        "admin_api",
        deps({
          getMetadata: async () => ({ ok: true, metadata: { ...metadata(sheetId), title: "Race Sheet" } }),
          getDriveFile: async (input) => {
            if (input.fileId === APPROVED_PARENT) return { ok: true as const, file: parent };
            if (input.fileId === raceId && stored) return { ok: true as const, file: stored };
            if (input.fileId === sheetId) return { ok: true as const, file: existing };
            return { ok: false as const, reason: "not_found" as const };
          },
          findNamedChild: async () => {
            lists += 1;
            if (lists === 1) return { ok: true as const, files: [] };
            return { ok: true as const, files: [existing] };
          },
          createDriveFile: async () => {
            sheetCreates += 1;
            return { ok: false as const, reason: "network_error" as const };
          },
        }),
        raceId
      );
      assert.equal(sheetCreates, 1);
      assert.equal(lists, 2);
      assert.equal(recovered.ok, true);
      if (!recovered.ok) return;
      assert.equal(recovered.spreadsheet.controlBasis, "approved_shared_drive");
      assert.equal(await db.companySpreadsheetCreation.count({ where: { spreadsheetId: sheetId } }), 0);

      lists = 0;
      sheetCreates = 0;
      const many = await createCompanySpreadsheetForClient(
        clientB,
        "Race Sheet Two",
        "admin_api",
        deps({
          getDriveFile: async (input) => {
            if (input.fileId === raceId && stored) return { ok: true as const, file: stored };
            if (input.fileId === APPROVED_PARENT) return { ok: true as const, file: parent };
            return { ok: false as const, reason: "not_found" as const };
          },
          findNamedChild: async () => {
            lists += 1;
            if (lists === 1) return { ok: true as const, files: [] };
            return { ok: false as const, reason: "ambiguous" as const };
          },
          createDriveFile: async () => {
            sheetCreates += 1;
            return { ok: false as const, reason: "network_error" as const };
          },
        }),
        raceId
      );
      assert.equal(many.ok, false);
      if (many.ok) return;
      assert.equal(many.code, "ambiguous_spreadsheet");
      assert.equal(sheetCreates, 1);

      sheetCreates = 0;
      const denied = await createCompanySpreadsheetForClient(
        clientB,
        "Race Sheet Three",
        "admin_api",
        deps({
          getDriveFile: async (input) => {
            if (input.fileId === raceId && stored) return { ok: true as const, file: stored };
            if (input.fileId === APPROVED_PARENT) return { ok: true as const, file: parent };
            return { ok: false as const, reason: "not_found" as const };
          },
          findNamedChild: async () => ({ ok: false as const, reason: "access_denied" as const }),
          createDriveFile: async () => {
            sheetCreates += 1;
            return { ok: false as const, reason: "invalid_request" as const };
          },
        }),
        raceId
      );
      assert.equal(denied.ok, false);
      if (denied.ok) return;
      assert.equal(denied.code, "child_lookup_unsupported");
      assert.equal(sheetCreates, 0);
    } finally {
      delete process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID;
      delete process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID;
      await db.companySpreadsheetCreation.deleteMany({ where: { spreadsheetId: `${SHEET}race` } });
    }
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
