import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

import type { SelectableLead } from "@/lib/clients/onboarding/view";
import type { GhlLocationConfigDiscoveryResponse, RoutingRuleGhlConfigSaveBody } from "@/lib/ghl-config/types";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "@/lib/ghl-live-canary/types";

import { GhlWalkthroughPanel } from "./ghl-walkthrough-panel";
import type {
  GhlWalkthroughActions,
  GhlWalkthroughConnection,
  GhlWalkthroughLocation,
  GhlWalkthroughPreflight,
} from "./ghl-walkthrough-types";

const WORKFLOW_ID = "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd";
const OTHER_WORKFLOW_ID = "11111111-1111-4111-8111-111111111111";

test.before(() => {
  if (!("ResizeObserver" in globalThis)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
  }
});

test.afterEach(() => cleanup());

function location(overrides: Partial<GhlWalkthroughLocation> = {}): GhlWalkthroughLocation {
  return {
    locationId: "loc_sam",
    locationName: "Sam's Test",
    workflowId: null,
    workflowTriggerMode: null,
    deliveryEnabled: false,
    opportunityCreationEnabled: true,
    pipelineId: "pipe_1",
    stageId: "stage_1",
    ...overrides,
  };
}

function connection(overrides: Partial<GhlWalkthroughConnection> = {}): GhlWalkthroughConnection {
  return {
    id: "conn_sam",
    locationId: "loc_sam",
    locationName: "Sam's Test",
    clientAccountId: "client_sam",
    connectionStatus: "connected",
    ...overrides,
  };
}

function lead(overrides: Partial<SelectableLead> = {}): SelectableLead {
  return {
    sourceLeadEventId: "evt_dummy",
    sourceKind: "leadcapture",
    at: "2026-10-29T14:00:00.000Z",
    captureOnly: false,
    identity: "go.example.com/sam",
    routingDryRunDecisionId: "dry_dummy",
    ...overrides,
  };
}

function discovery(): GhlLocationConfigDiscoveryResponse {
  return {
    ok: true,
    location: { id: "loc_sam", name: "Sam's Test", companyId: null, timezone: "America/New_York" },
    pipelines: [],
    workflows: [
      { id: OTHER_WORKFLOW_ID, name: "select time zone", status: "published", type: null },
      { id: WORKFLOW_ID, name: "New Lead", status: "published", type: null },
    ],
    users: [],
    customFields: [],
    tags: [],
    fetchedAt: "2026-10-29T14:00:00.000Z",
    fromCache: false,
    warnings: [],
    errors: [],
    requiredFields: { requiredFieldsInstalled: false, missingRequiredFields: [], foundRequiredFields: [] },
    sa360FieldMapping: {
      discoveredMap: { email: "field_email" },
      coreRequiredMapped: ["email", "phone"],
      coreRequiredMissing: ["state"],
      optionalMapped: [],
      optionalMissing: ["beneficiary"],
      coreRequiredComplete: false,
    },
  };
}

function preflight(overrides: Partial<GhlWalkthroughPreflight> = {}): GhlWalkthroughPreflight {
  return {
    canExecute: true,
    blockers: [],
    duplicateRiskLevel: "none",
    duplicateBlocksLive: false,
    lastLiveRunStatus: null,
    ...overrides,
  };
}

