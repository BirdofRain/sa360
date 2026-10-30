import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

import type { OnboardingSummary, OnboardingWorkspaceActions, StoredTestRunView } from "@/lib/clients/onboarding/types";
import { FOLDER_RESOLVED_NOT_LINKED, FULL_HISTORY_UNAVAILABLE, MISSING_PROFILE_REVISION_READ, SPREADSHEET_SAVED_CHOOSE_WORKSHEET, UNCERTAIN_OUTCOME_LABEL } from "@/lib/clients/onboarding/view";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

let SetupDeliveryWorkspace: typeof import("./setup-delivery-workspace.tsx").SetupDeliveryWorkspace;

test.before(async () => {
  ({ SetupDeliveryWorkspace } = await import("./setup-delivery-workspace.tsx"));
});

test.afterEach(() => cleanup());

const header = ["Date", "Client Name", "Phone"];

function summary(overrides: Partial<OnboardingSummary> = {}): OnboardingSummary {
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
    setupRequest: {
      present: true,
      status: "draft",
      revision: 1,
      destinationChoice: "both",
      operational: false,
    },
    sources: [
      {
        sourceKind: "leadcapture",
        sourceFunnelId: "funnel_alex",
        associationStatus: "confirmed",
        identity: {
          provider: "leadcapture_io",
          providerFunnelId: null,
          parentUrlKey: "go.example.com/alex",
          pageSlug: null,
        },
        proofs: {
          linked: { satisfied: true, at: "2026-10-26T14:00:00.000Z" },
          observed: {
            satisfied: true,
            at: "2026-10-26T15:00:00.000Z",
            sourceLeadEventId: "evt_alex",
            intakeStage: "routing_matched",
            captureOnly: false,
          },
          routingMatched: {
            satisfied: true,
            authority: "confirmed_source_association",
            routingDryRunDecisionId: "dry_alex",
            matchedRuleId: null,
            looseRuleIgnored: null,
          },
          delivery: { satisfied: false, sheetsJobId: null, ghlReceiptId: null },
        },
      },
      {
        sourceKind: "meta_lead_ads",
        sourceFunnelId: "fbpage:111:fbform:222",
        associationStatus: "confirmed",
        identity: {
          provider: "facebook",
          providerFunnelId: "fbpage:111:fbform:222",
          parentUrlKey: null,
          pageSlug: null,
        },
        proofs: {
          linked: { satisfied: true, at: "2026-10-26T14:00:00.000Z" },
          observed: {
            satisfied: true,
            at: "2026-10-26T15:30:00.000Z",
            sourceLeadEventId: "evt_fb",
            intakeStage: "captured",
            captureOnly: true,
          },
          routingMatched: {
            satisfied: false,
            authority: null,
            routingDryRunDecisionId: null,
            matchedRuleId: null,
            looseRuleIgnored: null,
          },
          delivery: { satisfied: false, sheetsJobId: null, ghlReceiptId: null },
        },
      },
    ],
    sheets: {
      destinationSaved: false,
      spreadsheetId: null,
      campaignTab: null,
      campaignDispatchEnabled: false,
      campaignDispatchNotBefore: null,
      agedDispatchEnabled: false,
      writeReadiness: "not_verified",
      deliveryExecution: "disabled",
      uncertainJob: false,
    },
    ghl: {
      mode: "location_api",
      locationIdPresent: true,
      workflowTriggerMode: "tag_trigger",
      workflowIdPresent: false,
      inboundWebhookArmed: false,
      notesEnabled: true,
      notesContractVersion: "sa360_lead_note_v2",
    },
    externalZapier: { preserved: true, replacedByNative: false },
    gates: [
      { id: "leadcapture_linked", required: true, satisfied: true, evidenceIds: ["funnel_alex"] },
      { id: "leadcapture_observed", required: true, satisfied: true, evidenceIds: ["evt_alex"] },
      { id: "leadcapture_routing_matched", required: true, satisfied: true, evidenceIds: ["dry_alex"] },
      { id: "meta_capture_only_acknowledged", required: true, satisfied: true, evidenceIds: [] },
      { id: "sheets_destination_saved", required: true, satisfied: false, evidenceIds: [] },
      { id: "sheets_permission_probe", required: true, satisfied: false, evidenceIds: [] },
      { id: "sheets_tab_explicitly_bound", required: true, satisfied: false, evidenceIds: [] },
      { id: "ghl_location_configured", required: true, satisfied: true, evidenceIds: [] },
      { id: "zapier_not_disabled", required: true, satisfied: true, evidenceIds: [] },
    ],
    liveActivationPerformedByOnboarding: false,
    blockers: ["sheets_destination_saved", "sheets_permission_probe", "sheets_tab_explicitly_bound"],
    ...overrides,
  };
}

