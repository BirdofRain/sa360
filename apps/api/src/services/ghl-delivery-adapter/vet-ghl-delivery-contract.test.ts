import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceAttributeStampPlan } from "../source-intake/source-attribute-stamp.service.js";
import { parseSourceEnrichmentPolicyJson } from "../source-intake/source-enrichment.service.js";
import { buildLiveContactUpsertHttpBody, buildContactUpsertRequest } from "./ghl-delivery-request-builders.js";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import {
  classifyRemoteOutcome,
  deliveryRetryDisposition,
  nativeContactHttpFields,
  nativeDateOfBirthForContact,
  planIntakeSummaryNote,
  retryDecision,
  separateDeliveryResults,
  tagModePlan,
  validateLocationCustomFieldTargets,
  vetNativeContactFields,
  vetWorkflowTriggerProposal,
  workflowEnrollmentAllowed,
} from "./vet-ghl-delivery-contract.js";
import { WORKFLOW_TRIGGER_TAG } from "./ghl-workflow-trigger-mode.js";

const branch = {
  id: "fieldBranch01",
  name: "Branch of Service",
  key: "branch_of_service",
  fieldKey: "contact.branch_of_service",
  dataType: "TEXT",
};
const reason = {
  id: "fieldReason01",
  name: "Primary Reason",
  key: "primary_reason",
  fieldKey: "contact.primary_reason",
  dataType: "TEXT",
};

test("missing native and custom values are omitted", () => {
  const native = vetNativeContactFields({
    firstName: "Ada",
    lastName: "  ",
    email: "",
    phone: null,
    city: "   ",
    source: "sa360",
    sourceAttributes: { date_of_birth: "", age: "71" },
  });
  const body = nativeContactHttpFields(native);
  assert.equal(body.firstName, "Ada");
  assert.equal(body.source, "sa360");
  assert.equal("lastName" in body, false);
  assert.equal("email" in body, false);
  assert.equal("phone" in body, false);
  assert.equal("city" in body, false);
  assert.equal("dateOfBirth" in body, false);
  assert.equal("age" in body, false);
  assert.equal(nativeDateOfBirthForContact({ sourceAttributes: { date_of_birth: "not-a-date" } }), null);

  const validation = validateLocationCustomFieldTargets({
    fieldMap: {
      desired_coverage: { ghlFieldKey: branch.id, requirement: "optional" },
      primary_reason: { ghlFieldKey: reason.id, requirement: "delivery_required" },
    },
    discoveredFields: [branch, reason],
    values: { desired_coverage: "  ", primary_reason: null },
    missingSourceKeys: ["primary_reason"],
  });
  assert.deepEqual(validation.writableKeys, []);
  assert.deepEqual(validation.collisions, []);
  assert.deepEqual(validation.unresolvedDeliveryRequired, ["primary_reason"]);
});

test("duplicate location targets drop both values and block enrollment", () => {
  const plan = buildSourceAttributeStampPlan({
    sourceAttributes: {
      desired_coverage: "25000",
      branch_of_service: "Army",
      primary_reason: "Family",
    },
    fieldMap: {
      desired_coverage: { ghlFieldKey: branch.fieldKey!, requirement: "optional" },
      branch_of_service: { ghlFieldKey: branch.id, requirement: "optional" },
      primary_reason: { ghlFieldKey: reason.id, requirement: "optional" },
    },
    discoveredFields: [branch, reason],
  });
  assert.deepEqual(Object.keys(plan.valuesByLogicalKey), ["primary_reason"]);
  assert.equal(plan.valuesByLogicalKey.primary_reason, "Family");
  assert.equal(plan.collisions.length, 1);
  assert.deepEqual(plan.collisions[0]?.canonicalKeys.sort(), ["branch_of_service", "desired_coverage"]);
  assert.equal("desired_coverage" in plan.idMap, false);
  assert.equal("branch_of_service" in plan.idMap, false);

  const enrollment = workflowEnrollmentAllowed({
    contactCompleted: true,
    requiredCustomFieldStampFailed: false,
    collisions: plan.collisions,
    unresolvedDeliveryRequired: [],
  });
  assert.equal(enrollment.allowed, false);
  assert.match(enrollment.reason ?? "", /Duplicate custom field targets/);
});