function actions(overrides: Partial<GhlWalkthroughActions> = {}): GhlWalkthroughActions {
  return {
    loadConnections: async () => ({ ok: true, items: [connection()] }),
    linkLocation: async () => ({ ok: true }),
    startConnect: async () => ({ ok: true, authorizeUrl: "https://example.test/connect" }),
    discover: async () => ({ ok: true, discovery: discovery() }),
    saveFieldMap: async () => ({ ok: true, deliveryEnabled: false }),
    saveNotes: async () => ({ ok: true, deliveryEnabled: false, sourceEnrichmentPolicyJson: { intakeSummaryNotesEnabled: false } }),
    previewIntakeNote: async () => ({ ok: true, contractVersion: "sa360_lead_note_v2", body: "SA360 lead", posted: false }),
    loadLeadAttributes: async () => ({ ok: true, sourceAttributes: {} }),
    saveWorkflow: async () => ({
      ok: true,
      deliveryEnabled: false,
      workflowTriggerMode: "direct_api",
      workflowId: WORKFLOW_ID,
    }),
    previewDelivery: async () => ({
      ok: true,
      preview: {
        planId: "plan_1",
        runId: "run_sim_1",
        fieldMapping: null,
        deliveryEnabled: false,
        steps: [
          {
            stepType: "create_or_update_contact",
            status: "simulated",
            targetId: null,
            title: "Contact",
            requestPreviewJson: { path: "/contacts/upsert" },
            validationErrors: [],
            warnings: [],
          },
          {
            stepType: "stamp_custom_fields",
            status: "simulated",
            targetId: null,
            title: "Fields",
            requestPreviewJson: { customFields: { dob: null } },
            validationErrors: [],
            warnings: [],
          },
          {
            stepType: "start_workflow",
            status: "simulated",
            targetId: WORKFLOW_ID,
            title: "Workflow",
            requestPreviewJson: { workflowId: WORKFLOW_ID },
            validationErrors: [],
            warnings: [],
          },
          {
            stepType: "create_or_update_opportunity",
            status: "failed_validation",
            targetId: null,
            title: "Opportunity",
            requestPreviewJson: null,
            validationErrors: ["Pipeline/stage not configured."],
            warnings: [],
          },
        ],
      },
    }),
    loadPreflight: async () => ({ ok: true, preflight: preflight() }),
    executeTest: async () => ({
      ok: true,
      result: {
        status: "succeeded",
        contactIdGhl: "contact_1",
        opportunityIdGhl: null,
        workflowStarted: true,
        externalCallExecuted: true,
        errors: [],
        skippedDuplicate: false,
      },
    }),
    activateOngoing: async () => ({
      ok: true,
      alreadyActive: false,
      omittedCoreFields: ["state"],
      omittedOptionalFields: ["beneficiary"],
    }),
    ...overrides,
  };
}

function chooseGhlField(canonical: string, query: string) {
  fireEvent.click(screen.getByRole("combobox", { name: `GHL field for ${canonical}` }));
  const input = screen.getByRole("combobox", { name: `Search GHL fields for ${canonical}` });
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByRole("option", { name: new RegExp(query, "i") }));
}

function markState(container: HTMLElement, label: string): string | null {
  return container.querySelector(`[data-status="${label}"]`)?.getAttribute("data-state") ?? null;
}

function line(container: HTMLElement, label: string): string {
  const node = [...container.querySelectorAll("p")].find((item) => (item.textContent ?? "").includes(label));
  return node?.textContent ?? "";
}

test("the workflow proposal stays separate from the saved mode until it is selected and saved", async () => {
  const seen: { body: RoutingRuleGhlConfigSaveBody | null } = { body: null };
  render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location({
        workflowTriggerMode: "tag_trigger",
        vetWorkflowTriggerProposal: {
          proposedMode: "direct_api",
          storedMode: "tag_trigger",
          changesExistingClients: false,
        },
      })}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        saveWorkflow: async (body) => {
          seen.body = body;
          return {
            ok: true,
            deliveryEnabled: false,
            workflowTriggerMode: body.workflowTriggerMode ?? null,
            workflowId: body.destinationWorkflowIdGhl ?? null,
          };
        },
      })}
    />
  );
  const proposal = screen.getByTestId("ghl-workflow-proposal");
  assert.match(proposal.textContent ?? "", /Proposed mode/);
  assert.match(proposal.textContent ?? "", /direct_api/);
  assert.match(proposal.textContent ?? "", /tag_trigger/);
  assert.match(proposal.textContent ?? "", /does not prove the workflow enrolled/);
  assert.match(proposal.textContent ?? "", /cannot guarantee those triggers are absent/);
  fireEvent.click(screen.getByRole("button", { name: "Discover workflows" }));
  await screen.findByLabelText("Trigger mode");
  assert.equal((screen.getByLabelText("Trigger mode") as HTMLSelectElement).value, "tag_trigger");
  assert.equal(seen.body, null);
  fireEvent.click(screen.getByRole("button", { name: "Select proposed direct_api" }));
  assert.equal((screen.getByLabelText("Trigger mode") as HTMLSelectElement).value, "direct_api");
  assert.equal(seen.body, null);
  fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: WORKFLOW_ID } });
  fireEvent.click(screen.getByRole("button", { name: "Save selected workflow" }));
  await waitFor(() => assert.equal(seen.body?.workflowTriggerMode, "direct_api"));
  assert.equal("deliveryEnabled" in (seen.body ?? {}), false);
});