const priorRun: StoredTestRunView = {
  id: "run_uncertain",
  kind: "captured_event_delivery",
  status: "uncertain",
  sourceLeadEventId: "evt_alex",
  attempts: [
    {
      id: "sheets_try",
      destination: "google_sheets",
      status: "uncertain",
      proves: [],
      doesNotProve: ["delivery"],
      externalCallExecuted: true,
      downstreamExecuted: false,
      detail: "append outcome unknown",
    },
    {
      id: "ghl_try",
      destination: "ghl_location_api",
      status: "failed",
      proves: ["http_accepted"],
      doesNotProve: ["note_persisted", "workflow_enrolled", "downstream_executed"],
      externalCallExecuted: true,
      downstreamExecuted: false,
      detail: "note was not stored",
    },
  ],
  sheet: {
    worksheetTitle: "Campaign Leads",
    worksheetRole: "campaign",
    schemaVersion: "company_sheets_campaign_v3",
    header: header,
    values: null,
    valuesSha256: "abc123",
    deliveryRowId: "onboarding-test:run_uncertain:sheets",
    sourceLeadEventId: "evt_alex",
  },
  noteContract: "sa360_lead_note_v2",
  resendAuthorized: false,
  reconcileObservation: "The sheet row was absent. That is not finality.",
};

