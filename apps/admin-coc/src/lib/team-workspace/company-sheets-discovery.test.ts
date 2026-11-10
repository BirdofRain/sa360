import assert from "node:assert/strict";
import test from "node:test";

import {
  presentCompanySheetsDiscovery,
  type CompanySheetsDiscoverySnapshot,
} from "./company-sheets-discovery.ts";

function snapshot(overrides: Partial<CompanySheetsDiscoverySnapshot> = {}): CompanySheetsDiscoverySnapshot {
  return {
    clientAccountId: "alex_gross",
    disabledReason: null,
    uncertain: false,
    loadError: null,
    connection: {
      configured: true,
      status: "connected",
      connected: true,
      reconnectRequired: false,
      googleEmail: "sheets@lifeagentlaunch.com",
      googleDisplayName: "Life Agent Launch",
      missingScopes: [],
      destinationFolder: { folderId: "parent-1", title: "Approved parent", verifiedAt: "2026-11-01T00:00:00.000Z" },
      oauthAvailable: true,
      sheetsSetupAvailable: true,
    },
    destination: null,
    contracts: [],
    dispatch: { campaignDispatchEnabled: false, agedDispatchEnabled: false, dispatchFlagEnabled: false },
    mapping: { readiness: "destination_not_saved", schemaVersion: "company_sheets_campaign_v3", boundSchemaVersion: null },
    mappingError: null,
    storage: null,
    worksheetRead: null,
    selection: { spreadsheetId: null, worksheetId: null },
    ...overrides,
  };
}

test("a disconnected company account is not treated as ready", () => {
  const view = presentCompanySheetsDiscovery(snapshot({
    connection: {
      configured: false,
      status: "disconnected",
      connected: false,
      reconnectRequired: false,
      googleEmail: null,
      googleDisplayName: null,
      missingScopes: [],
      destinationFolder: null,
      oauthAvailable: false,
      sheetsSetupAvailable: false,
    },
  }));
  assert.equal(view.configured, false);
  assert.equal(view.verified, false);
  assert.equal(view.active, false);
  assert.match(view.blockers.join(" "), /not asked to connect their own Google account/i);
  assert.equal(view.googleAccountEmail, null);
  assert.equal(JSON.stringify(view).includes("accessToken"), false);
});

test("a client without a folder is reported without creating one", () => {
  const view = presentCompanySheetsDiscovery(snapshot({
    storage: {
      inspectError: null,
      listError: null,
      folder: null,
      folderUnlinked: false,
      folderCheck: null,
      spreadsheets: [],
      skipped: 0,
      candidates: [],
    },
  }));
  assert.equal(view.clientFolderStatus, "missing");
  assert.match(view.clientFolderDetail, /was not created/i);
});

test("a folder outside approved storage is not a client folder", () => {
  const view = presentCompanySheetsDiscovery(snapshot({
    storage: {
      inspectError: null,
      listError: null,
      folder: { folderId: "folder-out", title: "Elsewhere" },
      folderUnlinked: false,
      folderCheck: { ok: false, code: "outside_approved_parent" },
      spreadsheets: [{ spreadsheetId: "sheet-out", title: "Outside" }],
      skipped: 0,
      candidates: [],
    },
  }));
  assert.equal(view.clientFolderStatus, "outside_approved");
  assert.equal(view.spreadsheets.length, 0);
});

test("a missing spreadsheet and a file outside the approved drive stay unverified", () => {
  const missing = presentCompanySheetsDiscovery(snapshot());
  assert.match(missing.blockers.join(" "), /No Company Sheets destination is saved/);
  const outside = presentCompanySheetsDiscovery(snapshot({
    destination: savedDestination(),
    worksheetRead: {
      spreadsheetId: "sheet-1",
      ok: false,
      code: "unapproved_shared_drive",
      title: null,
      controlBasis: null,
      worksheets: [],
    },
  }));
  assert.equal(outside.verified, false);
  assert.match(outside.blockers.join(" "), /not the approved company drive/);
});

test("a worksheet that is not the saved one stays unsaved", () => {
  const view = presentCompanySheetsDiscovery(snapshot({
    destination: savedDestination(),
    contracts: [boundContract(101)],
    selection: { spreadsheetId: "sheet-1", worksheetId: 202 },
    worksheetRead: {
      spreadsheetId: "sheet-1",
      ok: true,
      code: null,
      title: "Alex leads",
      controlBasis: "approved_shared_drive",
      worksheets: [
        { worksheetId: 101, title: "Campaign Leads", sheetType: "GRID" },
        { worksheetId: 202, title: "Other", sheetType: "GRID" },
      ],
    },
  }));
  assert.equal(view.selection.matchesSavedWorksheet, false);
  assert.match(view.blockers.join(" "), /Unsaved choice: the highlighted worksheet/);
  assert.equal(view.operationalWrite, false);
});

