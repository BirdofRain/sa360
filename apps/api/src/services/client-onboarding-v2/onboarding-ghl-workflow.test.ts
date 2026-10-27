import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildOnboardingLeadNote } from "../ghl-delivery-adapter/onboarding-lead-note.js";
import {
  LOCATION_API_ONBOARDING_CAPABILITIES,
  ONBOARDING_GHL_INTEGRATION_REMAINING,
  applySelectTimeZoneSelection,
  executeOnboardingLocationApiDelivery,
  matchSelectTimeZoneWorkflows,
  onboardingContactUpsertBody,
  proofFromInboundWebhookAcceptance,
  splitLeadName,
  validateSelectTimeZoneSelection,
  workflowTriggerModeBeforeSelection,
  type ClientGhlDestinationSnapshot,
  type DiscoveredWorkflow,
  type LocationApiMockTransport,
} from "./onboarding-ghl-workflow.js";

const UNIQUE: DiscoveredWorkflow[] = [
  { id: "wf_other", name: "Welcome" },
  { id: "wf_select", name: "Select Time Zone", status: "published", type: "workflow" },
];

function destination(overrides: Partial<ClientGhlDestinationSnapshot> = {}): ClientGhlDestinationSnapshot {
  return {
    clientAccountId: "onb_fixture_client",
    revision: 1,
    destinationWorkflowIdGhl: null,
    workflowTriggerMode: "tag_trigger",
    deliveryEnabled: false,
    clientCutoverApproved: false,
    ...overrides,
  };
}

test("zero, one, and multiple Select Time Zone names are distinct evidence", () => {
  const unique = matchSelectTimeZoneWorkflows(UNIQUE);
  assert.equal(unique.workflowMatch, "unique");
  if (unique.workflowMatch !== "unique") return;
  assert.equal(unique.workflowId, "wf_select");
  assert.equal(unique.workflowName, "Select Time Zone");

  const spaced = matchSelectTimeZoneWorkflows([{ id: "wf_case", name: "  select TIME zone  " }]);
  assert.equal(spaced.workflowMatch, "unique");
  if (spaced.workflowMatch !== "unique") return;
  assert.equal(spaced.workflowId, "wf_case");

  const missing = matchSelectTimeZoneWorkflows([{ id: "wf_near", name: "Select Time Zone Workflow" }]);
  assert.equal(missing.workflowMatch, "workflow_not_found");
  assert.equal(missing.selectedWorkflowId, null);

  const ambiguous = matchSelectTimeZoneWorkflows([
    { id: "wf_a", name: "Select Time Zone" },
    { id: "wf_b", name: "select time zone" },
  ]);
  assert.equal(ambiguous.workflowMatch, "workflow_ambiguous");
  assert.equal(ambiguous.selectedWorkflowId, null);
  if (ambiguous.workflowMatch !== "workflow_ambiguous") return;
  assert.deepEqual(
    ambiguous.matches.map((match) => match.id),
    ["wf_a", "wf_b"]
  );
});

test("selection accepts only a fresh unique Select Time Zone id and prepares direct_api", () => {
  const selected = validateSelectTimeZoneSelection({
    clientAccountId: "onb_fixture_client",
    expectedRevision: 1,
    destination: destination(),
    workflows: UNIQUE,
    discoveredWorkflowId: "wf_select",
    discoveredName: "Select Time Zone",
  });
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  assert.deepEqual(selected.patch, {
    destinationWorkflowIdGhl: "wf_select",
    workflowTriggerMode: "direct_api",
  });
  assert.equal(selected.preserved.deliveryEnabled, false);
  assert.equal(selected.preserved.clientCutoverApproved, false);
  assert.equal("deliveryEnabled" in selected.patch, false);
  assert.equal(workflowTriggerModeBeforeSelection(null), "tag_trigger");
  assert.equal(workflowTriggerModeBeforeSelection("tag_trigger"), "tag_trigger");
});