test("notes save keeps unrelated policy settings and does not send a lead", async () => {
  const seen: { policy: Record<string, unknown> | null } = { policy: null };
  let previewCalls = 0;
  render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location({
        sourceEnrichmentPolicyJson: {
          aiContextRequired: ["branch_of_service"],
          limitedAutomationBehavior: "queue_for_review",
          intakeSummaryNotesEnabled: false,
        },
      })}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        saveNotes: async (input) => {
          seen.policy = input.sourceEnrichmentPolicyJson;
          return { ok: true, deliveryEnabled: false, sourceEnrichmentPolicyJson: input.sourceEnrichmentPolicyJson };
        },
        previewIntakeNote: async () => {
          previewCalls += 1;
          return { ok: true, contractVersion: "sa360_lead_note_v2", body: "SA360 lead\nFamily", posted: false };
        },
      })}
    />
  );
  const box = screen.getByRole("checkbox", { name: "Enable intake-summary notes" }) as HTMLInputElement;
  assert.equal(box.checked, false);
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Save notes setting" }));
  await waitFor(() => assert.equal(seen.policy?.intakeSummaryNotesEnabled, true));
  assert.deepEqual(seen.policy?.aiContextRequired, ["branch_of_service"]);
  assert.equal(seen.policy?.limitedAutomationBehavior, "queue_for_review");
  fireEvent.click(screen.getByRole("button", { name: "Preview intake-summary note" }));
  const preview = await screen.findByTestId("ghl-note-preview");
  assert.match(preview.textContent ?? "", /sa360_lead_note_v2/);
  assert.match(preview.textContent ?? "", /Posted: no/);
  assert.equal(previewCalls, 1);
  assert.match(screen.getByTestId("ghl-contact-only-gap").textContent ?? "", /mode none is not a contact-only test/);
});

test("an ambiguous note result is shown apart from contact and workflow and is not retried", async () => {
  render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location({ workflowId: WORKFLOW_ID, workflowTriggerMode: "direct_api" })}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        executeTest: async () => ({
          ok: true,
          result: {
            status: "partial_success",
            contactIdGhl: "contact_1",
            opportunityIdGhl: null,
            workflowStarted: true,
            externalCallExecuted: true,
            errors: [],
            skippedDuplicate: false,
            contactResult: "upserted",
            noteResult: "ambiguous",
            workflowResult: "enrolled",
          },
        }),
      })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview GHL delivery" }));
  await screen.findByTestId("ghl-delivery-preview");
  fireEvent.click(screen.getByRole("button", { name: "Run one GHL test" }));
  fireEvent.change(screen.getByLabelText("GHL test confirmation"), { target: { value: LIVE_CANARY_CONFIRMATION_TEXT } });
  fireEvent.click(screen.getByRole("button", { name: "Execute one GHL test" }));
  const result = await screen.findByTestId("ghl-test-result");
  assert.match(result.textContent ?? "", /Contact upsert was accepted/);
  assert.match(result.textContent ?? "", /note is ambiguous/);
  assert.match(result.textContent ?? "", /does not verify the workflow ran/);
  assert.match(result.textContent ?? "", /not retried from this screen/);
  assert.equal((screen.getByRole("button", { name: "Run one GHL test" }) as HTMLButtonElement).disabled, true);
  assert.equal(screen.queryByRole("button", { name: /retry/i }), null);
});