test("DOB is a native ISO date and age stays off the contact body", () => {
  const dob = nativeDateOfBirthForContact({
    sourceAttributes: { date_of_birth: "1955-03-13", age: "71" },
    receivedAt: "2026-03-13T12:00:00.000Z",
  });
  assert.equal(dob, "1955-03-13");
  const body = nativeContactHttpFields(
    vetNativeContactFields({
      firstName: "Sam",
      lastName: "Veteran",
      email: "sam@example.com",
      phone: "+15551212",
      source: "sa360",
      sourceAttributes: { date_of_birth: "1955-03-13", age: "71" },
      receivedAt: "2026-03-13T12:00:00.000Z",
    })
  );
  assert.equal(body.dateOfBirth, "1955-03-13");
  assert.equal("age" in body, false);
  assert.equal("consumer_age" in body, false);
  assert.equal(
    nativeDateOfBirthForContact({
      normalizedPayload: { contact: { dateOfBirth: "03/13/1955" } },
    }),
    "1955-03-13"
  );
  assert.equal(
    nativeDateOfBirthForContact({
      normalizedPayload: { contact: { dateOfBirth: "not-a-date" } },
    }),
    null
  );
});

test("contact upsert body omits blanks and keeps source", () => {
  const ctx = {
    plan: {
      destinationSubaccountIdGhl: "loc_1",
      sourceEmail: "sam@example.com",
      sourcePhoneE164: "+15551212",
      sourceLeadUid: "lead_1",
      destinationClientAccountId: "client_1",
      nicheKey: "vet",
      steps: [],
    },
    rule: { nicheKey: "vet" },
    sourceEnrichment: {
      sourceAttributes: { city: "" },
      enrichmentStatus: "partial",
      automationReadiness: "limited",
      unmappedSourceFieldKeys: [],
      sourceAttributeFieldMap: {},
      sourceEnrichmentPolicy: { intakeSummaryNotesEnabled: false },
      normalizedPayload: {
        routing: { source_intake: { sourceAttributes: { date_of_birth: "1955-03-13" } } },
        contact: { city: " ", address1: "" },
      },
      receivedAt: "2026-03-13T12:00:00.000Z",
    },
  } as unknown as GhlAdapterPlanContext;
  const http = buildLiveContactUpsertHttpBody(buildContactUpsertRequest(ctx));
  assert.equal(http.dateOfBirth, "1955-03-13");
  assert.equal(http.source, "sa360");
  assert.equal("city" in http, false);
  assert.equal("address1" in http, false);
  assert.equal("customFields" in http, false);
  assert.equal("age" in http, false);
});

test("direct API is a proposal and tag mode only adds tags", () => {
  const proposal = vetWorkflowTriggerProposal("tag_trigger");
  assert.deepEqual(proposal, {
    proposedMode: "direct_api",
    storedMode: "tag_trigger",
    changesExistingClients: false,
  });
  const tags = tagModePlan({ mode: "tag_trigger", extraTags: ["SA360::CLIENT::acct", WORKFLOW_TRIGGER_TAG] });
  assert.equal(tags.tagWrite, "add_only");
  assert.equal(tags.replacesExistingTags, false);
  assert.deepEqual(tags.tagsToAdd, [WORKFLOW_TRIGGER_TAG, "SA360::CLIENT::acct"]);
  const direct = tagModePlan({ mode: "direct_api", extraTags: ["SA360::CLIENT::acct"] });
  assert.equal(direct.tagWrite, "none");
  assert.deepEqual(direct.tagsToAdd, []);
  assert.equal(direct.enrollsByDirectApi, true);
  assert.equal(direct.replacesExistingTags, false);
});

test("intake-summary notes stay off unless explicitly enabled", () => {
  assert.equal(parseSourceEnrichmentPolicyJson({}).intakeSummaryNotesEnabled, false);
  assert.equal(parseSourceEnrichmentPolicyJson({ intakeSummaryNotesEnabled: "true" }).intakeSummaryNotesEnabled, false);
  assert.equal(parseSourceEnrichmentPolicyJson({ intakeSummaryNotesEnabled: true }).intakeSummaryNotesEnabled, true);
  const disabled = planIntakeSummaryNote({
    enabled: false,
    sourceLeadEventId: "lead_1",
    idempotencyKey: "run_1",
    sourceAttributes: { primary_reason: "Family" },
  });
  assert.deepEqual(disabled, { enabled: false, reason: "disabled" });
  const enabled = planIntakeSummaryNote({
    enabled: true,
    sourceLeadEventId: "lead_1",
    clientAccountId: "client_1",
    firstName: "Sam",
    lastName: "Veteran",
    leadType: "VET",
    sourceAttributes: { date_of_birth: "1955-03-13", primary_reason: "Family" },
    generatedAt: "2026-03-13T12:00:00.000Z",
    idempotencyKey: "run_1",
  });
  assert.equal(enabled.enabled, true);
  assert.equal("plan" in enabled, true);
  if (!("plan" in enabled)) return;
  assert.equal(enabled.plan.parts[0]?.title, "SA360 lead");
  assert.match(enabled.plan.parts[0]?.body ?? "", /1955-03-13|03\/13\/1955|March 13, 1955/);
  assert.equal(enabled.plan.parts[0]?.idempotencyKey, "run_1:note:1");
});

