import assert from "node:assert/strict";
import test from "node:test";

import {
  clientSwitchLine,
  ghlProofFromAttempts,
  knownProfileRevision,
  noteEventFromSourceLead,
  postActivationEvidence,
  requiredGaps,
  selectableStoredLeads,
  sheetDeliveryStates,
  sheetPrerequisiteRequired,
  sheetSelectionPrerequisites,
  sheetsMutationGate,
  UNCERTAIN_OUTCOME_LABEL,
} from "./view.ts";
import type { OnboardingSourceProof, OnboardingSummary } from "./types.ts";

const leadcapture = (overrides: Partial<OnboardingSourceProof["proofs"]> = {}): OnboardingSourceProof => ({
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
    delivery: { satisfied: false, sheetsJobId: null, ghlReceiptId: null },
    ...overrides,
  },
});

test("linked, observed, routing, and delivery stay independent", () => {
  const source = leadcapture({
    routingMatched: {
      satisfied: true,
      authority: "confirmed_source_association",
      routingDryRunDecisionId: "dry_1",
      matchedRuleId: null,
      looseRuleIgnored: null,
    },
  });
  assert.equal(source.proofs.linked.satisfied, true);
  assert.equal(source.proofs.observed.satisfied, false);
  assert.equal(source.proofs.routingMatched.satisfied, true);
  assert.equal(source.proofs.delivery.satisfied, false);
  assert.equal(selectableStoredLeads([source]).length, 0);
});

test("only an observed stored event can be selected", () => {
  const source = leadcapture({
    observed: {
      satisfied: true,
      at: "2026-10-26T15:00:00.000Z",
      sourceLeadEventId: "evt_alex",
      intakeStage: "routing_matched",
      captureOnly: false,
    },
  });
  const [lead] = selectableStoredLeads([source]);
  assert.equal(lead?.sourceLeadEventId, "evt_alex");
  assert.equal(lead?.identity, "go.example.com/alex");
  assert.equal(lead?.routingDryRunDecisionId, null);
  const routed = leadcapture({
    observed: {
      satisfied: true,
      at: "2026-10-26T15:00:00.000Z",
      sourceLeadEventId: "evt_routed",
      intakeStage: "routing_matched",
      captureOnly: false,
    },
    routingMatched: {
      satisfied: true,
      authority: "confirmed_source_association",
      routingDryRunDecisionId: "dry_1",
      matchedRuleId: null,
      looseRuleIgnored: null,
    },
  });
  assert.equal(selectableStoredLeads([routed])[0]?.routingDryRunDecisionId, "dry_1");
});

test("sheet states do not collapse saved, bound, permission, and delivery", () => {
  const summary = {
    sheets: {
      destinationSaved: true,
      writeReadiness: "not_verified",
      campaignDispatchEnabled: true,
    },
    gates: [{ id: "sheets_tab_explicitly_bound", required: true, satisfied: true, evidenceIds: [] }],
  } as unknown as OnboardingSummary;
  const states = sheetDeliveryStates(summary);
  assert.deepEqual(
    {
      saved: states.saved,
      bound: states.bound,
      permissionTested: states.permissionTested,
      deliveryActive: states.deliveryActive,
    },
    { saved: "yes", bound: "yes", permissionTested: "no", deliveryActive: "yes" }
  );
});

test("an HTTP proof does not mark enrollment or downstream execution", () => {
  const proofs = ghlProofFromAttempts([
    {
      id: "attempt_1",
      destination: "ghl_location_api",
      status: "uncertain",
      proves: ["http_accepted"],
      doesNotProve: ["workflow_enrolled", "downstream_executed"],
      externalCallExecuted: true,
      downstreamExecuted: false,
      detail: null,
    },
  ]);
  assert.equal(proofs.http_accepted, "proven");
  assert.equal(proofs.note_persisted, "unproven");
  assert.equal(proofs.workflow_enrolled, "unproven");
  assert.equal(proofs.downstream_executed, "unproven");
});

test("required gaps are the unsatisfied required gates", () => {
  const gaps = requiredGaps([
    { id: "sheets_permission_probe", required: true, satisfied: false, evidenceIds: [] },
    { id: "aged_not_activated_by_onboarding", required: false, satisfied: true, evidenceIds: [] },
  ]);
  assert.deepEqual(gaps.map((gate) => gate.id), ["sheets_permission_probe"]);
});

