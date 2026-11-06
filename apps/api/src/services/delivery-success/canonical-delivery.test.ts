import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalCompanySheetsDelivery,
  canonicalGhlDelivery,
  type CompanySheetsCanonicalInput,
  type GhlCanonicalInput,
  type GhlCanonicalStep,
} from "./canonical-delivery.js";

const CLIENT = "client_a";
const EVENT = "evt_campaign_1";
const CUTOFF = new Date("2026-10-01T00:00:00.000Z");
const APPENDED = new Date("2026-10-02T15:00:00.000Z");
const FINISHED = new Date("2026-10-02T15:04:00.000Z");
const COMPLETING = new Date("2026-10-03T18:10:00.000Z");

function campaignJob(): Extract<CompanySheetsCanonicalInput, { evidence: "campaign_job" }> {
  return {
    evidence: "campaign_job",
    job: {
      id: "job_1",
      kind: "lead",
      status: "succeeded",
      clientAccountId: CLIENT,
      sourceLeadEventId: EVENT,
      rowsWritten: 1,
      appendStartedAt: APPENDED,
      finishedAt: FINISHED,
    },
    rows: [{ jobId: "job_1", status: "written" }],
    destination: { clientAccountId: CLIENT, campaignDispatchNotBefore: CUTOFF },
    intent: {
      kind: "campaign_lead",
      clientAccountId: CLIENT,
      sourceLeadEventId: EVENT,
      createdAt: CUTOFF,
    },
    spreadsheetDeliveredAt: null,
  };
}

function receipt(operation: string, outcome: string, externalId: string | null, idempotencyKey = `assoc:${operation}`) {
  return {
    externalCallExecuted: true,
    vetOperationReceipt: {
      operation,
      outcome,
      externalId,
      httpStatus: outcome === "completed" ? 200 : 500,
      idempotencyKey,
    },
  };
}

function step(
  stepType: string,
  status: string,
  externalId: string | null,
  responseRedactedJson: unknown
): GhlCanonicalStep {
  return { stepType, status, externalId, responseRedactedJson };
}

function qualifyingSteps(options?: { notes?: boolean; workflow?: "enrolled" | "replayed" | "skipped" | "absent"; contact?: "upserted" | "replayed" }): GhlCanonicalStep[] {
  const notes = options?.notes ?? true;
  const workflow = options?.workflow ?? "enrolled";
  const contact = options?.contact ?? "upserted";
  const steps: GhlCanonicalStep[] = [
    step(
      "create_or_update_contact",
      "succeeded",
      "contact_1",
      contact === "replayed"
        ? { replayedFromReceipt: true, ...receipt("contact", "completed", "contact_1") }
        : receipt("contact", "completed", "contact_1")
    ),
  ];
  if (notes) {
    steps.push(step("write_intake_summary_note", "succeeded", "note_1", receipt("note", "completed", "note_1")));
  }
  if (workflow === "enrolled") {
    steps.push(step("start_workflow", "succeeded", "contact_1", receipt("workflow", "completed", "contact_1")));
  } else if (workflow === "replayed") {
    steps.push(
      step("start_workflow", "succeeded", "contact_1", {
        replayedFromReceipt: true,
        ...receipt("workflow", "completed", "contact_1"),
      })
    );
  } else if (workflow === "skipped") {
    steps.push(
      step("start_workflow", "skipped", null, {
        externalCallExecuted: false,
        vetOperationReceipt: {
          operation: "workflow",
          outcome: "skipped",
          externalId: null,
          httpStatus: null,
          idempotencyKey: "assoc:workflow",
        },
      })
    );
  }
  return steps;
}

