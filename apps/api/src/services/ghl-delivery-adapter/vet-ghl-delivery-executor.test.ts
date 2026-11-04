import test from "node:test";
import assert from "node:assert/strict";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { executeLiveCanaryGhlSteps } from "./ghl-live-canary-executor.service.js";
import type { GhlLiveHttpDeps } from "./ghl-live-transport.js";
import { AUTOMATION_ENTRY_EVENT_TAG } from "./vet-ghl-delivery-contract.js";
import { WORKFLOW_TRIGGER_TAG } from "./ghl-workflow-trigger-mode.js";
import {
  enableLiveCanaryRuntimeForTests,
  resetDeliveryRuntimeTestState,
} from "../../test/delivery-runtime-mode-test-helpers.js";
import type { VetOperationReceipt } from "./vet-ghl-delivery-contract.js";

test.afterEach(() => {
  resetDeliveryRuntimeTestState();
});

function arm(): void {
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
  enableLiveCanaryRuntimeForTests();
}

type Call = { method: string; url: string; body: Record<string, unknown> | null };

function depsFrom(handler: (call: Call) => Response): { deps: GhlLiveHttpDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url: String(input),
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      calls.push(call);
      return handler(call);
    },
  };
  return { deps, calls };
}

function tagLists(calls: Call[]): string[][] {
  return calls
    .filter((call) => call.url.includes("/tags") && Array.isArray(call.body?.tags))
    .map((call) => call.body?.tags as string[]);
}

function posted(calls: Call[], tag: string): boolean {
  return tagLists(calls).some((tags) => tags.includes(tag));
}

function okHandler(call: Call): Response {
  if (call.url.includes("/contacts/upsert")) {
    return new Response(JSON.stringify({ contact: { id: "contact_existing" } }), { status: 200 });
  }
  if (call.url.includes("/notes")) {
    return new Response(JSON.stringify({ note: { id: "note_1" } }), { status: 200 });
  }
  if (call.url.includes("/opportunities")) {
    return new Response(JSON.stringify({ opportunity: { id: "opp_1" } }), { status: 200 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

function makeCtx(overrides?: {
  workflowTriggerMode?: string;
  notes?: boolean;
  idMap?: Record<string, string>;
  enrichment?: GhlAdapterPlanContext["sourceEnrichment"];
}): GhlAdapterPlanContext {
  return {
    plan: {
      id: "plan_vet",
      routingDryRunDecisionId: "dec_1",
      masterClientAccountId: "master_1",
      sourceLeadUid: "lead_vet",
      sourceContactIdGhl: null,
      sourcePhoneE164: "+15551234567",
      sourceEmail: "vet@example.com",
      destinationClientAccountId: "client_dest",
      destinationSubaccountIdGhl: "loc_dest",
      destinationClientDisplayName: null,
      nicheKey: "vet",
      productType: null,
      deliveryMode: "shadow",
      status: "planned",
      planVersion: "1.0",
      generatedAt: new Date(),
      generatedBy: "test",
      summary: null,
      warnings: null,
      lifecycleEventId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      steps: [],
    },
    rule: {
      id: "rule_1",
      masterClientAccountId: "master_1",
      clientAccountId: "client_dest",
      destinationSubaccountIdGhl: "loc_dest",
      destinationWorkflowIdGhl: "wf_1",
      destinationPipelineIdGhl: "pipe_1",
      destinationPipelineStageIdGhl: "stage_1",
      defaultAssignedUserIdGhl: "user_1",
      opportunityCreationEnabled: true,
      nicheKey: "vet",
      sourcePlatform: "meta",
    } as GhlAdapterPlanContext["rule"],
    destinationFieldMapping: {
      sa360CustomFieldIdMapJson: overrides?.idMap ?? {},
      customFieldStampRequired: false,
      ownerAssignmentRequired: false,
      workflowStartRequired: false,
      workflowTriggerMode: overrides?.workflowTriggerMode ?? "tag_trigger",
      intakeSummaryNotesEnabled: overrides?.notes === true,
    },
    sourceEnrichment: overrides?.enrichment,
  };
}

test("executor omits blank natives, writes DOB, and does not post a note by default", async () => {
  arm();
  const { deps, calls } = depsFrom(okHandler);
  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      enrichment: {
        sourceAttributes: { date_of_birth: "1955-03-13", age: "71", city: "" },
        enrichmentStatus: "partial",
        automationReadiness: "limited",
        unmappedSourceFieldKeys: [],
        sourceAttributeFieldMap: {},
        sourceEnrichmentPolicy: { intakeSummaryNotesEnabled: false },
        normalizedPayload: {
          routing: { source_intake: { sourceAttributes: { date_of_birth: "1955-03-13", age: "71" } } },
          contact: { city: " ", address1: "" },
        },
        receivedAt: "2026-03-13T12:00:00.000Z",
      },
    }),
    "idem_dob",
    deps,
    { emitLifecycle: async () => {} }
  );
  const upsert = calls.find((call) => call.url.includes("/contacts/upsert"));
  assert.ok(upsert?.body);
  assert.equal(upsert.body.dateOfBirth, "1955-03-13");
  assert.equal(upsert.body.source, "sa360");
  assert.equal("city" in upsert.body, false);
  assert.equal("address1" in upsert.body, false);
  assert.equal("age" in upsert.body, false);
  assert.equal("customFields" in upsert.body, false);
  assert.equal(calls.some((call) => call.url.includes("/notes")), false);
  assert.equal(result.noteResult, "disabled");
  assert.equal(result.contactResult, "upserted");
  assert.equal(posted(calls, AUTOMATION_ENTRY_EVENT_TAG), true);
  const workflowTags = calls.filter((call) => call.url.includes("/tags") && Array.isArray(call.body?.tags) && (call.body.tags as string[]).includes(WORKFLOW_TRIGGER_TAG));
  assert.equal(workflowTags.length, 1);
  assert.equal(workflowTags[0]?.method, "POST");
  const workflow = result.stepOutcomes.find((step) => step.stepType === "start_workflow");
  const response = workflow?.responseRedactedJson as { tagWrite?: string; replacesExistingTags?: boolean };
  assert.equal(response.tagWrite, "add_only");
  assert.equal(response.replacesExistingTags, false);
});

test("direct API enrollment does not add the trigger tag", async () => {
  arm();
  const { deps, calls } = depsFrom(okHandler);
  const result = await executeLiveCanaryGhlSteps(
    makeCtx({ workflowTriggerMode: "direct_api" }),
    "idem_direct",
    deps,
    { emitLifecycle: async () => {} }
  );
  assert.equal(calls.some((call) => call.url.includes("/workflow/")), true);
  assert.equal(
    calls.some((call) => Array.isArray(call.body?.tags) && (call.body.tags as string[]).includes(WORKFLOW_TRIGGER_TAG)),
    false
  );
  assert.equal(result.workflowResult, "enrolled");
  assert.equal(result.workflowStarted, true);
});

test("duplicate custom-field targets do not write either value and block workflow", async () => {
  arm();
  const shared = "abc123XYZ78901";
  const { deps, calls } = depsFrom(okHandler);
  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      idMap: { sa360_lead_uid: shared, sa360_lifecycle_stage: shared },
    }),
    "idem_collision",
    deps,
    { emitLifecycle: async () => {} }
  );
  assert.equal(calls.some((call) => call.body && "customFields" in call.body), false);
  assert.equal(calls.some((call) => call.url.includes("/workflow/")), false);
  assert.equal(
    calls.some((call) => Array.isArray(call.body?.tags) && (call.body.tags as string[]).includes(WORKFLOW_TRIGGER_TAG)),
    false
  );
  assert.equal(result.runStatus, "failed");
  assert.equal(result.workflowResult, "blocked");
  assert.equal(result.contactResult, "upserted");
  assert.equal(posted(calls, AUTOMATION_ENTRY_EVENT_TAG), false);
  assert.equal(posted(calls, "SA360::NICHE::VET"), true);
});