test("stale, renamed, ambiguous, and hardcoded ids are rejected", () => {
  const stale = validateSelectTimeZoneSelection({
    clientAccountId: "onb_fixture_client",
    destination: destination({ destinationWorkflowIdGhl: "wf_old", workflowTriggerMode: "direct_api" }),
    workflows: UNIQUE,
    discoveredWorkflowId: "wf_old",
    discoveredName: "Select Time Zone",
  });
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.error, "workflow_not_found");

  const renamed = validateSelectTimeZoneSelection({
    clientAccountId: "onb_fixture_client",
    destination: destination(),
    workflows: [{ id: "wf_select", name: "Old Time Zone" }],
    discoveredWorkflowId: "wf_select",
    discoveredName: "Select Time Zone",
  });
  assert.equal(renamed.ok, false);
  if (renamed.ok) return;
  assert.equal(renamed.error, "workflow_name_mismatch");

  const ambiguous = validateSelectTimeZoneSelection({
    clientAccountId: "onb_fixture_client",
    destination: destination(),
    workflows: [
      { id: "wf_a", name: "Select Time Zone" },
      { id: "wf_b", name: "Select Time Zone" },
    ],
    discoveredWorkflowId: "wf_a",
    discoveredName: "Select Time Zone",
  });
  assert.equal(ambiguous.ok, false);
  if (ambiguous.ok) return;
  assert.equal(ambiguous.error, "workflow_ambiguous");

  const hardcoded = validateSelectTimeZoneSelection({
    clientAccountId: "onb_fixture_client",
    destination: destination(),
    workflows: UNIQUE,
    discoveredWorkflowId: "hardcoded_workflow_id",
    discoveredName: "Select Time Zone",
  });
  assert.equal(hardcoded.ok, false);
  if (hardcoded.ok) return;
  assert.equal(hardcoded.error, "workflow_not_found");

  const conflict = validateSelectTimeZoneSelection({
    clientAccountId: "onb_fixture_client",
    expectedRevision: 2,
    destination: destination({ revision: 1 }),
    workflows: UNIQUE,
    discoveredWorkflowId: "wf_select",
    discoveredName: "Select Time Zone",
  });
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.error, "revision_conflict");
});

test("applying the patch changes only this client's workflow id and direct_api mode", () => {
  const current = destination({ deliveryEnabled: true, clientCutoverApproved: true });
  const other = destination({
    clientAccountId: "other_client",
    workflowTriggerMode: "tag_trigger",
    destinationWorkflowIdGhl: null,
  });
  const selected = validateSelectTimeZoneSelection({
    clientAccountId: current.clientAccountId,
    expectedRevision: 1,
    destination: current,
    workflows: UNIQUE,
    discoveredWorkflowId: "wf_select",
    discoveredName: "select time zone",
  });
  assert.equal(selected.ok, true);
  if (!selected.ok) return;
  const next = applySelectTimeZoneSelection(current, selected.patch);
  assert.equal(next.destinationWorkflowIdGhl, "wf_select");
  assert.equal(next.workflowTriggerMode, "direct_api");
  assert.equal(next.deliveryEnabled, true);
  assert.equal(next.clientCutoverApproved, true);
  assert.equal(other.workflowTriggerMode, "tag_trigger");
  assert.equal(other.destinationWorkflowIdGhl, null);
  assert.equal(other.clientAccountId, "other_client");
});

