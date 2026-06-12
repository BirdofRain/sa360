import test from "node:test";
import assert from "node:assert/strict";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { executeLiveCanaryGhlSteps } from "./ghl-live-canary-executor.service.js";
import type { GhlLiveHttpDeps } from "./ghl-live-transport.js";
import { WORKFLOW_TRIGGER_TAG } from "./ghl-workflow-trigger-mode.js";
import { DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY } from "./ghl-live-canary-step-requirements.js";
import {
  enableLiveCanaryRuntimeForTests,
  resetDeliveryRuntimeTestState,
} from "../../test/delivery-runtime-mode-test-helpers.js";

test.afterEach(() => {
  resetDeliveryRuntimeTestState();
});

function armLiveCanaryAdapterEnv(): void {
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  enableLiveCanaryRuntimeForTests();
}

function makeCtx(overrides?: {
  defaultAssignedUserIdGhl?: string | null;
  configuredOwnerId?: string | null;
  destinationFieldMapping?: GhlAdapterPlanContext["destinationFieldMapping"] & {
    discoveredCustomFields?: GhlAdapterPlanContext["destinationFieldMapping"] extends infer T
      ? T extends { discoveredCustomFields?: infer D }
        ? D
        : never
      : never;
  };
}): GhlAdapterPlanContext {
  return {
    plan: {
      id: "plan_test",
      routingDryRunDecisionId: "dec_1",
      masterClientAccountId: "master_1",
      sourceLeadUid: "lead_1",
      sourceContactIdGhl: null,
      sourcePhoneE164: "+15551234567",
      sourceEmail: "test@example.com",
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
      steps: [
        {
          id: "step_contact",
          deliveryPlanId: "plan_test",
          stepOrder: 1,
          stepType: "create_or_update_contact",
          status: "planned",
          title: "Contact",
          description: null,
          targetSystem: "ghl",
          targetId: null,
          requestPreviewJson: null,
          resultPreviewJson: null,
          warnings: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    },
    rule: {
      id: "rule_1",
      masterClientAccountId: "master_1",
      clientAccountId: "client_dest",
      destinationSubaccountIdGhl: "loc_dest",
      destinationWorkflowIdGhl: "wf_1",
      destinationPipelineIdGhl: "pipe_1",
      destinationPipelineStageIdGhl: "stage_1",
      defaultAssignedUserIdGhl:
        overrides && "defaultAssignedUserIdGhl" in overrides
          ? overrides.defaultAssignedUserIdGhl
          : "user_1",
      opportunityCreationEnabled: true,
      nicheKey: "vet",
      sourcePlatform: "meta",
    } as GhlAdapterPlanContext["rule"],
    destinationFieldMapping: overrides?.destinationFieldMapping ?? {
      sa360CustomFieldIdMapJson: {},
      customFieldStampRequired: false,
      ownerAssignmentRequired: false,
      workflowStartRequired: false,
      workflowTriggerMode: "tag_trigger",
    },
  };
}

test("executeLiveCanaryGhlSteps stops after contact failure", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const calls: string[] = [];
  let upsertBody: Record<string, unknown> | null = null;
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/contacts/upsert")) {
        if (typeof init?.body === "string") {
          upsertBody = JSON.parse(init.body) as Record<string, unknown>;
        }
        return new Response(JSON.stringify({ message: "customFields must be an array" }), {
          status: 400,
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(makeCtx(), "idem_key_test", deps, {
    emitLifecycle: async () => {},
  });
  assert.equal(result.runStatus, "failed");
  assert.ok(calls.some((c) => c.includes("/contacts/upsert")));
  assert.ok(upsertBody);
  assert.equal("customFields" in upsertBody!, false);
  assert.equal(
    calls.filter((c) => c.includes("/tags")).length,
    0,
    "tags should not run after contact failure"
  );
  const contactStep = result.stepOutcomes.find((s) => s.stepType === "create_or_update_contact");
  assert.equal(contactStep?.errorSummary, "customFields must be an array");

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps contact upsert includes firstName and lastName without customFields", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  let upsertBody: Record<string, unknown> | null = null;
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        if (typeof init?.body === "string") {
          upsertBody = JSON.parse(init.body) as Record<string, unknown>;
        }
        return new Response(JSON.stringify({ contact: { id: "contact_named" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_named" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const ctx = makeCtx({ defaultAssignedUserIdGhl: null });
  ctx.plan.steps = [
    {
      id: "step_norm",
      deliveryPlanId: "plan_test",
      stepOrder: 1,
      stepType: "normalize_lead",
      status: "planned",
      title: "Normalize",
      description: null,
      targetSystem: "ghl",
      targetId: null,
      requestPreviewJson: {
        firstName: "Jane",
        lastName: "Demo",
        email: "test@example.com",
        phoneE164: "+15551234567",
      },
      resultPreviewJson: null,
      warnings: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    ...ctx.plan.steps,
  ];

  await executeLiveCanaryGhlSteps(ctx, "idem_names", deps, {
    emitLifecycle: async () => {},
  });

  assert.ok(upsertBody);
  const body = upsertBody as Record<string, unknown>;
  assert.equal(body.firstName, "Jane");
  assert.equal(body.lastName, "Demo");
  assert.equal("customFields" in body, false);
  assert.deepEqual(
    Object.keys(body).sort(),
    ["email", "firstName", "lastName", "locationId", "phone", "source"].sort()
  );

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps records partial_success when workflow fails", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_abc" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_1" } }), { status: 200 });
      }
      if (url.includes("/workflow/") && method === "POST") {
        return new Response(JSON.stringify({ message: "workflow failed" }), { status: 500 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      destinationFieldMapping: {
        sa360CustomFieldIdMapJson: {},
        customFieldStampRequired: false,
        ownerAssignmentRequired: false,
        workflowStartRequired: false,
        workflowTriggerMode: "direct_api",
      },
    }),
    "idem_key_test_2",
    deps,
    { emitLifecycle: async () => {} }
  );
  assert.equal(result.contactIdGhl, "contact_abc");
  assert.equal(result.runStatus, "partial_success");
  assert.equal(result.workflowStarted, false);

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

type CapturedOpportunityBody = {
  contactId?: unknown;
  locationId?: unknown;
  pipelineId?: unknown;
  pipelineStageId?: unknown;
  status?: unknown;
  name?: unknown;
  assignedTo?: unknown;
};

test("executeLiveCanaryGhlSteps passes contactId to opportunity create with name and status", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const capturedOpportunityBodies: CapturedOpportunityBody[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_xyz" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        if (typeof init?.body === "string") {
          capturedOpportunityBodies.push(JSON.parse(init.body) as CapturedOpportunityBody);
        }
        return new Response(
          JSON.stringify({ message: "pipelineStageId is invalid" }),
          { status: 422 }
        );
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({ defaultAssignedUserIdGhl: null }),
    "idem_opp_body",
    deps,
    { emitLifecycle: async () => {} }
  );

  assert.equal(result.contactIdGhl, "contact_xyz");
  assert.equal(result.runStatus, "failed");
  const opportunityBody = capturedOpportunityBodies.at(-1);
  assert.ok(opportunityBody, "expected opportunity body to be captured");
  assert.equal(opportunityBody.contactId, "contact_xyz");
  assert.equal(opportunityBody.locationId, "loc_dest");
  assert.equal(opportunityBody.pipelineId, "pipe_1");
  assert.equal(opportunityBody.pipelineStageId, "stage_1");
  assert.equal(opportunityBody.status, "open");
  assert.equal(typeof opportunityBody.name, "string");
  assert.ok(typeof opportunityBody.name === "string" && opportunityBody.name.length > 0);
  assert.equal("assignedTo" in opportunityBody, false);

  const oppStep = result.stepOutcomes.find((s) => s.stepType === "create_or_update_opportunity");
  assert.equal(oppStep?.status, "failed");
  assert.equal(oppStep?.errorSummary, "pipelineStageId is invalid");

  const wfStep = result.stepOutcomes.find((s) => s.stepType === "start_workflow");
  assert.equal(wfStep?.status, "skipped");
  assert.ok(wfStep?.errorSummary?.includes("opportunity"));

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps skips owner assignment for null and string null owner IDs", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const ownerPutCalls: string[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_owner_skip" } }), { status: 200 });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if ("assignedTo" in body) ownerPutCalls.push(String(body.assignedTo));
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_ok" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  for (const ownerId of [null, "null", "undefined", "none", ""] as const) {
    ownerPutCalls.length = 0;
    const result = await executeLiveCanaryGhlSteps(
      makeCtx({ defaultAssignedUserIdGhl: ownerId }),
      `idem_owner_${String(ownerId)}`,
      deps,
      { emitLifecycle: async () => {} }
    );
    const ownerStep = result.stepOutcomes.find((s) => s.stepType === "assign_owner");
    assert.equal(ownerStep?.status, "skipped", `owner ${String(ownerId)}`);
    assert.ok(ownerStep?.errorSummary?.includes("no valid GHL user"));
    assert.equal(ownerPutCalls.length, 0, `no owner PUT for ${String(ownerId)}`);
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps custom field stamp skipped without env map", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const prevFieldMap = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
  delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;

  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_stamp" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_stamp" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({ defaultAssignedUserIdGhl: null }),
    "idem_stamp_skip",
    deps,
    { emitLifecycle: async () => {} }
  );

  const stampStep = result.stepOutcomes.find((s) => s.stepType === "stamp_custom_fields");
  assert.equal(stampStep?.status, "skipped");
  assert.ok(
    stampStep?.errorSummary?.includes("No SA360 custom field ID mapping") ||
      stampStep?.errorSummary?.includes("custom field stamp skipped")
  );
  assert.ok(
    result.warnings.some(
      (w) =>
        w.includes("GHL_SA360_CUSTOM_FIELD_IDS_JSON") ||
        w.includes("Config Discovery")
    )
  );

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (prevFieldMap !== undefined) process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = prevFieldMap;
});

test("executeLiveCanaryGhlSteps optional owner and workflow 422 yield partial_success", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_demo" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_demo" } }), { status: 200 });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if ("assignedTo" in body) {
          return new Response(JSON.stringify({ message: "Invalid user id" }), { status: 422 });
        }
      }
      if (url.includes("/workflow/") && method === "POST") {
        return new Response(JSON.stringify({ message: "Workflow not found" }), { status: 422 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      destinationFieldMapping: {
        sa360CustomFieldIdMapJson: {},
        customFieldStampRequired: false,
        ownerAssignmentRequired: false,
        workflowStartRequired: false,
        workflowTriggerMode: "direct_api",
      },
    }),
    "idem_optional_post",
    deps,
    { emitLifecycle: async () => {} }
  );

  assert.equal(result.runStatus, "partial_success");
  assert.equal(result.summary, DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY);
  assert.equal(
    result.stepOutcomes.find((s) => s.stepType === "assign_owner")?.status,
    "optional_failed"
  );
  assert.equal(
    result.stepOutcomes.find((s) => s.stepType === "start_workflow")?.status,
    "skipped"
  );
  assert.ok(
    result.stepOutcomes.find((s) => s.stepType === "start_workflow")?.errorSummary?.includes(
      "tag-based GHL trigger"
    )
  );

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps owner failure reports configured owner id without locationId in PUT body", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const ownerPutBodies: Record<string, unknown>[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_owner_fail" } }), { status: 200 });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if ("assignedTo" in body) {
          ownerPutBodies.push(body);
          return new Response(JSON.stringify({ message: "Invalid user id" }), { status: 400 });
        }
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_1" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(makeCtx(), "idem_owner_fail", deps, {
    emitLifecycle: async () => {},
  });
  const ownerStep = result.stepOutcomes.find((s) => s.stepType === "assign_owner");
  assert.equal(ownerStep?.status, "optional_failed");
  assert.equal(ownerPutBodies.length, 1);
  assert.deepEqual(Object.keys(ownerPutBodies[0]!).sort(), ["assignedTo"]);
  assert.equal("locationId" in ownerPutBodies[0]!, false);
  assert.equal(result.runStatus, "partial_success");
  assert.equal(result.summary, DEMO_REQUIRED_PATH_PARTIAL_SUCCESS_SUMMARY);
  assert.ok(result.warnings.some((w) => w.includes("Invalid user id") || w.includes("invalid")));

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps tag_trigger adds workflow trigger tag not direct workflow API", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const tagBodies: Array<{ tags?: unknown }> = [];
  let workflowCalls = 0;
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_tag" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_tag" } }), { status: 200 });
      }
      if (url.includes("/tags") && method === "POST" && typeof init?.body === "string") {
        tagBodies.push(JSON.parse(init.body) as { tags?: unknown });
      }
      if (url.includes("/workflow/") && method === "POST") {
        workflowCalls += 1;
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({ defaultAssignedUserIdGhl: null }),
    "idem_tag_trigger",
    deps,
    { emitLifecycle: async () => {} }
  );

  assert.equal(workflowCalls, 0);
  const wfStep = result.stepOutcomes.find((s) => s.stepType === "start_workflow");
  assert.equal(wfStep?.status, "succeeded");
  assert.ok(
    tagBodies.some((b) => Array.isArray(b.tags) && b.tags.includes(WORKFLOW_TRIGGER_TAG))
  );
  assert.equal(result.stepOutcomes.find((s) => s.stepType === "create_or_update_contact")?.status, "succeeded");
  assert.equal(result.stepOutcomes.find((s) => s.stepType === "add_tags")?.status, "succeeded");
  assert.equal(
    result.stepOutcomes.find((s) => s.stepType === "create_or_update_opportunity")?.status,
    "succeeded"
  );

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps custom field stamp uses destination_config and minimal PUT body", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const prevFieldMap = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";
  process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = JSON.stringify({
    sa360_lead_uid: "env_should_not_win_12",
  });

  const putBodies: Record<string, unknown>[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_stamp" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_stamp" } }), { status: 200 });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (Array.isArray(body.customFields)) {
          putBodies.push(body);
          return new Response(
            JSON.stringify({
              message: ["property locationId should not exist"],
              error: "Unprocessable Entity",
              statusCode: 422,
            }),
            { status: 422 }
          );
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      defaultAssignedUserIdGhl: null,
      destinationFieldMapping: {
        sa360CustomFieldIdMapJson: { sa360_lead_uid: "destFieldId12345678" },
        customFieldStampRequired: false,
        ownerAssignmentRequired: false,
        workflowStartRequired: false,
        workflowTriggerMode: "tag_trigger",
      },
    }),
    "idem_stamp_body",
    deps,
    { emitLifecycle: async () => {} }
  );

  assert.equal(putBodies.length, 1);
  assert.deepEqual(Object.keys(putBodies[0]!).sort(), ["customFields"]);
  assert.equal("locationId" in putBodies[0]!, false);
  const cf = putBodies[0]!.customFields as Array<{
    id: string;
    key: string;
    field_value: string;
  }>;
  assert.ok(Array.isArray(cf));
  assert.equal(cf[0]?.id, "destFieldId12345678");
  assert.equal(cf[0]?.key, "contact.sa360_lead_uid");
  assert.equal(typeof cf[0]?.field_value, "string");
  assert.equal("value" in (cf[0] ?? {}), false);
  const stampStep = result.stepOutcomes.find((s) => s.stepType === "stamp_custom_fields");
  assert.equal(stampStep?.status, "optional_failed");
  assert.ok(stampStep?.errorSummary?.includes("property locationId should not exist"));
  assert.ok(stampStep?.errorSummary?.includes("endpoint: PUT /contacts/{contactId}"));
  assert.ok(stampStep?.errorSummary?.includes("body keys: customFields"));
  assert.ok(stampStep?.errorSummary?.includes("destination_config"));
  assert.ok(stampStep?.errorSummary?.includes("first item keys"));
  const reqMeta = stampStep?.requestRedactedJson as {
    fieldDiagnostics?: Array<{ itemKeys?: string[]; valueProperty?: string }>;
  };
  assert.deepEqual(reqMeta?.fieldDiagnostics?.[0]?.itemKeys?.sort(), [
    "field_value",
    "id",
    "key",
  ]);
  assert.equal(reqMeta?.fieldDiagnostics?.[0]?.valueProperty, "field_value");
  assert.ok(!JSON.stringify(stampStep?.requestRedactedJson).includes("Bearer"));

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  if (prevFieldMap !== undefined) process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON = prevFieldMap;
  else delete process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON;
});