test("exact workflow id is saved without requiring the Select Time Zone name", async () => {
  const seen: { body: RoutingRuleGhlConfigSaveBody | null } = { body: null };
  const { container } = render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location()}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        saveWorkflow: async (body) => {
          seen.body = body;
          return { ok: true, deliveryEnabled: false, workflowTriggerMode: body.workflowTriggerMode ?? null, workflowId: body.destinationWorkflowIdGhl ?? null };
        },
      })}
    />
  );

  assert.match(line(container, "Connected location"), /Sam's Test/);
  assert.match(line(container, "Saved trigger mode"), /unset/);
  assert.equal(markState(container, "Sheets campaign delivery"), "no");
  assert.equal(markState(container, "GHL ongoing delivery"), "no");

  fireEvent.click(screen.getByRole("button", { name: "Discover workflows" }));
  assert.ok(await screen.findByRole("option", { name: `New Lead · ${WORKFLOW_ID}` }));
  fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: WORKFLOW_ID } });
  fireEvent.change(screen.getByLabelText("Trigger mode"), { target: { value: "direct_api" } });
  fireEvent.click(screen.getByRole("button", { name: "Save selected workflow" }));

  await waitFor(() => {
    assert.match(line(container, "Saved trigger mode"), /direct_api/);
  });
  assert.equal(seen.body?.destinationWorkflowIdGhl, WORKFLOW_ID);
  assert.equal(seen.body?.workflowTriggerMode, "direct_api");
  assert.equal(seen.body?.workflowStartRequired, true);
  assert.equal(seen.body?.locationId, "loc_sam");
  assert.equal("deliveryEnabled" in (seen.body ?? {}), false);
  assert.match(line(container, "Saved workflow id"), new RegExp(WORKFLOW_ID));
  assert.match(line(container, "Saved trigger mode"), /direct_api/);
  assert.equal(markState(container, "GHL ongoing delivery"), "no");
});

test("an id outside the discovered list is not saved", async () => {
  let saves = 0;
  render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location()}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        saveWorkflow: async () => {
          saves += 1;
          return { ok: true, deliveryEnabled: false, workflowTriggerMode: "tag_trigger", workflowId: WORKFLOW_ID };
        },
      })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Discover workflows" }));
  await screen.findByLabelText("Workflow id");
  fireEvent.change(screen.getByLabelText("Workflow id"), { target: { value: "99999999-9999-4999-8999-999999999999" } });
  assert.match(screen.getByText(/not in this location's workflow list/).textContent ?? "", /not saved/);
  assert.equal((screen.getByRole("button", { name: "Save selected workflow" }) as HTMLButtonElement).disabled, true);
  assert.equal(saves, 0);
});