function ghlRun(options?: {
  notes?: boolean;
  workflowRequired?: boolean;
  workflow?: "enrolled" | "replayed" | "skipped" | "absent";
  contact?: "upserted" | "replayed";
}): GhlCanonicalInput {
  const notes = options?.notes ?? true;
  return {
    run: {
      id: "run_1",
      mode: "ongoing_association",
      status: "succeeded",
      completedAt: COMPLETING,
      destinationClientAccountId: CLIENT,
      idempotencyKey: "ghl-association:evt_campaign_1",
    },
    steps: qualifyingSteps({ notes, workflow: options?.workflow, contact: options?.contact }),
    destination: { clientAccountId: CLIENT, workflowStartRequired: options?.workflowRequired ?? true },
    profile: { clientAccountId: CLIENT, notesEnabled: notes },
    outbox: {
      status: "settled",
      clientAccountId: CLIENT,
      sourceLeadEventId: EVENT,
      externalCallExecuted: true,
      lastError: null,
      liveRunId: "run_1",
    },
    onboardingTestAttemptId: null,
  };
}

test("a completed company Sheets campaign delivery is canonical", () => {
  const verdict = canonicalCompanySheetsDelivery({
    ...campaignJob(),
    spreadsheetDeliveredAt: new Date("2026-10-05T12:00:00.000Z"),
  });
  assert.deepEqual(verdict, {
    channel: "company_sheets",
    receiptId: "job_1",
    sourceLeadEventId: EVENT,
    canonical: true,
    at: FINISHED.toISOString(),
    reasons: [],
  });
});

test("Sheets cutoff equality is accepted and an earlier intent is not", () => {
  assert.equal(canonicalCompanySheetsDelivery(campaignJob()).canonical, true);
  const early = campaignJob();
  early.intent = {
    kind: "campaign_lead",
    clientAccountId: CLIENT,
    sourceLeadEventId: EVENT,
    createdAt: new Date(CUTOFF.getTime() - 1),
  };
  const verdict = canonicalCompanySheetsDelivery(early);
  assert.equal(verdict.canonical, false);
  assert.deepEqual(verdict.reasons, ["cutoff_not_satisfied"]);
});

test("Sheets test, probe, incomplete, and aged-release evidence is not canonical", () => {
  const cases: Array<{ name: string; input: CompanySheetsCanonicalInput; reason: string }> = [
    { name: "canary", input: jobWith({ kind: "canary" }), reason: "kind_canary" },
    { name: "campaign test", input: jobWith({ kind: "campaign_test" }), reason: "kind_campaign_test" },
    {
      name: "captured test",
      input: jobWith({ kind: "onboarding_captured_test" }),
      reason: "kind_onboarding_captured_test",
    },
    { name: "aged release", input: jobWith({ kind: "aged_release" }), reason: "kind_aged_release" },
    { name: "queued", input: jobWith({ status: "queued" }), reason: "status_queued" },
    { name: "running", input: jobWith({ status: "running" }), reason: "status_running" },
    { name: "retryable", input: jobWith({ status: "retryable" }), reason: "status_retryable" },
    { name: "uncertain", input: jobWith({ status: "uncertain", appendStartedAt: null }), reason: "status_uncertain" },
    { name: "no rows written", input: jobWith({ rowsWritten: 0 }, { rows: [] }), reason: "rows_written_missing" },
    { name: "pending row", input: jobWith({}, { rows: [{ status: "pending" }] }), reason: "row_not_written" },
    {
      name: "short write",
      input: jobWith({ rowsWritten: 2 }, { rows: [{ status: "written" }] }),
      reason: "rows_not_confirmed",
    },
    { name: "missing append", input: jobWith({ appendStartedAt: null }), reason: "append_started_at_missing" },
    { name: "missing finish", input: jobWith({ finishedAt: null }), reason: "finished_at_missing" },
    {
      name: "client mismatch",
      input: jobWith({}, { destination: { clientAccountId: "other", campaignDispatchNotBefore: CUTOFF } }),
      reason: "client_mismatch",
    },
    {
      name: "intent client",
      input: jobWith({}, {
        intent: { kind: "campaign_lead", clientAccountId: "other", sourceLeadEventId: EVENT, createdAt: CUTOFF },
      }),
      reason: "dispatch_intent_client_mismatch",
    },
    {
      name: "aged intent",
      input: jobWith({}, {
        intent: { kind: "aged_release", clientAccountId: CLIENT, sourceLeadEventId: EVENT, createdAt: CUTOFF },
      }),
      reason: "dispatch_intent_kind",
    },
    { name: "missing intent", input: jobWith({}, { intent: null }), reason: "dispatch_intent_missing" },
    { name: "missing cutoff", input: jobWith({}, { destination: { clientAccountId: CLIENT, campaignDispatchNotBefore: null } }), reason: "cutoff_missing" },
    {
      name: "other event",
      input: jobWith({}, {
        intent: { kind: "campaign_lead", clientAccountId: CLIENT, sourceLeadEventId: "evt_other", createdAt: CUTOFF },
      }),
      reason: "dispatch_intent_event_mismatch",
    },
    { name: "synthetic event", input: jobWith({ sourceLeadEventId: "synthetic-campaign-test" }, {
      intent: {
        kind: "campaign_lead",
        clientAccountId: CLIENT,
        sourceLeadEventId: "synthetic-campaign-test",
        createdAt: CUTOFF,
      },
    }), reason: "synthetic_campaign_test" },
    { name: "permission probe", input: { evidence: "permission_probe" }, reason: "permission_probe" },
    { name: "header write", input: { evidence: "header_write" }, reason: "header_write_only" },
    {
      name: "operator timestamp",
      input: { evidence: "spreadsheet_delivered_at", at: new Date("2026-10-05T12:00:00.000Z") },
      reason: "spreadsheet_delivered_at",
    },
  ];

  for (const entry of cases) {
    const verdict = canonicalCompanySheetsDelivery(entry.input);
    assert.equal(verdict.canonical, false, entry.name);
    assert.equal(verdict.channel, "company_sheets", entry.name);
    assert.ok(verdict.reasons.includes(entry.reason), `${entry.name}: ${verdict.reasons.join(",")}`);
  }
});

