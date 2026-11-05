import test from "node:test";
import assert from "node:assert/strict";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { executeLiveCanaryGhlSteps } from "./ghl-live-canary-executor.service.js";
import type { GhlLiveHttpDeps } from "./ghl-live-transport.js";
import {
  enableLiveCanaryRuntimeForTests,
  resetDeliveryRuntimeTestState,
} from "../../test/delivery-runtime-mode-test-helpers.js";

test.afterEach(() => {
  resetDeliveryRuntimeTestState();
});

type Call = { method: string; url: string; body: Record<string, unknown> | null };

function arm(): void {
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
  enableLiveCanaryRuntimeForTests();
}

function harness(assignedTo: string | null): { deps: GhlLiveHttpDeps; calls: Call[] } {
  const calls: Call[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url: String(input),
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      };
      calls.push(call);
      if (call.url.includes("/contacts/upsert")) {
        return new Response(JSON.stringify({ contact: { id: "contact_vet", assignedTo } }), { status: 200 });
      }
      if (call.url.includes("/opportunities")) {
        return new Response(JSON.stringify({ opportunity: { id: "opp_should_not_exist" } }), { status: 200 });
      }
      if (call.url.includes("/workflow/")) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
  return { deps, calls };
}

function ctx(ownerId: string | null): GhlAdapterPlanContext {
  return {
    plan: {
      id: "plan_lal",
      routingDryRunDecisionId: "dec_1",
      masterClientAccountId: "lal_master_vet",
      sourceLeadUid: "lead_lal",
      sourceContactIdGhl: null,
      sourcePhoneE164: "+15551234567",
      sourceEmail: "vet@example.com",
      destinationClientAccountId: "client_new",
      destinationSubaccountIdGhl: "loc_new",
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
      steps: [
        {
          id: "step_names",
          deliveryPlanId: "plan_lal",
          stepOrder: 0,
          stepType: "normalize_lead",
          status: "planned",
          title: "Names",
          description: null,
          targetSystem: "ghl",
          targetId: null,
          requestPreviewJson: { firstName: "Matt", lastName: "Agent" },
          resultPreviewJson: null,
          warnings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    rule: {
      id: "rule_lal",
      destinationWorkflowIdGhl: "wf_location_webform",
      destinationPipelineIdGhl: "pipe_vet",
      destinationPipelineStageIdGhl: "stage_new_lead",
      defaultAssignedUserIdGhl: ownerId,
      opportunityCreationEnabled: true,
      nicheKey: "vet",
      sourcePlatform: "meta",
    } as GhlAdapterPlanContext["rule"],
    destinationFieldMapping: {
      sa360CustomFieldIdMapJson: {},
      customFieldStampRequired: false,
      ownerAssignmentRequired: false,
      workflowStartRequired: false,
      workflowTriggerMode: "direct_api",
      sourceEnrichmentPolicyJson: {
        lalAiBot1VetWebform: true,
        lalAiBot1PrimaryUserId: "user_primary_1",
      },
      discoveredCustomFields: [
        {
          id: "reasonField01",
          name: "Vet - Primary Reason",
          key: "primary_reason",
          fieldKey: "contact.primary_reason",
          dataType: "TEXT",
        },
      ],
    },
    sourceEnrichment: {
      sourceAttributes: { primary_reason: "Family" },
      enrichmentStatus: "partial",
      automationReadiness: "limited",
      unmappedSourceFieldKeys: [],
      sourceAttributeFieldMap: {
        primary_reason: { ghlFieldKey: "reasonField01", requirement: "optional" },
      },
      sourceEnrichmentPolicy: { lalAiBot1VetWebform: true, lalAiBot1PrimaryUserId: "user_primary_1" },
    },
  };
}

function indexOf(calls: Call[], predicate: (call: Call) => boolean): number {
  return calls.findIndex(predicate);
}

test("webform delivery writes the contact and survey answer, assigns the selected owner, and enrolls once", async () => {
  arm();
  const { deps, calls } = harness(null);
  const result = await executeLiveCanaryGhlSteps(ctx("user_agent_1"), "idem_lal_owner", deps, {
    emitLifecycle: async () => {},
  });
  const upsertAt = indexOf(calls, (call) => call.url.includes("/contacts/upsert"));
  const surveyAt = indexOf(calls, (call) => Array.isArray(call.body?.customFields));
  const ownerAt = indexOf(calls, (call) => call.method === "PUT" && call.body?.assignedTo === "user_agent_1");
  const workflowAt = indexOf(calls, (call) => call.url.includes("/workflow/wf_location_webform"));
  assert.ok(upsertAt >= 0 && surveyAt > upsertAt && ownerAt > surveyAt && workflowAt > ownerAt);
  assert.equal(calls.filter((call) => call.url.includes("/workflow/")).length, 1);
  assert.equal(calls.filter((call) => call.url.includes("/opportunities")).length, 0);
  assert.equal(calls[upsertAt]?.body?.firstName, "Matt");
  assert.equal("timezone" in (calls[upsertAt]?.body ?? {}), false);
  assert.equal(
    calls.some((call) => Array.isArray(call.body?.tags) && (call.body.tags as string[]).some((tag) => tag.toLowerCase() === "vet")),
    false
  );
  assert.equal(result.workflowResult, "enrolled");
  assert.equal(result.workflowStarted, true);
  assert.equal(result.contactResult, "upserted");
});

test("an existing contact owner is kept and the primary user is used only when none is selected", async () => {
  arm();
  const kept = harness("user_manual_1");
  const keptResult = await executeLiveCanaryGhlSteps(ctx("user_agent_1"), "idem_lal_keep", kept.deps, {
    emitLifecycle: async () => {},
  });
  assert.equal(kept.calls.some((call) => call.body?.assignedTo === "user_agent_1"), false);
  assert.equal(kept.calls.filter((call) => call.url.includes("/workflow/")).length, 1);
  assert.equal(keptResult.stepOutcomes.find((step) => step.stepType === "assign_owner")?.errorSummary, "Existing contact owner was left unchanged.");

  const primary = harness(null);
  await executeLiveCanaryGhlSteps(ctx(null), "idem_lal_primary", primary.deps, {
    emitLifecycle: async () => {},
  });
  const owner = primary.calls.find((call) => call.body?.assignedTo);
  assert.equal(owner?.body?.assignedTo, "user_primary_1");
  assert.equal(primary.calls.filter((call) => call.url.includes("/workflow/")).length, 1);
  assert.equal(primary.calls.filter((call) => call.url.includes("/opportunities")).length, 0);
});