test("note preview event keeps answer collections and drops the raw document", () => {
  const event = noteEventFromSourceLead({
    id: "evt_alex",
    leadName: "Alex Gross",
    email: "alex@example.invalid",
    phone: "+15555550111",
    receivedAt: "2026-10-26T15:00:00.000Z",
    rawPayloadJson: {
      answers: { "Primary Reason": "burial" },
      authorization: "secret-token",
    },
    normalizedPayloadJson: { contact: { email: "alex@example.invalid" } },
    enrichmentMetadataJson: { sourceAttributes: { primary_reason: "burial" } },
  });
  assert.equal(event.sourceLeadEventId, "evt_alex");
  assert.equal("authorization" in event, false);
  assert.equal("rawPayloadJson" in event, false);
  assert.deepEqual(event.answers, { "Primary Reason": "burial" });
  assert.equal(UNCERTAIN_OUTCOME_LABEL, "Outcome uncertain — manual review required");
});

test("a writer receipt is evidence and a valid custom map stays a Sheets prerequisite", () => {
  const gates = [
    { id: "sheets_custom_map_published", required: true, satisfied: true, evidenceIds: ["map_1"] },
    { id: "sheets_permission_probe", required: true, satisfied: false, evidenceIds: [] },
    { id: "sheets_writer_receipt", role: "evidence" as const, required: false, satisfied: false, evidenceIds: [] },
  ];
  assert.deepEqual(
    sheetSelectionPrerequisites(gates).map((gate) => gate.id),
    ["sheets_custom_map_published", "sheets_permission_probe"]
  );
  assert.deepEqual(requiredGaps(gates).map((gate) => gate.id), ["sheets_permission_probe"]);
  assert.deepEqual(postActivationEvidence(gates).map((gate) => gate.id), ["sheets_writer_receipt"]);
  const validMap = { id: "sheets_custom_map_published", required: false, satisfied: true, evidenceIds: ["map_1"] };
  assert.equal(sheetPrerequisiteRequired(validMap, true), true);
  assert.equal(sheetPrerequisiteRequired(validMap, false), false);
  const presetWithoutMap = { id: "sheets_custom_map_published", required: false, satisfied: false, evidenceIds: [] };
  assert.equal(sheetPrerequisiteRequired(presetWithoutMap, true), false);
});

test("profile revision is only a known nonnegative integer", () => {
  assert.equal(knownProfileRevision(null), null);
  assert.equal(knownProfileRevision(undefined), null);
  assert.equal(knownProfileRevision(Number.NaN), null);
  assert.equal(knownProfileRevision(-1), null);
  assert.equal(knownProfileRevision(0), 0);
  assert.equal(knownProfileRevision(4), 4);
});

test("sheet writes stay closed when a delivery switch is on or unknown", () => {
  const base = {
    sheets: {
      destinationSaved: false,
      spreadsheetId: null,
      campaignTab: null,
      campaignDispatchEnabled: false,
      campaignDispatchNotBefore: null,
      agedDispatchEnabled: false,
      writeReadiness: "not_verified" as const,
      deliveryExecution: "disabled" as const,
      uncertainJob: false,
    },
  };
  const loaded = { ...base } as unknown as OnboardingSummary;
  assert.equal(sheetsMutationGate(null, { campaignDispatchEnabled: false, agedDispatchEnabled: false }), "unknown");
  assert.equal(sheetsMutationGate(loaded, null), "unknown");
  assert.equal(sheetsMutationGate(loaded, { campaignDispatchEnabled: false, agedDispatchEnabled: false }), "allowed");
  assert.equal(sheetsMutationGate(loaded, { campaignDispatchEnabled: true, agedDispatchEnabled: false }), "active");
  assert.match(clientSwitchLine(null, null), /Client campaign switch: unknown/);
  assert.match(clientSwitchLine(null, null), /Global infrastructure: unknown/);
  assert.match(clientSwitchLine(loaded, { dispatchFlagEnabled: true }), /Client campaign switch: no/);
  assert.match(clientSwitchLine(loaded, { dispatchFlagEnabled: true }), /Global infrastructure: yes/);
});
