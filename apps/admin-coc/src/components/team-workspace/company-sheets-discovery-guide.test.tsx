import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { presentCompanySheetsDiscovery, type CompanySheetsDiscoverySnapshot } from "@/lib/team-workspace/company-sheets-discovery.ts";

const calls: string[] = [];

function readySnapshot(): CompanySheetsDiscoverySnapshot {
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
      destinationFolder: { folderId: "parent-1", title: "Approved", verifiedAt: "2026-11-01T00:00:00.000Z" },
      oauthAvailable: true,
      sheetsSetupAvailable: true,
    },
    destination: {
      spreadsheetId: "sheet-1",
      spreadsheetTitle: "Alex leads",
      worksheetId: 101,
      worksheetTitle: "Campaign Leads",
      controlBasis: "approved_shared_drive",
      accessStatus: "readable",
      destinationRevision: 4,
    },
    contracts: [{ role: "campaign", setupState: "bound", setupReason: null, worksheetId: 101, worksheetTitle: "Campaign Leads", schemaVersion: "company_sheets_campaign_v3" }],
    dispatch: { campaignDispatchEnabled: true, agedDispatchEnabled: false, dispatchFlagEnabled: false },
    mapping: { readiness: "ready", schemaVersion: "company_sheets_campaign_v3", boundSchemaVersion: "company_sheets_campaign_v3" },
    mappingError: null,
    storage: {
      inspectError: null,
      listError: null,
      folder: { folderId: "folder-1", title: "Alex Gross" },
      folderUnlinked: false,
      folderCheck: { ok: true, basis: "approved_shared_drive" },
      spreadsheets: [
        { spreadsheetId: "sheet-1", title: "Alex leads" },
        { spreadsheetId: "sheet-2", title: "Other workbook" },
      ],
      skipped: 0,
      candidates: [],
    },
    worksheetRead: {
      spreadsheetId: "sheet-1",
      ok: true,
      code: null,
      title: "Alex leads",
      controlBasis: "approved_shared_drive",
      worksheets: [
        { worksheetId: 101, title: "Campaign Leads", sheetType: "GRID" },
        { worksheetId: 202, title: "Notes", sheetType: "GRID" },
      ],
    },
    selection: { spreadsheetId: null, worksheetId: null },
  };
}

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "@/app/actions/team-workspace-company-sheets") {
    return {
      loadTeamWorkspaceCompanySheetsAction: async () => {
        calls.push("load");
        return { ok: true, code: "READ", message: null, uncertain: false, snapshot: readySnapshot(), nextPageToken: null };
      },
      inspectTeamWorkspaceCompanySheetsStorageAction: async () => {
        calls.push("storage");
        return { ok: true, code: "READ", message: null, uncertain: false, snapshot: readySnapshot(), nextPageToken: null };
      },
      readTeamWorkspaceCompanySheetsWorksheetsAction: async () => {
        calls.push("worksheets");
        return { ok: true, code: "READ", message: null, uncertain: false, read: readySnapshot().worksheetRead };
      },
      pageTeamWorkspaceCompanySheetsSpreadsheetsAction: async () => {
        calls.push("page");
        return { ok: true, code: "READ", message: null, uncertain: false, spreadsheets: [], skipped: 0, nextPageToken: null };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

let Guide: typeof import("./company-sheets-discovery-guide.tsx").CompanySheetsDiscoveryGuide;

test.before(async () => {
  ({ CompanySheetsDiscoveryGuide: Guide } = await import("./company-sheets-discovery-guide.tsx"));
});

test.afterEach(() => {
  cleanup();
  calls.length = 0;
});

test("the guide does not expose creation, destination save, or delivery", () => {
  const source = readFileSync(new URL("./company-sheets-discovery-guide.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("createCompanySpreadsheet"), false);
  assert.equal(source.includes("saveCompanySheetsDestination"), false);
  assert.equal(source.includes("Check storage"), true);
  assert.equal(source.includes("Read worksheets"), true);
  assert.equal(/activate delivery/i.test(source), false);
});

test("an active destination stays distinct from verified and an unsaved worksheet is labeled", async () => {
  render(<Guide clientAccountId="alex_gross" />);
  const summary = await screen.findByText(/Configured\. Verified\. Active\./);
  assert.match(summary.textContent ?? "", /Active/);
  assert.equal(screen.getByText("Configured: yes").getAttribute("data-on"), "true");
  assert.equal(screen.getByText("Verified: yes").getAttribute("data-on"), "true");
  assert.equal(screen.getByText("Active: yes").getAttribute("data-on"), "true");
  assert.equal(screen.queryByRole("button", { name: /save spreadsheet/i }), null);
  assert.equal(screen.queryByRole("button", { name: /create folder/i }), null);
  assert.equal(calls.includes("storage"), false);
  assert.equal(calls.includes("worksheets"), false);
  fireEvent.click(screen.getByRole("button", { name: /Notes/ }));
  assert.equal(screen.getByText(/Not saved\./).textContent?.includes("202"), true);
  fireEvent.change(screen.getByLabelText("Find a spreadsheet"), { target: { value: "other" } });
  assert.equal(screen.queryByRole("button", { name: /Alex leads/ }), null);
  assert.equal(screen.getByRole("button", { name: /Other workbook/ }), screen.getByRole("button", { name: /Other workbook/ }));
  const presented = presentCompanySheetsDiscovery(readySnapshot());
  assert.equal(presented.operationalWrite, false);
});