function actions(): { api: OnboardingWorkspaceActions; calls: string[] } {
  const calls: string[] = [];
  const api: OnboardingWorkspaceActions = {
    searchDrive: async () => {
      calls.push("search");
      return {
        ok: true,
        data: {
          saved: false,
          nameMatch: "unique",
          selectedFolderId: null,
          companyFolder: null,
          nextPageToken: null,
          suggestions: [
            {
              id: "folder_alex",
              title: "Alex Gross",
              kind: "folder",
              trashed: false,
              shortcut: false,
              selectable: true,
              reason: null,
            },
          ],
          items: [
            {
              id: "sheet_alex",
              title: "Alex Gross Workbook",
              kind: "spreadsheet",
              trashed: false,
              shortcut: false,
              selectable: true,
              reason: null,
            },
          ],
        },
      };
    },
    resolveFolder: async () => {
      calls.push("resolve");
      return {
        ok: true,
        data: {
          saved: false,
          folder: { folderId: "folder_alex", title: "Alex Gross", driveId: "drive_1", basis: "approved_parent" },
        },
      };
    },
    listSpreadsheets: async () => {
      calls.push("browse");
      return {
        ok: true,
        data: [{ spreadsheetId: "sheet_alex", title: "Alex Gross Workbook", url: "https://docs.google.com/spreadsheets/d/sheet_alex" }],
      };
    },
    previewSpreadsheet: async () => {
      calls.push("preview-sheet");
      return {
        ok: true,
        data: {
          saved: false,
          spreadsheetId: "sheet_alex",
          spreadsheetTitle: "Alex Gross Workbook",
          recommendation: {
            worksheetId: 4,
            title: "Campaign Leads",
            classification: "v3_exact_header",
            fastPath: true,
            selected: false,
            bound: false,
            existingBinding: false,
            requiresExplicitSelection: true,
          },
          selection: null,
          worksheets: [
            {
              worksheetId: 1,
              title: "VET Web Form",
              grid: true,
              header: ["Legacy Date", "Name"],
              headerColumnCount: 15,
              historicalDataRows: "has_rows",
              historicalDataRowCount: 5,
              classification: "legacy_custom_required",
              fastPath: false,
              deliveryEligible: false,
              requiresExplicitSelection: false,
              reasons: ["legacy_custom_required"],
            },
            {
              worksheetId: 2,
              title: "Daily Stats",
              grid: true,
              header: ["Day"],
              headerColumnCount: 1,
              historicalDataRows: "has_rows",
              historicalDataRowCount: 3,
              classification: "stats_excluded",
              fastPath: false,
              deliveryEligible: false,
              requiresExplicitSelection: false,
              reasons: ["stats_excluded"],
            },
            {
              worksheetId: 3,
              title: "Weekly Stats",
              grid: true,
              header: ["Week"],
              headerColumnCount: 1,
              historicalDataRows: "empty",
              classification: "stats_excluded",
              fastPath: false,
              deliveryEligible: false,
              requiresExplicitSelection: false,
              reasons: ["stats_excluded"],
            },
            {
              worksheetId: 4,
              title: "Campaign Leads",
              grid: true,
              header,
              headerColumnCount: 35,
              historicalDataRows: "empty",
              classification: "v3_exact_header",
              fastPath: true,
              deliveryEligible: true,
              requiresExplicitSelection: true,
              reasons: [],
            },
          ],
        },
      };
    },
    saveSheetsDestination: async () => {
      calls.push("save-sheets");
      return {
        ok: true,
        data: {
          saved: true,
          bound: false,
          spreadsheetId: "sheet_alex",
          worksheetId: 4,
          worksheetTitle: "Campaign Leads",
        },
      };
    },
    bindCampaignWorksheet: async () => {
      calls.push("bind-sheet");
      return { ok: true, data: { saved: true, bound: true, worksheetId: 4, destinationRevision: 2 } };
    },
    saveDestination: async (input) => {
      calls.push(`save-destination:${input.expectedRevision}`);
      return {
        ok: true,
        data: {
          revision: 1,
          notesEnabled: true,
          notesContractVersion: "sa360_lead_note_v2",
          ghlMode: "location_api",
          sheetsSelected: true,
          deliveryEnabled: false,
          campaignDispatchEnabled: false,
          deliverySwitchChanged: false,
          liveActivationPerformedByOnboarding: false,
        },
      };
    },
    loadWorkflows: async () => {
      calls.push("workflows");
      return {
        ok: true,
        data: {
          workflowMatch: "unique",
          workflowId: "wf_tz",
          workflowName: "Select Time Zone",
          matches: [{ id: "wf_tz", name: "Select Time Zone" }],
          discoveryWired: true,
          createdWorkflow: false,
          createdCustomField: false,
          error: null,
        },
      };
    },
    saveWorkflow: async (input) => {
      calls.push(`save-workflow:${input.expectedRevision}`);
      return {
        ok: true,
        data: {
          persisted: true,
          workflowId: "wf_tz",
          workflowName: "Select Time Zone",
          deliveryEnabled: false,
          clientCutoverApproved: false,
          workflowTriggerMode: "direct_api",
          createdWorkflow: false,
          createdCustomField: false,
        },
      };
    },
    previewNote: async () => {
      calls.push("note");
      return {
        ok: true,
        data: {
          posted: false,
          contractVersion: "sa360_lead_note_v2",
          title: "SA360 lead",
          body: "SA360 lead\nEvent: evt_alex\n\nForm Questions and Answers\n1. Primary Reason: burial",
          status: "ready",
          keptAnswerCount: 1,
          qaEvidence: {
            status: "complete",
            fullQaCompletenessAsserted: true,
            discardedDuplicateCount: 0,
          },
          externalCalls: { ghl: false, providerWebhook: false, sheets: false },
        },
      };
    },
    saveTestIdentity: async (input) => {
      calls.push("identity");
      return { ok: true, data: { email: input.email, phoneE164: input.phoneE164, persisted: true } };
    },
    deliverCapturedSheetsTest: async () => ({ ok: false, error: "captured_test_disabled", status: 404 }),
    previewStoredLead: async () => {
      calls.push("replay");
      return {
        ok: true,
        data: {
          testRunId: "run_preview",
          status: "previewed",
          kind: "captured_event_replay",
          persisted: true,
          warningCodes: [],
          attempts: [
            {
              id: "preview_sheets",
              destination: "google_sheets",
              status: "previewed",
              proves: [],
              doesNotProve: ["delivery"],
              externalCallExecuted: false,
              downstreamExecuted: false,
              detail: null,
            },
            {
              id: "preview_ghl",
              destination: "ghl_location_api",
              status: "previewed",
              proves: [],
              doesNotProve: ["http_accepted", "note_persisted", "workflow_enrolled"],
              externalCallExecuted: false,
              downstreamExecuted: false,
              detail: null,
            },
          ],
          sheet: {
            worksheetTitle: "Campaign Leads",
            worksheetRole: "campaign",
            schemaVersion: "company_sheets_campaign_v3",
            header,
            values: null,
            valuesSha256: "hash_preview",
            deliveryRowId: null,
            sourceLeadEventId: "evt_alex",
          },
          noteBodySha256: "note_hash",
          noteContract: "sa360_lead_note_v2",
          externalCalls: { providerWebhook: false, sheets: false, ghl: false },
          sourceDeliverySatisfied: false,
          downstreamExecuted: false,
          resendAuthorized: false,
          appendStartedAtCleared: false,
          locksCleared: false,
        },
      };
    },
    recordActivationIntent: async () => {
      calls.push("intent");
      return {
        ok: true,
        data: {
          id: "intent_1",
          status: "blocked",
          activatesDelivery: false,
          liveActivationPerformedByOnboarding: false,
        },
      };
    },
  };
  return { api, calls };
}