test("preview names the persisted simulation and blocks a send until the phrase matches", async () => {
  const calls: string[] = [];
  const { container } = render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead(), lead({ sourceLeadEventId: "evt_plain", routingDryRunDecisionId: null, identity: "no decision" })]}
      location={location({ workflowId: WORKFLOW_ID, workflowTriggerMode: "direct_api" })}
      connections={[connection()]}
      sheetsCampaignEnabled={true}
      actions={actions({
        executeTest: async (_planId, confirmation) => {
          calls.push(confirmation);
          return {
            ok: true,
            result: {
              status: "succeeded",
              contactIdGhl: "contact_1",
              opportunityIdGhl: null,
              workflowStarted: true,
              externalCallExecuted: true,
              errors: [],
              skippedDuplicate: false,
            },
          };
        },
      })}
    />
  );

  fireEvent.change(screen.getByLabelText("Stored lead for GHL"), { target: { value: "evt_plain" } });
  assert.match(screen.getByText(/no routing decision/).textContent ?? "", /cannot be built/);
  assert.equal((screen.getByRole("button", { name: "Preview GHL delivery" }) as HTMLButtonElement).disabled, true);

  fireEvent.change(screen.getByLabelText("Stored lead for GHL"), { target: { value: "evt_dummy" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview GHL delivery" }));
  const preview = await screen.findByTestId("ghl-delivery-preview");
  assert.match(preview.textContent ?? "", /\/contacts\/upsert/);
  assert.match(preview.textContent ?? "", new RegExp(WORKFLOW_ID));
  assert.match(preview.textContent ?? "", /enrolls this workflow id/);
  assert.match(preview.textContent ?? "", /Omitted/);
  assert.match(preview.textContent ?? "", /Pipeline\/stage not configured/);
  assert.match(preview.textContent ?? "", /Persisted simulation run_sim_1/);
  assert.match(preview.textContent ?? "", /Ongoing delivery changed: no/);
  assert.equal(markState(container, "Sheets campaign delivery"), "yes");
  assert.equal(markState(container, "GHL ongoing delivery"), "no");

  const run = screen.getByRole("button", { name: "Run one GHL test" }) as HTMLButtonElement;
  assert.equal(run.disabled, false);
  fireEvent.click(run);
  const execute = screen.getByRole("button", { name: "Execute one GHL test" }) as HTMLButtonElement;
  assert.equal(execute.disabled, true);
  fireEvent.change(screen.getByLabelText("GHL test confirmation"), { target: { value: "deliver one lead" } });
  assert.equal((screen.getByRole("button", { name: "Execute one GHL test" }) as HTMLButtonElement).disabled, true);
  fireEvent.change(screen.getByLabelText("GHL test confirmation"), { target: { value: LIVE_CANARY_CONFIRMATION_TEXT } });
  fireEvent.click(screen.getByRole("button", { name: "Execute one GHL test" }));
  const result = await screen.findByTestId("ghl-test-result");
  assert.match(result.textContent ?? "", /Attempt status: succeeded/);
  assert.match(result.textContent ?? "", /Contact id: contact_1/);
  assert.match(result.textContent ?? "", /Workflow started: yes/);
  assert.match(result.textContent ?? "", /Ongoing delivery changed: no/);
  assert.deepEqual(calls, [LIVE_CANARY_CONFIRMATION_TEXT]);
  assert.equal(markState(container, "GHL ongoing delivery"), "no");
});

test("duplicate risk and an uncertain attempt cannot be sent again", async () => {
  const { rerender } = render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location()}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        loadPreflight: async () => ({
          ok: true,
          preflight: preflight({ canExecute: true, duplicateBlocksLive: true, duplicateRiskLevel: "high" }),
        }),
      })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview GHL delivery" }));
  assert.match((await screen.findByText(/Duplicate risk: high/)).textContent ?? "", /high/);
  assert.match(screen.getByText(/will not send it again/).textContent ?? "", /Duplicate risk blocks/);
  assert.equal((screen.getByRole("button", { name: "Run one GHL test" }) as HTMLButtonElement).disabled, true);

  rerender(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location()}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        loadPreflight: async () => ({
          ok: true,
          preflight: preflight({ canExecute: true, lastLiveRunStatus: "outcome_uncertain" }),
        }),
      })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview GHL delivery" }));
  assert.ok(await screen.findByTestId("ghl-outcome-uncertain"));
  assert.equal((screen.getByRole("button", { name: "Run one GHL test" }) as HTMLButtonElement).disabled, true);
});

test("a location linked to another client is not moved", async () => {
  let saves = 0;
  render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[]}
      location={location({ locationId: null, locationName: null, deliveryEnabled: null })}
      connections={[connection({ clientAccountId: "other_client", locationName: "Other location" })]}
      sheetsCampaignEnabled={null}
      actions={actions({
        saveWorkflow: async () => {
          saves += 1;
          return { ok: true, deliveryEnabled: false, workflowTriggerMode: "tag_trigger", workflowId: WORKFLOW_ID };
        },
      })}
    />
  );
  fireEvent.change(screen.getByLabelText("GHL location"), { target: { value: "loc_sam" } });
  assert.match(screen.getByText(/linked to other_client/).textContent ?? "", /will not move it/);
  fireEvent.click(screen.getByRole("button", { name: "Discover workflows" }));
  await screen.findByLabelText("Workflow");
  fireEvent.change(screen.getByLabelText("Workflow"), { target: { value: WORKFLOW_ID } });
  assert.equal((screen.getByRole("button", { name: "Save selected workflow" }) as HTMLButtonElement).disabled, true);
  assert.equal(saves, 0);
  assert.equal(markState(document.body, "GHL ongoing delivery"), "unknown");
});