test("a completed contact is not upserted again", async () => {
  arm();
  const prior: VetOperationReceipt = {
    operation: "contact",
    idempotencyKey: "idem_replay:contact",
    outcome: "completed",
    externalId: "contact_kept",
    httpStatus: 200,
  };
  const { deps, calls } = depsFrom(okHandler);
  const result = await executeLiveCanaryGhlSteps(makeCtx(), "idem_replay", deps, {
    emitLifecycle: async () => {},
    priorReceipts: [prior],
  });
  assert.equal(calls.some((call) => call.url.includes("/contacts/upsert")), false);
  assert.equal(result.contactIdGhl, "contact_kept");
  assert.equal(result.contactResult, "replayed");
});

test("an ambiguous contact outcome is not repeated", async () => {
  arm();
  const { deps, calls } = depsFrom(okHandler);
  const result = await executeLiveCanaryGhlSteps(makeCtx(), "idem_hold", deps, {
    emitLifecycle: async () => {},
    priorReceipts: [
      {
        operation: "contact",
        idempotencyKey: "idem_hold:contact",
        outcome: "ambiguous",
        externalId: null,
        httpStatus: 0,
      },
    ],
  });
  assert.equal(calls.length, 0);
  assert.equal(result.contactResult, "ambiguous");
  assert.equal(result.workflowResult, "not_enrolled");
  assert.equal(result.runStatus, "failed");
});

test("a note failure stays separate and is not transport-retried", async () => {
  arm();
  const { deps, calls } = depsFrom((call) => {
    if (call.url.includes("/notes")) return new Response("upstream", { status: 500 });
    return okHandler(call);
  });
  const result = await executeLiveCanaryGhlSteps(makeCtx({ notes: true }), "idem_note", deps, {
    emitLifecycle: async () => {},
  });
  assert.equal(calls.filter((call) => call.url.includes("/notes")).length, 1);
  assert.equal(result.contactResult, "upserted");
  assert.equal(result.noteResult, "ambiguous");
  assert.equal(result.workflowResult, "enrolled");
  assert.equal(result.runStatus, "partial_success");
  const note = calls.find((call) => call.url.includes("/notes"));
  assert.equal(note?.body?.title, "SA360 lead");
  assert.equal(typeof note?.body?.body, "string");
});