test("Alex Gross mocked walkthrough keeps delivery and activation closed", async () => {
  const { api, calls } = actions();
  render(
    <SetupDeliveryWorkspace
      clientAccountId="alex_gross"
      summary={summary()}
      summaryError={null}
      connection={{
        status: "connected",
        connected: true,
        googleEmail: "sheets@lifeagentlaunch.test",
        googleDisplayName: "Life Agent Launch",
        connectedAt: "2026-10-26T12:00:00.000Z",
        liveDeliveryEnabled: false,
      }}
      connectionError={null}
      dispatch={{ dispatchFlagEnabled: false, campaignDispatchEnabled: false, agedDispatchEnabled: false }}
      dispatchError={null}
      initialRuns={[priorRun]}
      initialIdentity={{ email: "alex.gross.test@example.invalid", phoneE164: "+15555550111", persisted: true }}
      profileRevision={0}
      actions={api}
    />
  );

  assert.ok(screen.getByTestId("card-leadcapture"));
  assert.ok(screen.getByText("go.example.com/alex"));
  assert.ok(screen.getByText(/Latest observed lead evt_alex/));
  assert.ok(screen.getByText("fbpage:111:fbform:222"));
  assert.ok(screen.getByText(/Capture only/));
  assert.equal(screen.getAllByText("Routing verified").length >= 1, true);
  assert.ok(screen.getByText(/sheets@lifeagentlaunch\.test/));
  assert.ok(screen.getByText(UNCERTAIN_OUTCOME_LABEL));
  assert.equal((screen.getByTestId("test-delivery-again") as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByTestId("activate-delivery") as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("Sheets permission tested"));
  assert.ok(screen.getByText(/External Zapier stays in place/));

  fireEvent.click(screen.getByRole("button", { name: "Browse company folder" }));
  assert.ok(await screen.findByText(/Alex Gross · folder/));
  fireEvent.change(screen.getByLabelText("Paste a Google Drive folder URL"), {
    target: { value: "https://drive.google.com/drive/folders/folder_alex" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Resolve folder" }));
  assert.ok(await screen.findByText(FOLDER_RESOLVED_NOT_LINKED));
  assert.ok(screen.getByText(/Linked: no/));
  fireEvent.click(screen.getByRole("button", { name: "Browse linked folder" }));
  assert.ok(await screen.findByText("Alex Gross Workbook"));
  fireEvent.click(screen.getByRole("button", { name: "Preview worksheets" }));
  assert.ok(await screen.findByText(/Recommended: Campaign Leads/));
  assert.ok(screen.getByText(/Historical rows preserved \(5\)/));
  assert.equal(screen.getAllByText("Preserved. Not a delivery target.").length, 2);
  const campaign = screen.getByRole("heading", { name: "Google Sheets" }).closest("section");
  const campaignRow = within(campaign as HTMLElement).getByText("Campaign Leads").closest("li");
  fireEvent.click(within(campaignRow as HTMLElement).getByRole("button", { name: "View worksheet" }));
  assert.ok(screen.getByText(/Schema: company_sheets_campaign_v3/));
  fireEvent.click(within(campaignRow as HTMLElement).getByRole("button", { name: "Choose this worksheet" }));
  assert.ok(screen.getAllByText(/Saved destination: no/).length >= 1);
  assert.ok(screen.getAllByText(/Bound: no/).length >= 1);
  assert.equal(calls.includes("save-sheets"), false);
  assert.equal(calls.includes("bind-sheet"), false);
  assert.equal(calls.includes("resolve") && calls.includes("preview-sheet"), true);

  fireEvent.click(screen.getByRole("button", { name: "Discover Select Time Zone" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save Select Time Zone" }));
  assert.ok(await screen.findByText(/Delivery enabled: false/));
  assert.equal(calls.includes("save-workflow:0"), true);

  fireEvent.click(screen.getByRole("button", { name: "Preview stored lead" }));
  assert.ok(await screen.findByText(/Q&A evidence complete/));
  assert.ok(screen.getByText(/Primary Reason: burial/));
  assert.ok(screen.getByText(/Mapped row cells are not in the captured-test preview payload/));
  assert.ok(screen.getAllByText(/google_sheets · previewed/).length >= 1);
  assert.ok(screen.getAllByText(/ghl_location_api · previewed/).length >= 1);
  assert.ok(screen.getByText(/alex\.gross\.test@example\.invalid/));
  assert.equal(calls.includes("replay"), true);
  assert.equal(calls.includes("note"), true);
  assert.ok(screen.getByTestId("full-history-unavailable").textContent?.includes(FULL_HISTORY_UNAVAILABLE));
  assert.equal(calls.some((call) => call.includes("activate") || call.includes("deliver")), false);
});

test("an existing client keeps the current switch and does not treat a linked source as receiving leads", () => {
  const existing = summary({
    client: {
      clientAccountId: "existing_client",
      clientDisplayName: "Existing Client",
      status: "active",
      primaryNicheKeys: ["vet"],
      primaryProductTypes: [],
    },
    sources: [
      {
        sourceKind: "leadcapture",
        sourceFunnelId: "funnel_existing",
        associationStatus: "confirmed",
        identity: {
          provider: "leadcapture_io",
          providerFunnelId: "form_existing",
          parentUrlKey: null,
          pageSlug: null,
        },
        proofs: {
          linked: { satisfied: true, at: "2026-09-01T00:00:00.000Z" },
          observed: {
            satisfied: false,
            at: null,
            sourceLeadEventId: null,
            intakeStage: null,
            captureOnly: false,
          },
          routingMatched: {
            satisfied: false,
            authority: null,
            routingDryRunDecisionId: null,
            matchedRuleId: null,
            looseRuleIgnored: null,
          },
          delivery: { satisfied: true, sheetsJobId: "job_existing", ghlReceiptId: null },
        },
      },
    ],
    sheets: {
      destinationSaved: true,
      spreadsheetId: "sheet_existing",
      campaignTab: "Campaign Leads",
      campaignDispatchEnabled: true,
      campaignDispatchNotBefore: "2026-09-01T00:00:00.000Z",
      agedDispatchEnabled: false,
      writeReadiness: "not_verified",
      deliveryExecution: "disabled",
      uncertainJob: false,
    },
    gates: [
      { id: "sheets_destination_saved", required: true, satisfied: true, evidenceIds: [] },
      { id: "sheets_tab_explicitly_bound", required: true, satisfied: true, evidenceIds: [] },
      { id: "sheets_permission_probe", required: true, satisfied: false, evidenceIds: [] },
    ],
    blockers: ["sheets_permission_probe"],
  });
  render(
    <SetupDeliveryWorkspace
      clientAccountId="existing_client"
      summary={existing}
      summaryError={null}
      connection={null}
      connectionError={null}
      dispatch={{ dispatchFlagEnabled: true, campaignDispatchEnabled: true, agedDispatchEnabled: false }}
      dispatchError={null}
      actions={actions().api}
    />
  );

  assert.ok(screen.getByText("Existing Client"));
  assert.equal(screen.queryByText("Delivery and activation stay off."), null);
  assert.equal(screen.queryByText(/Delivery stays off/), null);
  assert.ok(screen.getByText(/Client campaign switch: yes/));
  assert.ok(screen.getByText(/Aged dispatch: no/));
  assert.ok(screen.getByText(/Global infrastructure: yes/));
  assert.equal((screen.getByTestId("save-spreadsheet-destination") as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByTestId("bind-selected-worksheet") as HTMLButtonElement).disabled, true);
  assert.match(
    screen.getByRole("link", { name: "Open the existing Google Sheets setup" }).getAttribute("href") ?? "",
    /\/clients\/existing_client\/google-sheets$/
  );
  assert.ok(screen.getByText("form_existing"));
  assert.ok(screen.getByText("Linked does not mean this source is receiving leads."));
  assert.ok(screen.getAllByText("sheet_existing").length >= 1);
  assert.ok(screen.getByText(/This workspace does not change the client switch/));
  assert.equal((screen.getByTestId("activate-delivery") as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("Sheets permission tested"));
  const permission = screen.getByText("Permission tested").closest("[data-status='Permission tested']");
  assert.equal(permission?.getAttribute("data-state"), "no");
  const delivery = screen.getByText("Delivery active").closest("[data-status='Delivery active']");
  assert.equal(delivery?.getAttribute("data-state"), "yes");
});

test("a known nonzero profile revision is sent, and a conflict keeps the selection", async () => {
  const { api, calls } = actions();
  api.saveWorkflow = async (input) => {
    calls.push(`save-workflow:${input.expectedRevision}`);
    return { ok: false, error: "revision_conflict", status: 409 };
  };
  api.saveDestination = async (input) => {
    calls.push(`save-destination:${input.expectedRevision}:${input.sheetsSelected}`);
    return { ok: false, error: "revision_conflict", status: 409 };
  };
  render(
    <SetupDeliveryWorkspace
      clientAccountId="alex_gross"
      summary={summary()}
      summaryError={null}
      connection={null}
      connectionError={null}
      dispatch={{ dispatchFlagEnabled: false, campaignDispatchEnabled: false, agedDispatchEnabled: false }}
      dispatchError={null}
      profileRevision={4}
      actions={api}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Discover Select Time Zone" }));
  fireEvent.click(await screen.findByRole("button", { name: "Save Select Time Zone" }));
  assert.ok(await screen.findByTestId("revision-conflict"));
  assert.ok(screen.getByRole("link", { name: "Review stored configuration" }));
  const workflowSave = screen.getByRole("button", { name: "Save Select Time Zone" }) as HTMLButtonElement;
  assert.equal(workflowSave.disabled, true);
  fireEvent.click(workflowSave);
  assert.deepEqual(calls.filter((call) => call.startsWith("save-workflow")), ["save-workflow:4"]);
  const sheets = screen.getByRole("checkbox", { name: "Sheets selected" }) as HTMLInputElement;
  fireEvent.click(sheets);
  fireEvent.click(screen.getByRole("button", { name: "Save destination profile" }));
  assert.ok(await screen.findByTestId("destination-revision-conflict"));
  assert.equal(sheets.checked, true);
  assert.deepEqual(calls.filter((call) => call.startsWith("save-destination")), ["save-destination:4:true"]);
});

test("a missing profile revision leaves Select Time Zone unsaved", async () => {
  const { api, calls } = actions();
  render(
    <SetupDeliveryWorkspace
      clientAccountId="alex_gross"
      summary={summary()}
      summaryError={null}
      connection={null}
      connectionError={null}
      dispatch={null}
      dispatchError={null}
      actions={api}
    />
  );
  assert.ok(screen.getByText(/Client campaign switch: no/));
  assert.ok(screen.getByText(/Global infrastructure: unknown/));
  fireEvent.click(screen.getByRole("button", { name: "Discover Select Time Zone" }));
  const save = await screen.findByRole("button", { name: "Save Select Time Zone" });
  assert.equal((save as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByTestId("profile-revision-unavailable").textContent?.includes(MISSING_PROFILE_REVISION_READ));
  assert.equal((screen.getByRole("button", { name: "Save destination profile" }) as HTMLButtonElement).disabled, true);
  fireEvent.click(save);
  assert.equal(calls.some((call) => call.startsWith("save-workflow")), false);
});

test("selecting Sheets shows a valid custom map as a prerequisite and keeps the receipt as evidence", () => {
  const loaded = summary({
    sheets: {
      destinationSaved: true,
      spreadsheetId: "sheet_custom",
      campaignTab: "VET Web Form",
      campaignDispatchEnabled: false,
      campaignDispatchNotBefore: "2026-10-27T14:43:39.233Z",
      agedDispatchEnabled: false,
      writeReadiness: "verified",
      deliveryExecution: "disabled",
      uncertainJob: false,
    },
    destinationProfile: {
      present: true,
      revision: 3,
      sheetsSelected: true,
      ghlMode: "unset",
      notesEnabled: false,
    },
    gates: [
      { id: "sheets_destination_saved", required: true, satisfied: true, evidenceIds: ["dest"] },
      { id: "sheets_header_dispatch_ready", required: true, satisfied: true, evidenceIds: ["tab"] },
      { id: "sheets_custom_map_published", required: true, satisfied: true, evidenceIds: ["map"] },
      { id: "sheets_permission_probe", required: true, satisfied: true, evidenceIds: ["dest"] },
      { id: "sheets_writer_receipt", role: "evidence", required: false, satisfied: false, evidenceIds: [] },
    ],
    blockers: [],
  });
  const { api } = actions();
  render(
    <SetupDeliveryWorkspace
      clientAccountId="alex_gross"
      summary={loaded}
      summaryError={null}
      connection={null}
      connectionError={null}
      dispatch={{ dispatchFlagEnabled: false, campaignDispatchEnabled: false, agedDispatchEnabled: false }}
      dispatchError={null}
      profileRevision={3}
      actions={api}
    />
  );
  const prerequisites = screen.getByTestId("sheets-selection-prerequisites");
  assert.match(prerequisites.textContent ?? "", /Custom column map published · required yes · satisfied yes/);
  assert.equal((prerequisites.textContent ?? "").includes("Sheets writer receipt"), false);
  const evidence = screen.getByRole("heading", { name: "Post-activation evidence" }).parentElement;
  assert.match(evidence?.textContent ?? "", /Sheets writer receipt · satisfied no/);
  assert.match(evidence?.textContent ?? "", /does not block first activation/);
  const missing = screen.getByRole("heading", { name: "Missing prerequisites and blockers" }).parentElement;
  assert.equal((missing?.textContent ?? "").includes("Sheets writer receipt"), false);
});

test("an allowed sheet save stays unbound until the operator binds that worksheet", async () => {
  const { api, calls } = actions();
  render(
    <SetupDeliveryWorkspace
      clientAccountId="alex_gross"
      summary={summary()}
      summaryError={null}
      connection={null}
      connectionError={null}
      dispatch={{ dispatchFlagEnabled: false, campaignDispatchEnabled: false, agedDispatchEnabled: false }}
      dispatchError={null}
      actions={api}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Browse linked folder" }));
  assert.ok(await screen.findByText("Alex Gross Workbook"));
  fireEvent.click(screen.getByRole("button", { name: "Preview worksheets" }));
  assert.ok(await screen.findByText(/Recommended: Campaign Leads/));
  const campaign = screen.getByRole("heading", { name: "Google Sheets" }).closest("section");
  const campaignRow = within(campaign as HTMLElement).getByText("Campaign Leads").closest("li");
  fireEvent.click(within(campaignRow as HTMLElement).getByRole("button", { name: "Choose this worksheet" }));
  assert.equal(calls.includes("save-sheets"), false);
  fireEvent.click(screen.getByTestId("save-spreadsheet-destination"));
  assert.ok((await screen.findAllByText(/Saved destination: yes/)).length >= 1);
  assert.ok(screen.getAllByText(/Bound: no/).length >= 1);
  assert.equal(calls.includes("bind-sheet"), false);
  fireEvent.click(screen.getByTestId("bind-selected-worksheet"));
  assert.ok((await screen.findAllByText(/Bound: yes/)).length >= 1);
  assert.deepEqual(
    calls.filter((call) => call === "save-sheets" || call === "bind-sheet"),
    ["save-sheets", "bind-sheet"]
  );
});

test("a pasted stored lead previews all mapped cells and the captured test reports effects", async () => {
  const { TestConsole } = await import("./test-console.tsx");
  const headers = [
    "Date",
    "Lead Type",
    "Client Name",
    "Phone",
    "Email",
    "State",
    "Age/ DOB",
    "Military Status",
    "Branch of Service",
    "Marital Status",
    "Desired Coverage",
    "Primary Concern",
    "Beneficiary",
    "Time to Call",
    "Notes",
  ];
  const values = [
    "10/28/2026, 21:32:34 EDT America/New_York",
    "",
    "Sample Lead",
    "5550100199",
    "sample.lead@example.invalid",
    "TX",
    "04/02/1990",
    "Veteran",
    "Army",
    "Married",
    "250000",
    "Burial",
    "Spouse",
    "Morning",
    "",
  ];
  const { api } = actions();
  let delivered = "";
  api.previewStoredLead = async () => ({
    ok: true,
    data: {
      testRunId: "run_cells",
      status: "previewed",
      kind: "captured_event_replay",
      persisted: true,
      warningCodes: ["primary_concern_filled_from_primary_reason"],
      attempts: [],
      sheet: {
        worksheetTitle: "VET Web Form",
        worksheetRole: "campaign",
        schemaVersion: "company_sheets_campaign_custom_v1",
        header: headers,
        values,
        valuesSha256: "hash_cells",
        deliveryRowId: "captured-event-test:alex_gross:evt_pasted",
        sourceLeadEventId: "evt_pasted",
      },
      noteBodySha256: null,
      noteContract: null,
      externalCalls: { providerWebhook: false, sheets: false, ghl: false },
      effects: null,
      sourceDeliverySatisfied: false,
      downstreamExecuted: false,
      resendAuthorized: false,
      appendStartedAtCleared: false,
      locksCleared: false,
    },
  });
  api.deliverCapturedSheetsTest = async (input) => {
    delivered = input.sourceLeadEventId;
    return {
      ok: true,
      data: {
        testRunId: "run_deliver",
        status: "succeeded",
        kind: "captured_event_delivery",
        persisted: true,
        warningCodes: [],
        attempts: [],
        sheet: {
          worksheetTitle: "VET Web Form",
          worksheetRole: "campaign",
          schemaVersion: "company_sheets_campaign_custom_v1",
          header: headers,
          values,
          valuesSha256: "hash_cells",
          deliveryRowId: "captured-event-test:alex_gross:evt_pasted",
          sourceLeadEventId: "evt_pasted",
        },
        noteBodySha256: null,
        noteContract: null,
        externalCalls: { providerWebhook: false, sheets: true, ghl: false },
        effects: {
          inventoryAffected: false,
          billingAffected: false,
          deliveryEnabled: false,
          cutoffChanged: false,
          duplicate: false,
        },
        sourceDeliverySatisfied: false,
        downstreamExecuted: false,
        resendAuthorized: false,
        appendStartedAtCleared: false,
        locksCleared: false,
      },
    };
  };
  render(
    <TestConsole
      leads={[]}
      proofLoaded
      actions={api}
      initialRuns={[]}
      initialIdentity={null}
      viewedWorksheet={null}
      onAttempts={() => undefined}
    />
  );
  fireEvent.change(screen.getByLabelText("Stored lead event"), { target: { value: "evt_pasted" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview stored lead" }));
  assert.ok(await screen.findByTestId("mapped-row-table"));
  assert.equal(screen.getAllByRole("row").length, 16);
  assert.ok(screen.getByText("04/02/1990"));
  assert.ok(screen.getByText("Burial"));
  assert.ok(screen.getAllByText("blank").length >= 2);
  assert.ok(screen.getByText(/Primary Concern was filled from primary_reason/));
  fireEvent.click(screen.getByTestId("deliver-captured-sheets-test"));
  assert.ok(await screen.findByText("Inventory affected: no"));
  assert.ok(screen.getByText("Billing affected: no"));
  assert.ok(screen.getByText("Ongoing delivery enabled: no"));
  assert.ok(screen.getByText("Cutoff changed: no"));
  assert.ok(screen.getByText("Duplicate: no"));
  assert.equal(delivered, "evt_pasted");
  assert.equal((screen.getByTestId("test-delivery-again") as HTMLButtonElement).disabled, true);
});

test("blank browse can select one of two same-named folders without pasting a URL", async () => {
  const { api, calls } = actions();
  let queried = "unset";
  api.searchDrive = async (input) => {
    queried = input.query;
    calls.push(`search:${input.query}`);
    return {
      ok: true,
      data: {
        saved: false,
        nameMatch: "none",
        selectedFolderId: null,
        companyFolder: { folderId: "approvedParent1", title: "Client Folders" },
        nextPageToken: null,
        suggestions: [
          {
            id: "hint_folder",
            title: "Matt Mandeville",
            kind: "folder",
            trashed: false,
            shortcut: false,
            selectable: true,
            reason: null,
            location: "Client Folders / Matt Mandeville · hint_folder",
          },
        ],
        items: [
          {
            id: "folder_a",
            title: "Matthew Mandeville",
            kind: "folder",
            trashed: false,
            shortcut: false,
            selectable: true,
            reason: null,
            location: "Client Folders / Matthew Mandeville · folder_a",
          },
          {
            id: "folder_b",
            title: "Matthew Mandeville",
            kind: "folder",
            trashed: false,
            shortcut: false,
            selectable: true,
            reason: null,
            location: "Client Folders / Matthew Mandeville · folder_b",
          },
        ],
      },
    };
  };
  api.linkClientFolder = async (folderId) => {
    calls.push(`link:${folderId}`);
    return {
      ok: true,
      data: {
        folderId,
        title: "Matthew Mandeville",
        spreadsheets: [{ spreadsheetId: "sheet_matt", title: "Copy of Matt", url: "https://docs.google.com/spreadsheets/d/sheet_matt" }],
      },
    };
  };
  render(
    <SetupDeliveryWorkspace
      clientAccountId="matt_mandeville"
      summary={summary({
        client: {
          clientAccountId: "matt_mandeville",
          clientDisplayName: "Matt Mandeville",
          status: "active",
          primaryNicheKeys: ["vet"],
          primaryProductTypes: [],
        },
      })}
      summaryError={null}
      connection={{
        status: "connected",
        connected: true,
        googleEmail: "sheets@lifeagentlaunch.test",
        googleDisplayName: "Life Agent Launch",
        connectedAt: null,
        liveDeliveryEnabled: false,
        destinationFolder: { folderId: "approvedParent1", title: "Client Folders" },
      }}
      connectionError={null}
      dispatch={{ dispatchFlagEnabled: false, campaignDispatchEnabled: false, agedDispatchEnabled: false }}
      dispatchError={null}
      actions={api}
    />
  );
  assert.equal((screen.getByLabelText("Filter by name") as HTMLInputElement).value, "");
  fireEvent.click(screen.getByRole("button", { name: "Browse company folder" }));
  assert.equal(queried, "");
  assert.ok(await screen.findByText(/Company folder: Client Folders/));
  const useA = screen.getByRole("button", { name: "Use this folder Matthew Mandeville Client Folders / Matthew Mandeville · folder_a" });
  const useB = screen.getByRole("button", { name: "Use this folder Matthew Mandeville Client Folders / Matthew Mandeville · folder_b" });
  assert.equal(useA === useB, false);
  fireEvent.click(useA);
  assert.ok(await screen.findByText(/Saved folder Matthew Mandeville/));
  assert.ok(screen.getByText("Copy of Matt"));
  assert.equal(calls.includes("link:folder_a"), true);
  assert.equal(calls.includes("link:folder_b"), false);
  assert.equal(calls.includes("save-sheets"), false);
});

test("a saved spreadsheet without a bound worksheet stays visible when the picker is empty", () => {
  const spreadsheetId = "1OUOfsYPsPzI9uFIJ_tERWAJcVk8Mg5mBtUOiVaoh-9Y";
  const loaded = summary({
    sheets: {
      destinationSaved: true,
      spreadsheetId,
      spreadsheetTitle: "Copy of Matt",
      campaignTab: null,
      campaignDispatchEnabled: false,
      campaignDispatchNotBefore: null,
      agedDispatchEnabled: false,
      writeReadiness: "not_verified",
      deliveryExecution: "disabled",
      uncertainJob: false,
    },
    gates: [{ id: "sheets_destination_saved", required: true, satisfied: true, evidenceIds: ["dest"] }],
  });
  render(
    <SetupDeliveryWorkspace
      clientAccountId="matt_mandeville"
      summary={loaded}
      summaryError={null}
      connection={null}
      connectionError={null}
      dispatch={{ dispatchFlagEnabled: false, campaignDispatchEnabled: false, agedDispatchEnabled: false }}
      dispatchError={null}
      sheetsSetup={{
        folderLoaded: true,
        folder: {
          folderId: "1357Wlh4B3dFCZ-7KXpY9S6As4qoMjHhm",
          title: "Matthew Mandeville",
          url: "https://drive.google.com/drive/folders/1357Wlh4B3dFCZ-7KXpY9S6As4qoMjHhm",
        },
        destinationLoaded: true,
        spreadsheetTitle: "Copy of Matt",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        campaignBound: false,
        campaignWorksheetTitle: null,
        writeReadiness: "not_verified",
      }}
      actions={actions().api}
    />
  );
  const card = screen.getByTestId("card-google-sheets");
  assert.equal(card.className.includes("overflow-hidden"), true);
  assert.ok(within(card).getAllByText(SPREADSHEET_SAVED_CHOOSE_WORKSHEET).length >= 1);
  assert.ok(within(card).getByRole("link", { name: "Copy of Matt" }));
  const id = within(card).getByText(spreadsheetId);
  assert.equal(id.className.includes("break-all"), true);
  assert.equal(card.contains(id), true);
  assert.equal(within(card).queryByText(/Saved destination: no/), null);
  assert.match(card.textContent ?? "", /Saved folder Matthew Mandeville/);
});
