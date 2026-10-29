import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import type {
  ColumnMapRecord,
  OnboardingSummary,
  OnboardingWorkspaceActions,
  SheetsTargetSave,
} from "@/lib/clients/onboarding/types";

import { SheetsCard } from "./integration-cards";

test.afterEach(() => cleanup());

test("the v3 preset review stays separate from custom mapping", () => {
  const source = readFileSync(new URL("../company-sheets-admin-panel.tsx", import.meta.url), "utf8");
  assert.equal(source.includes("Custom column editing is not available"), false);
  assert.equal(source.includes("Review column mapping"), true);
  assert.equal(source.includes("v1/v2/v3 template review"), true);
});

test("an operator maps an existing tab and a live campaign switch blocks the edit", async () => {
  const calls: string[] = [];
  const record = mapRecord();
  const actions = mockActions(calls, record);
  render(
    <SheetsCard
      clientName="Alex Gross"
      summary={summary(false)}
      connection={null}
      connectionError={null}
      actions={actions}
      onViewWorksheet={() => undefined}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Browse linked folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Preview worksheets" }));
  assert.ok(await screen.findByText("Spreadsheet sheet_existing_tab"));
  assert.ok(screen.getByText("worksheet gid 0"));
  assert.ok(screen.getByText("worksheet gid 15"));
  assert.ok(screen.getByText(/A custom map is not created for this tab/));
  assert.equal(screen.queryByRole("button", { name: "Map columns", hidden: false }) instanceof HTMLButtonElement, true);

  fireEvent.click(screen.getByRole("button", { name: "Map columns" }));
  assert.ok(await screen.findByTestId("column-map-editor"));
  assert.ok(screen.getByText(/Header fingerprint abc123/));
  assert.ok(screen.getByText(/SYNTHETIC TEST/));
  assert.ok(screen.getByText(/Confirm this suggestion or mark the column unmapped/));
  assert.ok(screen.getByText(/A blank header cannot be mapped/));
  assert.ok(screen.getByText(/Appends add a new row only/));
  assert.ok(screen.getByText(/so the existing formula stays/));
  assert.ok(screen.getByText(/The new row leaves that cell empty/));
  assert.equal(screen.queryByText(/omitted_when_header/), null);
  const blankNote = screen.getByText(/A blank header cannot be mapped/);
  assert.equal(blankNote.closest("li")?.textContent?.includes("Suggestion only"), false);
  assert.equal(calls.includes("target"), true);
  assert.equal(calls.includes("create"), true);

  fireEvent.change(screen.getByRole("combobox", { name: "Map Phone Number" }), { target: { value: "unmapped" } });
  fireEvent.click(screen.getByRole("button", { name: "Save mapping" }));
  assert.ok(await screen.findByText(/Phone Number must be mapped/));
  assert.equal(calls.includes("update"), true);

  fireEvent.click(screen.getByRole("button", { name: "Publish mapping" }));
  assert.equal(calls.includes("publish"), true);
  cleanup();

  render(
    <SheetsCard
      clientName="Alex Gross"
      summary={summary(true)}
      connection={null}
      connectionError={null}
      actions={mockActions([], record)}
      onViewWorksheet={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Browse linked folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Preview worksheets" }));
  await screen.findByText("worksheet gid 15");
  const blocked = screen.getByRole("button", { name: "Map columns" }) as HTMLButtonElement;
  assert.equal(blocked.disabled, true);
  assert.ok(screen.getByText("Pause campaign Sheets delivery before changing the target or the column map."));
});

test("mapping controls stay hidden until the column-map actions exist", async () => {
  const actions = mockActions([], mapRecord());
  delete actions.createColumnMap;
  delete actions.saveSheetsTarget;
  render(
    <SheetsCard
      clientName="Alex Gross"
      summary={summary(false)}
      connection={null}
      connectionError={null}
      actions={actions}
      onViewWorksheet={() => undefined}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Browse linked folder" }));
  fireEvent.click(await screen.findByRole("button", { name: "Preview worksheets" }));
  await screen.findByText("worksheet gid 15");
  assert.equal(screen.queryByRole("button", { name: "Map columns" }), null);
  assert.equal(screen.queryByRole("button", { name: "Select this tab" }), null);
  assert.ok(screen.getAllByRole("button", { name: "View worksheet" }).length >= 1);
});

function summary(campaignDispatchEnabled: boolean): OnboardingSummary {
  return {
    ok: true,
    contractVersion: "client_onboarding_v2",
    client: {
      clientAccountId: "alex_gross",
      clientDisplayName: "Alex Gross",
      status: "onboarding",
      primaryNicheKeys: ["vet"],
      primaryProductTypes: [],
    },
    setupRequest: { present: false, status: null, revision: 0, destinationChoice: null, operational: false },
    sources: [],
    sheets: {
      destinationSaved: false,
      spreadsheetId: null,
      campaignTab: null,
      campaignDispatchEnabled,
      campaignDispatchNotBefore: campaignDispatchEnabled ? "2026-10-27T14:43:39.233Z" : null,
      agedDispatchEnabled: false,
      writeReadiness: "not_verified",
      deliveryExecution: "disabled",
      uncertainJob: false,
    },
    ghl: {
      mode: "unset",
      locationIdPresent: false,
      workflowTriggerMode: null,
      workflowIdPresent: false,
      inboundWebhookArmed: false,
      notesEnabled: false,
      notesContractVersion: null,
    },
    externalZapier: { preserved: true, replacedByNative: false },
    gates: [],
    liveActivationPerformedByOnboarding: false,
    blockers: [],
  };
}

function mapRecord(): ColumnMapRecord {
  return {
    id: "map_1",
    revision: 1,
    mapVersion: 1,
    status: "draft",
    sourceScope: "shared",
    spreadsheetId: "sheet_existing_tab",
    worksheetId: 15,
    worksheetTitle: "VET Web Form",
    headerFingerprint: "abc123",
    headerSnapshot: ["Full Name", "Phone Number", ""],
    assignments: [
      {
        sheetHeader: "Full Name",
        columnIndex: 0,
        formula: false,
        target: { kind: "v3_column", header: "Client Name", sourceField: "full_name" },
        transform: "passthrough",
        decision: "mapped",
        explicit: false,
        code: null,
      },
      {
        sheetHeader: "Phone Number",
        columnIndex: 1,
        formula: false,
        target: { kind: "v3_column", header: "Phone", sourceField: "phone" },
        transform: "passthrough",
        decision: "mapped",
        explicit: false,
        code: null,
      },
      {
        sheetHeader: "",
        columnIndex: 2,
        formula: false,
        target: null,
        transform: "blank",
        decision: "unmapped",
        explicit: false,
        code: "blank_header",
      },
    ],
    issues: [
      { columnIndex: 0, sheetHeader: "Full Name", code: "mapping_unresolved", message: "Confirm this suggestion or mark the column unmapped." },
      { columnIndex: 2, sheetHeader: "", code: "blank_header", message: "This header is blank. Leave it unmapped. It is not a lead field." },
    ],
    preview: [
      { sheetHeader: "Full Name", value: "SYNTHETIC TEST" },
      { sheetHeader: "Phone Number", value: "SYNTHETIC" },
      { sheetHeader: "", value: "" },
    ],
    targets: [
      { header: "Client Name", sourceField: "full_name" },
      { header: "Phone", sourceField: "phone" },
      { header: "Email", sourceField: "email" },
    ],
    append: {
      behavior: "new_row_only",
      headerRow: "not_rewritten",
      existingRows: "not_rewritten",
      formulaColumns: "omitted_when_header_or_row2_starts_with_equals",
    },
  };
}

function mockActions(calls: string[], record: ColumnMapRecord): OnboardingWorkspaceActions {
  const target: SheetsTargetSave = {
    spreadsheetId: "sheet_existing_tab",
    worksheetId: 15,
    worksheetTitle: "VET Web Form",
    headerFingerprint: "abc123",
    schemaVersion: "company_sheets_campaign_v3",
    setupState: "incompatible",
    campaignDispatchEnabled: false,
    campaignDispatchNotBefore: "2026-10-27T14:43:39.233Z",
    headerRewritten: false,
    readinessEvidenceInvalidated: true,
  };
  return {
    searchDrive: async () => ({ ok: true, data: { saved: false, items: [], suggestions: [], nameMatch: "none", selectedFolderId: null, nextPageToken: null } }),
    resolveFolder: async () => ({ ok: false, error: "invalid_request", status: 400 }),
    listSpreadsheets: async () => ({
      ok: true,
      data: [{ spreadsheetId: "sheet_existing_tab", title: "Existing workbook", url: "https://docs.google.com/spreadsheets/d/sheet_existing_tab" }],
    }),
    previewSpreadsheet: async () => ({
      ok: true,
      data: {
        saved: false,
        spreadsheetId: "sheet_existing_tab",
        spreadsheetTitle: "Existing workbook",
        recommendation: null,
        selection: null,
        worksheets: [
          {
            worksheetId: 0,
            title: "Campaign Leads",
            grid: true,
            header: ["Date"],
            headerColumnCount: 35,
            historicalDataRows: "empty",
            classification: "v3_exact_header",
            fastPath: true,
            deliveryEligible: true,
            requiresExplicitSelection: true,
            reasons: [],
          },
          {
            worksheetId: 15,
            title: "VET Web Form",
            grid: true,
            header: ["Full Name", "Phone Number", ""],
            headerColumnCount: 3,
            historicalDataRows: "has_rows",
            historicalDataRowCount: 5,
            classification: "legacy_custom_required",
            fastPath: false,
            deliveryEligible: true,
            requiresExplicitSelection: true,
            reasons: ["legacy_custom_required"],
          },
        ],
      },
    }),
    saveDestination: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    loadWorkflows: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    saveWorkflow: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    previewNote: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    saveTestIdentity: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    previewStoredLead: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    deliverCapturedSheetsTest: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    recordActivationIntent: async () => ({ ok: false, error: "invalid_body", status: 400 }),
    saveSheetsTarget: async () => {
      calls.push("target");
      return { ok: true, data: target };
    },
    createColumnMap: async () => {
      calls.push("create");
      return { ok: true, data: record };
    },
    updateColumnMap: async (_mapId, input) => {
      calls.push("update");
      const phone = input.assignments.find((column) => column.sheetHeader === "Phone Number");
      assert.equal(phone?.decision, "unmapped");
      assert.equal(phone?.explicit, true);
      return {
        ok: true,
        data: {
          ...record,
          revision: 2,
          assignments: input.assignments,
          issues: [
            {
              columnIndex: 1,
              sheetHeader: "Phone Number",
              code: "required_field_unmapped",
              message: "Phone Number must be mapped before publish.",
            },
          ],
        },
      };
    },
    publishColumnMap: async () => {
      calls.push("publish");
      return { ok: true, data: { ...record, status: "published", revision: 3 } };
    },
  };
}