test("remote outcomes retry only before a completed or ambiguous call", () => {
  assert.equal(
    classifyRemoteOutcome({ attempted: false, httpStatus: null, ok: false, externalId: null, requiresExternalId: true }),
    "failed_before_send"
  );
  assert.equal(
    classifyRemoteOutcome({ attempted: true, httpStatus: 0, ok: false, externalId: null, requiresExternalId: true }),
    "ambiguous"
  );
  assert.equal(
    classifyRemoteOutcome({ attempted: true, httpStatus: 200, ok: true, externalId: null, requiresExternalId: true }),
    "ambiguous"
  );
  assert.equal(
    classifyRemoteOutcome({ attempted: true, httpStatus: 422, ok: false, externalId: null, requiresExternalId: false }),
    "rejected"
  );
  assert.equal(
    classifyRemoteOutcome({ attempted: true, httpStatus: 500, ok: false, externalId: null, requiresExternalId: false }),
    "ambiguous"
  );
  assert.equal(retryDecision(null), "execute");
  assert.equal(
    retryDecision({ operation: "contact", idempotencyKey: "k", outcome: "completed", externalId: "c1", httpStatus: 200 }),
    "skip_completed"
  );
  assert.equal(
    retryDecision({ operation: "contact", idempotencyKey: "k", outcome: "ambiguous", externalId: null, httpStatus: 0 }),
    "hold_ambiguous"
  );
  assert.equal(
    retryDecision({ operation: "workflow", idempotencyKey: "k", outcome: "rejected", externalId: null, httpStatus: 422 }),
    "hold_rejected"
  );
  assert.equal(
    retryDecision({
      operation: "source_attributes",
      idempotencyKey: "k",
      outcome: "failed_before_send",
      externalId: null,
      httpStatus: null,
    }),
    "execute"
  );
  assert.equal(
    deliveryRetryDisposition({
      status: "failed",
      stepRuns: [
        { stepType: "create_or_update_contact", status: "succeeded", externalId: "c1", responseRedactedJson: { externalCallExecuted: true } },
        { stepType: "stamp_source_attributes", status: "failed", errorCode: "validation", responseRedactedJson: { externalCallExecuted: false } },
      ],
    }),
    "resume"
  );
  assert.equal(
    deliveryRetryDisposition({
      status: "failed",
      stepRuns: [{ stepType: "create_or_update_contact", status: "failed", errorCode: "http_0", responseRedactedJson: { externalCallExecuted: true } }],
    }),
    "hold"
  );
});

test("contact, note, and workflow results stay separate", () => {
  const split = separateDeliveryResults([
    {
      stepType: "create_or_update_contact",
      status: "succeeded",
      responseRedactedJson: {
        externalCallExecuted: true,
        vetOperationReceipt: { operation: "contact", idempotencyKey: "k:contact", outcome: "completed", externalId: "c1", httpStatus: 200 },
      },
    },
    {
      stepType: "write_intake_summary_note",
      status: "optional_failed",
      responseRedactedJson: {
        externalCallExecuted: true,
        vetOperationReceipt: { operation: "note", idempotencyKey: "k:note:1", outcome: "ambiguous", externalId: null, httpStatus: 500 },
      },
    },
    {
      stepType: "start_workflow",
      status: "succeeded",
      responseRedactedJson: {
        externalCallExecuted: true,
        vetOperationReceipt: { operation: "workflow", idempotencyKey: "k:workflow", outcome: "completed", externalId: "c1", httpStatus: 200 },
      },
    },
  ]);
  assert.deepEqual(split, { contact: "upserted", note: "ambiguous", workflow: "enrolled" });

  const blocked = separateDeliveryResults([
    {
      stepType: "create_or_update_contact",
      status: "succeeded",
      responseRedactedJson: { replayedFromReceipt: true, vetOperationReceipt: { operation: "contact", idempotencyKey: "k", outcome: "completed", externalId: "c1", httpStatus: 200 } },
    },
    {
      stepType: "start_workflow",
      status: "skipped",
      responseRedactedJson: { workflowBlocked: true, vetOperationReceipt: { operation: "workflow", idempotencyKey: "k", outcome: "failed_before_send", externalId: null, httpStatus: null } },
    },
  ]);
  assert.deepEqual(blocked, { contact: "replayed", note: "disabled", workflow: "blocked" });
});
