import assert from "node:assert/strict";
import test from "node:test";

import { buildOnboardingLeadNote } from "../ghl-delivery-adapter/onboarding-lead-note.js";
import { executeOnboardingLocationApiDelivery } from "./onboarding-ghl-workflow.js";
import { capturedTestNoteBuilder } from "./onboarding-note-bridge.js";

test("the note bridge renders sa360_lead_note_v2 and does not call the location API complete", async () => {
  const built = capturedTestNoteBuilder()({
    contract: "sa360_lead_note_v2",
    sourceLeadEventId: "evt_note_v2",
    testRunId: "11111111-1111-4111-8111-111111111111",
    receivedAt: "2026-10-26T15:04:00.000Z",
    noteOverflow: "refuse",
    maxChars: 10000,
    normalizedPayloadJson: {
      contact: {
        full_name: "Ada Lovelace",
        first_name: "Ada",
        last_name: "Lovelace",
        email: "ada@example.com",
        phone_e164: "+15550100",
        state: "TX",
      },
      routing: {
        source_intake: {
          sourceAttributes: { primary_reason: "Family" },
          answerFields: [
            { key: "Primary Reason", value: "Family", canonicalKey: "primary_reason" },
            { key: "Beneficiary", value: "Child", canonicalKey: "beneficiary" },
            { key: "Beneficiary", value: "Spouse", canonicalKey: "beneficiary" },
          ],
        },
      },
    },
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.match(built.body, /SA360 test run: 11111111-1111-4111-8111-111111111111/);
  assert.equal(built.qaEvidence?.status, "not_recoverable");
  assert.equal(built.qaEvidence?.fullQaCompletenessAsserted, false);

  const plan = buildOnboardingLeadNote({
    event: {
      sourceLeadEventId: "evt_note_v2",
      generatedAt: "2026-10-26T15:04:00.000Z",
      fullName: "Ada Lovelace",
      phone: "+15550100",
      email: "ada@example.com",
      state: "TX",
      answerFields: [
        { key: "Primary Reason", value: "Family", canonicalKey: "primary_reason" },
        { key: "Beneficiary", value: "Child", canonicalKey: "beneficiary" },
      ],
    },
    clientAccountId: "client_a",
    testRunId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const calls: string[] = [];
  const proof = await executeOnboardingLocationApiDelivery({
    locationId: "loc_test",
    contact: { firstName: "Ada", lastName: "Lovelace", email: "ada@example.com", phone: "+15550100" },
    notePlan: plan,
    notesEnabled: true,
    workflowTriggerMode: "direct_api",
    workflowId: "wf_select_time_zone",
    transport: async (call) => {
      calls.push(call.path);
      if (call.path === "/contacts/upsert") return { httpStatus: 200, body: { contact: { id: "contact_1" } } };
      if (call.path.includes("/notes")) return { httpStatus: 201, body: { note: { id: `note_${calls.length}` } } };
      if (call.path.includes("/workflow/")) return { httpStatus: 200, body: { id: "enroll_1" } };
      return { httpStatus: 500, outcome: "failed" };
    },
  });
  assert.equal(calls[0], "/contacts/upsert");
  assert.equal(calls.filter((path) => path.endsWith("/notes")).length, plan.parts.length);
  assert.equal(calls.some((path) => path === "/contacts/contact_1/workflow/wf_select_time_zone"), true);
  assert.equal(proof.http_accepted, true);
  assert.equal(proof.contact_upserted, true);
  assert.equal(proof.note_persisted, true);
  assert.equal(proof.workflow_enrolled, true);
  assert.equal(proof.downstream_executed, false);
});