test("a Sheets job that became uncertain after the append started is not canonical", () => {
  const verdict = canonicalCompanySheetsDelivery(jobWith({ status: "uncertain" }));
  assert.equal(verdict.canonical, false);
  assert.deepEqual(verdict.reasons, ["status_uncertain", "uncertain_after_append"]);
});

test("a qualifying ongoing_association GHL run is canonical", () => {
  const verdict = canonicalGhlDelivery(ghlRun());
  assert.deepEqual(verdict, {
    channel: "ghl_location_api",
    receiptId: "run_1",
    sourceLeadEventId: EVENT,
    canonical: true,
    at: COMPLETING.toISOString(),
    reasons: [],
  });
});

test("replayed contact and workflow are canonical, and a skipped workflow is canonical when it is not required", () => {
  assert.equal(
    canonicalGhlDelivery(ghlRun({ contact: "replayed", workflow: "replayed" })).canonical,
    true
  );
  const skipped = canonicalGhlDelivery(ghlRun({ notes: false, workflowRequired: false, workflow: "skipped" }));
  assert.equal(skipped.canonical, true);
  assert.deepEqual(skipped.reasons, []);
  const absent = canonicalGhlDelivery(ghlRun({ notes: false, workflowRequired: false, workflow: "absent" }));
  assert.equal(absent.canonical, true);
});