test("executeLiveCanaryGhlSteps optional custom field 422 does not fail required delivery", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_optional_cf" } }), {
          status: 200,
        });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_optional_cf" } }), {
          status: 200,
        });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (Array.isArray(body.customFields)) {
          return new Response(JSON.stringify({ message: "invalid custom field" }), { status: 422 });
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      defaultAssignedUserIdGhl: null,
      destinationFieldMapping: {
        sa360CustomFieldIdMapJson: { sa360_lead_uid: "destFieldId12345678" },
        customFieldStampRequired: false,
        ownerAssignmentRequired: false,
        workflowStartRequired: false,
        workflowTriggerMode: "tag_trigger",
      },
    }),
    "idem_optional_cf",
    deps,
    { emitLifecycle: async () => {} }
  );

  assert.equal(result.stepOutcomes.find((s) => s.stepType === "create_or_update_contact")?.status, "succeeded");
  assert.equal(result.stepOutcomes.find((s) => s.stepType === "add_tags")?.status, "succeeded");
  assert.equal(
    result.stepOutcomes.find((s) => s.stepType === "create_or_update_opportunity")?.status,
    "succeeded"
  );
  assert.equal(result.stepOutcomes.find((s) => s.stepType === "stamp_custom_fields")?.status, "optional_failed");
  assert.equal(result.runStatus, "partial_success");

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps custom field 422 fails run when customFieldStampRequired", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_required_cf" } }), {
          status: 200,
        });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_required_cf" } }), {
          status: 200,
        });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as Record<string, unknown>;
        if (Array.isArray(body.customFields)) {
          return new Response(JSON.stringify({ message: "invalid custom field" }), { status: 422 });
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      defaultAssignedUserIdGhl: null,
      destinationFieldMapping: {
        sa360CustomFieldIdMapJson: { sa360_lead_uid: "destFieldId12345678" },
        customFieldStampRequired: true,
        ownerAssignmentRequired: false,
        workflowStartRequired: false,
        workflowTriggerMode: "tag_trigger",
      },
    }),
    "idem_required_cf",
    deps,
    { emitLifecycle: async () => {} }
  );

  assert.equal(result.stepOutcomes.find((s) => s.stepType === "stamp_custom_fields")?.status, "failed");
  assert.ok(result.errors.some((e) => e.includes("invalid custom field")));

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps stamps TEXT first and partial_success when option fields skipped", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const putBodies: Array<{ customFields: unknown[] }> = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_typed" } }), { status: 200 });
      }
      if (url.includes("/opportunities") && method === "POST") {
        return new Response(JSON.stringify({ opportunity: { id: "opp_typed" } }), { status: 200 });
      }
      if (method === "PUT" && url.includes("/contacts/") && typeof init?.body === "string") {
        const body = JSON.parse(init.body) as { customFields?: unknown[] };
        if (Array.isArray(body.customFields)) {
          putBodies.push({ customFields: body.customFields });
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(
    makeCtx({
      defaultAssignedUserIdGhl: null,
      destinationFieldMapping: {
        sa360CustomFieldIdMapJson: {
          sa360_lead_uid: "textFieldId123456",
          sa360_routing_status: "optionFieldId12345",
        },
        discoveredCustomFields: [
          {
            id: "textFieldId123456",
            name: "sa360_lead_uid",
            key: null,
            fieldKey: "contact.sa360_lead_uid",
            dataType: "TEXT",
          },
          {
            id: "optionFieldId12345",
            name: "sa360_routing_status",
            key: null,
            fieldKey: "contact.sa360_routing_status",
            dataType: "SINGLE_OPTIONS",
          },
        ],
        customFieldStampRequired: false,
        ownerAssignmentRequired: false,
        workflowStartRequired: false,
        workflowTriggerMode: "tag_trigger",
      },
    }),
    "idem_typed_stamp",
    deps,
    { emitLifecycle: async () => {} }
  );

  assert.equal(putBodies.length, 1);
  assert.equal((putBodies[0]?.customFields[0] as { id?: string })?.id, "textFieldId123456");
  const stampStep = result.stepOutcomes.find((s) => s.stepType === "stamp_custom_fields");
  assert.equal(stampStep?.status, "partial_success");
  assert.equal(result.runStatus, "partial_success");
  assert.equal(result.stepOutcomes.find((s) => s.stepType === "add_tags")?.status, "succeeded");

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("webhook route does not import live canary executor", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const webhookPath = join(dirname(fileURLToPath(import.meta.url)), "../../routes/webhook.ts");
  const src = readFileSync(webhookPath, "utf8");
  assert.doesNotMatch(src, /ghl-live-canary|executeLiveCanaryForPlan|ghl-live\/canary/);
});