test("no campaign contract and no ready column mapping are separate blockers", () => {
  const view = presentCompanySheetsDiscovery(snapshot({
    destination: savedDestination(),
    mapping: { readiness: "tab_not_bound", schemaVersion: null, boundSchemaVersion: null },
  }));
  assert.match(view.blockers.join(" "), /No campaign tab contract is saved/);
  assert.match(view.blockers.join(" "), /column mapping is not ready/i);
  assert.equal(view.verified, false);
  assert.equal(view.configured, true);
});

test("an active destination is active without becoming verified", () => {
  const view = presentCompanySheetsDiscovery(snapshot({
    destination: savedDestination(),
    contracts: [boundContract(101)],
    mapping: { readiness: "ready", schemaVersion: "company_sheets_campaign_v3", boundSchemaVersion: "company_sheets_campaign_v3" },
    dispatch: { campaignDispatchEnabled: true, agedDispatchEnabled: false, dispatchFlagEnabled: true },
  }));
  assert.equal(view.configured, true);
  assert.equal(view.verified, false);
  assert.equal(view.active, true);
  assert.match(view.blockers.join(" "), /will not change it/);
  assert.equal(view.delivery.executionFlagRead, false);
});

test("verification requires this session's control check and the bound worksheet", () => {
  const unverified = presentCompanySheetsDiscovery(snapshot({
    destination: savedDestination(),
    contracts: [boundContract(101)],
    mapping: { readiness: "ready", schemaVersion: "v3", boundSchemaVersion: "v3" },
  }));
  assert.equal(unverified.verified, false);
  const verified = presentCompanySheetsDiscovery(snapshot({
    destination: savedDestination(),
    contracts: [boundContract(101)],
    mapping: { readiness: "ready", schemaVersion: "v3", boundSchemaVersion: "v3" },
    worksheetRead: {
      spreadsheetId: "sheet-1",
      ok: true,
      code: null,
      title: "Alex leads",
      controlBasis: "approved_shared_drive",
      worksheets: [{ worksheetId: 101, title: "Campaign Leads", sheetType: "GRID" }],
    },
  }));
  assert.equal(verified.configured, true);
  assert.equal(verified.verified, true);
  assert.equal(verified.active, false);
});

test("a shortcut, a Google outage, and a credential field stay out of the saved state", () => {
  const shortcut = presentCompanySheetsDiscovery(snapshot({
    worksheetRead: {
      spreadsheetId: "https://docs.google.com/spreadsheets/d/sheet-1",
      ok: false,
      code: "shortcut_bypass",
      title: null,
      controlBasis: null,
      worksheets: [],
    },
  }));
  assert.match(shortcut.blockers.join(" "), /shortcut was not followed/i);
  const outage = presentCompanySheetsDiscovery(snapshot({ loadError: "Google is unavailable right now. Nothing was created and delivery was not started.", uncertain: true }));
  assert.equal(outage.availability, "error");
  assert.equal(outage.uncertain, true);
  const leaked = presentCompanySheetsDiscovery(snapshot());
  const serialized = JSON.stringify({ ...leaked, injected: "ya29.secret-token" });
  assert.equal(JSON.stringify(leaked).includes("secret-token"), false);
  assert.equal(serialized.includes("secret-token"), true);
});

test("disabled Team Workspace does not describe a destination as configured", () => {
  const view = presentCompanySheetsDiscovery(snapshot({
    disabledReason: "Team Workspace is turned off. Company Sheets was not read, and delivery was not turned on.",
    connection: null,
    dispatch: null,
    mapping: null,
  }));
  assert.equal(view.availability, "disabled");
  assert.equal(view.configured, false);
  assert.equal(view.active, false);
});

function savedDestination() {
  return {
    spreadsheetId: "sheet-1",
    spreadsheetTitle: "Alex leads",
    worksheetId: 101,
    worksheetTitle: "Campaign Leads",
    controlBasis: "approved_shared_drive",
    accessStatus: "readable",
    destinationRevision: 4,
  };
}

function boundContract(worksheetId: number) {
  return {
    role: "campaign",
    setupState: "bound",
    setupReason: null,
    worksheetId,
    worksheetTitle: "Campaign Leads",
    schemaVersion: "company_sheets_campaign_v3",
  };
}