test("GHL location_api, partial success, and test runs are not canonical", () => {
  const cases: Array<{ name: string; mutate: (input: GhlCanonicalInput) => void; reason: string }> = [
    { name: "location api", mutate: (input) => { input.run.mode = "location_api"; }, reason: "mode_location_api" },
    { name: "live canary", mutate: (input) => { input.run.mode = "live_canary"; }, reason: "mode_live_canary" },
    {
      name: "paused test",
      mutate: (input) => { input.run.mode = "paused_location_test"; },
      reason: "mode_paused_location_test",
    },
    {
      name: "partial success",
      mutate: (input) => { input.run.status = "partial_success"; },
      reason: "status_partial_success",
    },
    { name: "executing", mutate: (input) => { input.run.status = "executing"; }, reason: "status_executing" },
    { name: "failed", mutate: (input) => { input.run.status = "failed"; }, reason: "status_failed" },
    {
      name: "skipped duplicate",
      mutate: (input) => { input.run.status = "skipped_duplicate"; },
      reason: "status_skipped_duplicate",
    },
    {
      name: "onboarding attempt",
      mutate: (input) => { input.onboardingTestAttemptId = "attempt_1"; },
      reason: "onboarding_test_attempt",
    },
    {
      name: "onboarding key",
      mutate: (input) => { input.run.idempotencyKey = "onboarding-test:run_1:ghl-contact"; },
      reason: "onboarding_test_attempt",
    },
    {
      name: "missing completion",
      mutate: (input) => { input.run.completedAt = null; },
      reason: "completed_at_missing",
    },
    {
      name: "destination client",
      mutate: (input) => {
        if (input.destination) input.destination.clientAccountId = "other";
      },
      reason: "client_mismatch",
    },
    {
      name: "required workflow skipped",
      mutate: (input) => {
        input.steps[2] = step("start_workflow", "skipped", null, {
          externalCallExecuted: false,
          vetOperationReceipt: {
            operation: "workflow",
            outcome: "skipped",
            externalId: null,
            httpStatus: null,
            idempotencyKey: "assoc:workflow",
          },
        });
      },
      reason: "workflow_not_enrolled",
    },
    {
      name: "required note absent",
      mutate: (input) => {
        input.steps = input.steps.filter((item) => item.stepType !== "write_intake_summary_note");
      },
      reason: "note_not_satisfied",
    },
  ];
  for (const entry of cases) {
    const input = ghlRun();
    entry.mutate(input);
    const verdict = canonicalGhlDelivery(input);
    assert.equal(verdict.canonical, false, entry.name);
    assert.equal(verdict.channel, "ghl_location_api", entry.name);
    assert.ok(verdict.reasons.includes(entry.reason), `${entry.name}: ${verdict.reasons.join(",")}`);
  }
});

test("HTTP 2xx without a contact receipt or contact id is not canonical", () => {
  const acceptedWithoutId = ghlRun();
  acceptedWithoutId.steps[0] = step("create_or_update_contact", "succeeded", null, {
    externalCallExecuted: true,
    httpStatus: 200,
    vetOperationReceipt: {
      operation: "contact",
      outcome: "completed",
      externalId: null,
      httpStatus: 200,
      idempotencyKey: "assoc:contact",
    },
  });
  const missingId = canonicalGhlDelivery(acceptedWithoutId);
  assert.equal(missingId.canonical, false);
  assert.ok(missingId.reasons.includes("contact_external_id_missing"));

  const httpOnly = ghlRun();
  httpOnly.steps[0] = step("create_or_update_contact", "succeeded", "contact_1", {
    externalCallExecuted: true,
    httpStatus: 200,
  });
  const inferred = canonicalGhlDelivery(httpOnly);
  assert.equal(inferred.canonical, false);
  assert.deepEqual(inferred.reasons, ["contact_not_proven"]);
});

test("a note id or a contact upsert does not prove workflow enrollment", () => {
  const noteAsWorkflow = ghlRun();
  noteAsWorkflow.steps[2] = step("start_workflow", "succeeded", "note_1", {
    httpStatus: 200,
    ...receipt("note", "completed", "note_1"),
  });
  const noteProof = canonicalGhlDelivery(noteAsWorkflow);
  assert.equal(noteProof.canonical, false);
  assert.deepEqual(noteProof.reasons, ["workflow_not_proven"]);

  const contactOnly = ghlRun();
  contactOnly.steps = contactOnly.steps.filter((item) => item.stepType !== "start_workflow");
  const inferred = canonicalGhlDelivery(contactOnly);
  assert.equal(inferred.canonical, false);
  assert.deepEqual(inferred.reasons, ["workflow_not_enrolled"]);
});