test("location API proof keeps contact, note, enrollment, and downstream execution apart", async () => {
  const plan = buildOnboardingLeadNote({
    event: {
      sourceLeadEventId: "evt_note_v2",
      fullName: "Ada Lovelace",
      phone: "+15550100",
      email: "ada@example.com",
      state: "TX",
      sourceAttributes: { primary_reason: "Family" },
      answerFields: [{ key: "Primary Reason", value: "Family" }],
    },
    clientAccountId: "onb_fixture_client",
    testRunId: "run_1",
    maxChars: 10_000,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const names = splitLeadName("Ada Lovelace");

  const calls: string[] = [];
  const transport: LocationApiMockTransport = async (call) => {
    calls.push(`${call.method} ${call.path}`);
    assert.equal("customFields" in call.body, false);
    if (call.path === "/contacts/upsert") {
      return { httpStatus: 200, body: { contact: { id: "contact_1" } } };
    }
    if (call.path.endsWith("/notes")) {
      assert.deepEqual(Object.keys(call.body).sort(), ["body", "title"]);
      assert.equal(call.idempotencyKey?.startsWith("onboarding-test:run_1:ghl-note:"), true);
      return { httpStatus: 201, body: { note: { id: "note_1" } } };
    }
    if (call.path.endsWith("/workflow/wf_select")) {
      return { httpStatus: 200, body: { id: "enrollment_1" } };
    }
    throw new Error(`unexpected ${call.path}`);
  };

  const proof = await executeOnboardingLocationApiDelivery({
    locationId: "loc_1",
    contact: { ...names, email: "ada@example.com", phone: "+15550100", state: "TX" },
    notePlan: plan,
    notesEnabled: true,
    workflowTriggerMode: "direct_api",
    workflowId: "wf_select",
    transport,
  });

  assert.equal(proof.http_accepted, true);
  assert.equal(proof.contact_upserted, true);
  assert.equal(proof.note_persisted, true);
  assert.equal(proof.workflow_enrolled, true);
  assert.equal(proof.downstream_executed, false);
  assert.equal(proof.posted, true);
  assert.deepEqual(calls, [
    "POST /contacts/upsert",
    "POST /contacts/contact_1/notes",
    "POST /contacts/contact_1/workflow/wf_select",
  ]);
  assert.equal(calls.some((call) => call.includes("/customFields")), false);
  assert.equal(LOCATION_API_ONBOARDING_CAPABILITIES.introducesCustomFields, false);
  assert.equal(LOCATION_API_ONBOARDING_CAPABILITIES.createsWorkflow, false);
});

test("a 2xx without a contact id or note id is not persistence, and tag mode does not enroll", async () => {
  const plan = buildOnboardingLeadNote({
    event: { sourceLeadEventId: "evt_note_v2", fullName: "Ada Lovelace" },
    maxChars: 10_000,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;

  const noContact = await executeOnboardingLocationApiDelivery({
    locationId: "loc_1",
    contact: splitLeadName("Ada Lovelace"),
    notePlan: plan,
    notesEnabled: true,
    workflowTriggerMode: "direct_api",
    workflowId: "wf_select",
    transport: async () => ({ httpStatus: 200, body: { ok: true } }),
  });
  assert.equal(noContact.http_accepted, true);
  assert.equal(noContact.contact_upserted, false);
  assert.equal(noContact.note_persisted, false);
  assert.equal(noContact.workflow_enrolled, false);
  assert.equal(noContact.downstream_executed, false);
  assert.equal(noContact.calls.length, 1);

  let notes = 0;
  const noNoteId = await executeOnboardingLocationApiDelivery({
    locationId: "loc_1",
    contact: splitLeadName("Ada Lovelace"),
    notePlan: plan,
    notesEnabled: true,
    workflowTriggerMode: "tag_trigger",
    workflowId: "wf_select",
    transport: async (call) => {
      if (call.path === "/contacts/upsert") return { httpStatus: 200, body: { id: "contact_1" } };
      notes += 1;
      return { httpStatus: 200, body: { ok: true } };
    },
  });
  assert.equal(notes, 1);
  assert.equal(noNoteId.http_accepted, true);
  assert.equal(noNoteId.contact_upserted, true);
  assert.equal(noNoteId.note_persisted, false);
  assert.equal(noNoteId.workflow_enrolled, false);
  assert.equal(noNoteId.workflowApiCalled, false);
  assert.equal(noNoteId.triggerTagPlanned, true);
  assert.equal(noNoteId.downstream_executed, false);
  assert.equal(noNoteId.calls.some((call) => call.path.includes("/workflow/")), false);
  assert.equal(noNoteId.calls.some((call) => call.path.endsWith("/tags")), false);
});

test("an uncertain first note part is not followed by another part or by enrollment", async () => {
  const plan = buildOnboardingLeadNote({
    event: {
      sourceLeadEventId: "evt_note_v2",
      fullName: "Ada Lovelace",
      answerFields: [{ key: "Long Note", value: "Q".repeat(400) }],
    },
    noteOverflow: "split_continuation",
    maxChars: 280,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.ok(plan.parts.length > 1);

  let notePosts = 0;
  const proof = await executeOnboardingLocationApiDelivery({
    locationId: "loc_1",
    contact: splitLeadName("Ada Lovelace"),
    notePlan: plan,
    notesEnabled: true,
    workflowTriggerMode: "direct_api",
    workflowId: "wf_select",
    transport: async (call) => {
      if (call.path === "/contacts/upsert") return { httpStatus: 200, body: { contact: { id: "contact_1" } } };
      notePosts += 1;
      return { httpStatus: 503, outcome: "uncertain", body: {} };
    },
  });
  assert.equal(notePosts, 1);
  assert.equal(proof.note_persisted, false);
  assert.equal(proof.notePartial, true);
  assert.equal(proof.error, "note_partial");
  assert.equal(proof.posted, false);
  assert.equal(proof.workflow_enrolled, false);
  assert.equal(proof.workflowApiCalled, false);
  assert.equal(proof.downstream_executed, false);
  assert.equal(proof.http_accepted, false);
});

test("inbound webhook acceptance proves only HTTP acceptance", () => {
  const proof = proofFromInboundWebhookAcceptance(200);
  assert.equal(proof.http_accepted, true);
  assert.equal(proof.contact_upserted, false);
  assert.equal(proof.note_persisted, false);
  assert.equal(proof.workflow_enrolled, false);
  assert.equal(proof.downstream_executed, false);
  assert.equal(proof.calls.length, 0);
});

test("contact upsert reuses the live body shape and adds no custom fields", () => {
  const body = onboardingContactUpsertBody("loc_1", {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: "+15550100",
    state: "TX",
  });
  assert.deepEqual(body, {
    locationId: "loc_1",
    email: "ada@example.com",
    phone: "+15550100",
    source: "sa360",
    firstName: "Ada",
    lastName: "Lovelace",
    state: "TX",
  });
});

test("note_too_long posts nothing", async () => {
  const plan = buildOnboardingLeadNote({
    event: {
      sourceLeadEventId: "evt_note_v2",
      fullName: "Ada Lovelace",
      answerFields: [{ key: "Long Note", value: "Q".repeat(400) }],
    },
    noteOverflow: "refuse",
    maxChars: 280,
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.status, "note_too_long");
  let called = 0;
  const proof = await executeOnboardingLocationApiDelivery({
    locationId: "loc_1",
    contact: splitLeadName("Ada Lovelace"),
    notePlan: plan,
    notesEnabled: true,
    workflowTriggerMode: "direct_api",
    workflowId: "wf_select",
    transport: async () => {
      called += 1;
      return { httpStatus: 200, body: {} };
    },
  });
  assert.equal(called, 0);
  assert.equal(proof.posted, false);
  assert.equal(proof.error, "note_too_long");
  assert.equal(proof.workflow_enrolled, false);
  assert.equal(proof.downstream_executed, false);
});

test("workflow source does not call live GHL and does not hardcode a workflow id", () => {
  const source = readFileSync(new URL("./onboarding-ghl-workflow.ts", import.meta.url), "utf8");
  assert.equal(source.includes("discoverGhlLocationConfig"), false);
  assert.equal(source.includes("ghlLiveJson"), false);
  assert.equal(source.includes("hardcoded_workflow_id"), false);
  assert.equal(source.includes('destinationWorkflowIdGhl = "'), false);
  assert.ok(ONBOARDING_GHL_INTEGRATION_REMAINING.some((item) => item.includes("Do not call live GHL")));
  assert.ok(ONBOARDING_GHL_INTEGRATION_REMAINING.some((item) => item.includes("ClientGhlDestination")));
  assert.ok(ONBOARDING_GHL_INTEGRATION_REMAINING.some((item) => item.includes("notesEnabled")));
});