function requiredFieldContext(workflowTriggerMode: "tag_trigger" | "direct_api"): GhlAdapterPlanContext {
  const ctx = makeCtx({
    workflowTriggerMode,
    enrichment: {
      sourceAttributes: { primary_reason: " " },
      enrichmentStatus: "partial",
      automationReadiness: "ready",
      unmappedSourceFieldKeys: [],
      sourceAttributeFieldMap: {
        primary_reason: { ghlFieldKey: "fieldReason01", requirement: "delivery_required" },
      },
      sourceEnrichmentPolicy: { intakeSummaryNotesEnabled: false },
    },
  });
  ctx.destinationFieldMapping = {
    ...ctx.destinationFieldMapping!,
    discoveredCustomFields: [
      {
        id: "fieldReason01",
        name: "Primary Reason",
        key: "primary_reason",
        fieldKey: "contact.primary_reason",
        dataType: "TEXT",
      },
    ],
  };
  return ctx;
}

test("unresolved delivery_required withholds the event tag for both enrollment modes", async () => {
  arm();
  for (const workflowTriggerMode of ["tag_trigger", "direct_api"] as const) {
    const { deps, calls } = depsFrom(okHandler);
    const result = await executeLiveCanaryGhlSteps(
      requiredFieldContext(workflowTriggerMode),
      `idem_required_${workflowTriggerMode}`,
      deps,
      { emitLifecycle: async () => {} }
    );
    assert.equal(posted(calls, AUTOMATION_ENTRY_EVENT_TAG), false, workflowTriggerMode);
    assert.equal(posted(calls, WORKFLOW_TRIGGER_TAG), false, workflowTriggerMode);
    assert.equal(posted(calls, "SA360::TRIGGER::AI_READY"), false, workflowTriggerMode);
    assert.equal(calls.some((call) => call.url.includes("/workflow/")), false, workflowTriggerMode);
    assert.equal(posted(calls, "SA360::NICHE::VET"), true, workflowTriggerMode);
    assert.equal(result.workflowResult, "blocked", workflowTriggerMode);
    assert.equal(result.contactResult, "upserted", workflowTriggerMode);
  }
});

test("duplicate targets withhold the event tag on direct API enrollment", async () => {
  arm();
  const shared = "abc123XYZ78901";
  const { deps, calls } = depsFrom(okHandler);
  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      workflowTriggerMode: "direct_api",
      idMap: { sa360_lead_uid: shared, sa360_lifecycle_stage: shared },
    }),
    "idem_collision_direct",
    deps,
    { emitLifecycle: async () => {} }
  );
  assert.equal(posted(calls, AUTOMATION_ENTRY_EVENT_TAG), false);
  assert.equal(posted(calls, WORKFLOW_TRIGGER_TAG), false);
  assert.equal(calls.some((call) => call.url.includes("/workflow/")), false);
  assert.equal(posted(calls, "SA360::CLIENT::client_dest"), true);
  assert.equal(result.workflowResult, "blocked");
});

test("a resumed run posts a withheld event tag only after the required-write gate opens", async () => {
  arm();
  const priorTags: VetOperationReceipt = {
    operation: "tags",
    idempotencyKey: "idem_resume:tags",
    outcome: "completed",
    externalId: null,
    httpStatus: 200,
    withheldAutomationEntryTags: [AUTOMATION_ENTRY_EVENT_TAG],
  };
  const priorContact: VetOperationReceipt = {
    operation: "contact",
    idempotencyKey: "idem_resume:contact",
    outcome: "completed",
    externalId: "contact_kept",
    httpStatus: 200,
  };
  const { deps, calls } = depsFrom(okHandler);
  const opened = await executeLiveCanaryGhlSteps(makeCtx({ workflowTriggerMode: "direct_api" }), "idem_resume", deps, {
    emitLifecycle: async () => {},
    priorReceipts: [priorContact, priorTags],
  });
  assert.equal(calls.some((call) => call.url.includes("/contacts/upsert")), false);
  assert.deepEqual(
    tagLists(calls).filter((tags) => tags.includes(AUTOMATION_ENTRY_EVENT_TAG)),
    [[AUTOMATION_ENTRY_EVENT_TAG]]
  );
  assert.equal(posted(calls, "SA360::NICHE::VET"), false);
  assert.equal(calls.some((call) => call.url.includes("/workflow/")), true);
  assert.equal(opened.workflowResult, "enrolled");

  const stillBlocked = depsFrom(okHandler);
  const shared = "abc123XYZ78901";
  const held = await executeLiveCanaryGhlSteps(
    makeCtx({ idMap: { sa360_lead_uid: shared, sa360_lifecycle_stage: shared } }),
    "idem_resume_held",
    stillBlocked.deps,
    { emitLifecycle: async () => {}, priorReceipts: [priorContact, priorTags] }
  );
  assert.equal(posted(stillBlocked.calls, AUTOMATION_ENTRY_EVENT_TAG), false);
  assert.equal(posted(stillBlocked.calls, WORKFLOW_TRIGGER_TAG), false);
  assert.equal(held.workflowResult, "blocked");
});