test("GHL ambiguous, rejected, failed, and incomplete operations are not canonical", () => {
  const ambiguous = ghlRun();
  ambiguous.steps.push(
    step("stamp_custom_fields", "optional_failed", null, receipt("custom_fields", "ambiguous", null))
  );
  assert.ok(canonicalGhlDelivery(ambiguous).reasons.includes("operation_outcome_ambiguous"));

  const rejected = ghlRun();
  rejected.steps.push(step("add_tags", "failed", null, receipt("tags", "rejected", null)));
  assert.ok(canonicalGhlDelivery(rejected).reasons.includes("operation_outcome_rejected"));

  const failed = ghlRun();
  failed.steps[1] = step("write_intake_summary_note", "failed", null, receipt("note", "failed_before_send", null));
  const failedVerdict = canonicalGhlDelivery(failed);
  assert.equal(failedVerdict.canonical, false);
  assert.ok(failedVerdict.reasons.includes("operation_outcome_failed_before_send"));
  assert.ok(failedVerdict.reasons.includes("note_not_satisfied"));

  const notesOffButSkipped = ghlRun({ notes: false, workflowRequired: false, workflow: "skipped" });
  notesOffButSkipped.steps.push(step("write_intake_summary_note", "skipped", null, receipt("note", "skipped", null)));
  assert.ok(canonicalGhlDelivery(notesOffButSkipped).reasons.includes("note_not_satisfied"));

  const workflowOptionalButBlocked = ghlRun({ workflowRequired: false });
  workflowOptionalButBlocked.steps[2] = step("start_workflow", "skipped", null, {
    workflowBlocked: true,
    ...receipt("workflow", "failed_before_send", null),
  });
  const blocked = canonicalGhlDelivery(workflowOptionalButBlocked);
  assert.equal(blocked.canonical, false);
  assert.ok(blocked.reasons.includes("workflow_not_enrolled"));
});

test("an unsettled GHL association outbox is not canonical", () => {
  const cases: Array<{ name: string; mutate: (input: GhlCanonicalInput) => void; reason: string }> = [
    { name: "missing", mutate: (input) => { input.outbox = null; }, reason: "outbox_missing" },
    { name: "uncertain", mutate: (input) => { input.outbox!.status = "uncertain"; }, reason: "outbox_uncertain" },
    { name: "executing", mutate: (input) => { input.outbox!.status = "executing"; }, reason: "outbox_executing" },
    {
      name: "not executed",
      mutate: (input) => { input.outbox!.externalCallExecuted = false; },
      reason: "outbox_not_executed",
    },
    { name: "last error", mutate: (input) => { input.outbox!.lastError = "timeout"; }, reason: "outbox_last_error" },
    { name: "other run", mutate: (input) => { input.outbox!.liveRunId = "run_other"; }, reason: "outbox_run_mismatch" },
    {
      name: "other client",
      mutate: (input) => { input.outbox!.clientAccountId = "other"; },
      reason: "outbox_client_mismatch",
    },
  ];
  for (const entry of cases) {
    const input = ghlRun();
    entry.mutate(input);
    const verdict = canonicalGhlDelivery(input);
    assert.equal(verdict.canonical, false, entry.name);
    assert.ok(verdict.reasons.includes(entry.reason), `${entry.name}: ${verdict.reasons.join(",")}`);
  }
});

function jobWith(
  job: Partial<Extract<CompanySheetsCanonicalInput, { evidence: "campaign_job" }>["job"]>,
  rest: Partial<Omit<Extract<CompanySheetsCanonicalInput, { evidence: "campaign_job" }>, "evidence" | "job">> = {}
): Extract<CompanySheetsCanonicalInput, { evidence: "campaign_job" }> {
  const input = campaignJob();
  input.job = { ...input.job, ...job };
  return { ...input, ...rest };
}