test("a delivery-flag blocker does not disable the selected test", async () => {
  render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location()}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        loadPreflight: async () => ({
          ok: true,
          preflight: preflight({
            canExecute: false,
            blockers: ["delivery enabled is false", "internal approval is pending"],
          }),
        }),
      })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Preview GHL delivery" }));
  assert.ok(await screen.findByText(/Can execute: no/));
  assert.equal((screen.getByRole("button", { name: "Run one GHL test" }) as HTMLButtonElement).disabled, false);
});

test("ongoing GHL activation is a separate confirmation and lists omitted fields", async () => {
  let phrase = "";
  const { container } = render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location()}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        activateOngoing: async (_requestId, confirmation) => {
          phrase = confirmation;
          return {
            ok: true,
            alreadyActive: false,
            omittedCoreFields: ["state"],
            omittedOptionalFields: ["beneficiary"],
          };
        },
      })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Enable ongoing GHL delivery" }));
  const confirm = screen.getByRole("button", { name: "Confirm ongoing GHL delivery" }) as HTMLButtonElement;
  assert.equal(confirm.disabled, true);
  fireEvent.change(screen.getByLabelText("Ongoing GHL confirmation"), { target: { value: "ENABLE ONGOING GHL DELIVERY" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm ongoing GHL delivery" }));
  assert.ok(await screen.findByTestId("ghl-activation-omissions"));
  assert.match(screen.getByTestId("ghl-activation-omissions").textContent ?? "", /state/);
  assert.match(screen.getByTestId("ghl-activation-omissions").textContent ?? "", /Omitted fields are not sent/);
  assert.equal(phrase, "ENABLE ONGOING GHL DELIVERY");
  assert.equal(markState(container, "GHL ongoing delivery"), "yes");
  assert.equal(markState(container, "Sheets campaign delivery"), "no");
});

test("field ids are saved without enabling delivery, and blank values stay separate from missing mappings", async () => {
  const FIELD_ID = "ghl_field_primary_reason";
  const seen: { map: Record<string, { ghlFieldKey: string }> | null } = { map: null };
  let saveCalls = 0;
  let deliveryFlagSent = false;
  render(
    <GhlWalkthroughPanel
      clientAccountId="client_sam"
      leads={[lead()]}
      location={location()}
      connections={[connection()]}
      sheetsCampaignEnabled={false}
      actions={actions({
        discover: async () => ({
          ok: true,
          discovery: {
            ...discovery(),
            customFields: [
              {
                id: FIELD_ID,
                name: "Primary Reason",
                key: "contact.primary_reason",
                fieldKey: "contact.primary_reason",
                dataType: "TEXT",
              },
              {
                id: "ghl_field_beneficiary",
                name: "Beneficiary",
                key: "contact.beneficiary",
                fieldKey: "contact.beneficiary",
                dataType: "TEXT",
              },
            ],
          },
        }),
        saveFieldMap: async (input) => {
          saveCalls += 1;
          seen.map = input.sourceAttributeFieldMapJson;
          deliveryFlagSent = "deliveryEnabled" in input;
          return { ok: true, deliveryEnabled: false };
        },
        loadLeadAttributes: async () => ({
          ok: true,
          sourceAttributes: { primary_reason: "Family", age: "64", beneficiary: null },
        }),
      })}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Discover workflows" }));
  await screen.findByRole("combobox", { name: "GHL field for primary_reason" });
  chooseGhlField("primary_reason", "primary");
  chooseGhlField("beneficiary", "ghl_field_beneficiary");
  assert.equal(saveCalls, 0);
  fireEvent.click(screen.getByRole("button", { name: "Save field ids" }));
  await waitFor(() => assert.equal(seen.map?.primary_reason?.ghlFieldKey, FIELD_ID));
  assert.equal(seen.map?.beneficiary?.ghlFieldKey, "ghl_field_beneficiary");
  assert.equal(saveCalls, 1);
  assert.equal(deliveryFlagSent, false);
  fireEvent.click(screen.getByRole("button", { name: "Review this lead's field values" }));
  const coverage = await screen.findByTestId("ghl-field-coverage");
  const text = coverage.textContent ?? "";
  const mappings = text.split("Missing source values:")[0] ?? "";
  assert.match(text, /primary_reason → ghl_field_primary_reason/);
  assert.match(mappings, /Missing mappings: age \(64\)/);
  assert.doesNotMatch(mappings, /beneficiary/);
  assert.match(text, /Missing source values: beneficiary → ghl_field_beneficiary/);
});

test("an existing mapping reloads the same field id, and Unmapped removes only that row", async () => {
  const FIELD_ID = "ghl_field_primary_reason";
  const BENEFICIARY_ID = "ghl_field_beneficiary";
  const seen: { map: Record<string, { ghlFieldKey: string }> | null } = { map: null };
  const customFields = [
    {
      id: FIELD_ID,
      name: "Primary Reason",
      key: "contact.primary_reason",
      fieldKey: "contact.primary_reason",
      dataType: "TEXT",
    },
    {
      id: BENEFICIARY_ID,
      name: "Beneficiary",
      key: "contact.beneficiary",
      fieldKey: "contact.beneficiary",
      dataType: "TEXT",
    },
  ];
  function renderSaved() {
    return render(
      <GhlWalkthroughPanel
        clientAccountId="client_sam"
        leads={[lead()]}
        location={location({
          sourceAttributeFieldMapJson: {
            primary_reason: { ghlFieldKey: FIELD_ID, requirement: "optional" },
            beneficiary: { ghlFieldKey: BENEFICIARY_ID, requirement: "optional" },
          },
        })}
        connections={[connection()]}
        sheetsCampaignEnabled={false}
        actions={actions({
          discover: async () => ({
            ok: true,
            discovery: { ...discovery(), customFields },
          }),
          saveFieldMap: async (input) => {
            seen.map = input.sourceAttributeFieldMapJson;
            return { ok: true, deliveryEnabled: false };
          },
        })}
      />
    );
  }
  const first = renderSaved();
  fireEvent.click(screen.getByRole("button", { name: "Discover workflows" }));
  const reason = await screen.findByRole("combobox", { name: "GHL field for primary_reason" });
  const beneficiary = screen.getByRole("combobox", { name: "GHL field for beneficiary" });
  assert.match(reason.textContent ?? "", new RegExp(FIELD_ID));
  assert.match(beneficiary.textContent ?? "", new RegExp(BENEFICIARY_ID));
  fireEvent.click(screen.getByRole("combobox", { name: "GHL field for age" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Search GHL fields for age" }), {
    target: { value: "typed-search-not-a-field" },
  });
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Search GHL fields for age" }), { key: "Enter" });
  fireEvent.click(screen.getByRole("button", { name: "Save field ids" }));
  await waitFor(() => assert.equal(seen.map?.primary_reason?.ghlFieldKey, FIELD_ID));
  assert.equal(seen.map?.beneficiary?.ghlFieldKey, BENEFICIARY_ID);
  assert.equal(seen.map !== null && "age" in seen.map, false);
  assert.equal(JSON.stringify(seen.map).includes("typed-search-not-a-field"), false);
  first.unmount();

  renderSaved();
  fireEvent.click(screen.getByRole("button", { name: "Discover workflows" }));
  await screen.findByRole("combobox", { name: "GHL field for primary_reason" });
  chooseGhlField("beneficiary", "Unmapped");
  fireEvent.click(screen.getByRole("button", { name: "Save field ids" }));
  await waitFor(() => assert.equal(seen.map?.beneficiary, undefined));
  assert.equal(seen.map?.primary_reason?.ghlFieldKey, FIELD_ID);
});
