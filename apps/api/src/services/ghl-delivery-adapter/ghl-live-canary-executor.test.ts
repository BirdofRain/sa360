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

function armLiveCanaryAdapterEnv(): void {
  process.env.GHL_DELIVERY_ADAPTER_MAX_MODE = "live_canary";
  delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  enableLiveCanaryRuntimeForTests();
}

function makeCtx(overrides?: { defaultAssignedUserIdGhl?: string | null }): GhlAdapterPlanContext {
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

  const result = await executeLiveCanaryGhlSteps(makeCtx(), "idem_key_test_2", deps, {
    emitLifecycle: async () => {},
  });
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

  const result = await executeLiveCanaryGhlSteps(makeCtx(), "idem_optional_post", deps, {
    emitLifecycle: async () => {},
  });

  assert.equal(result.runStatus, "partial_success");
  assert.ok(result.summary.includes("required delivery completed"));
  assert.equal(
    result.stepOutcomes.find((s) => s.stepType === "assign_owner")?.status,
    "optional_failed"
  );
  assert.equal(
    result.stepOutcomes.find((s) => s.stepType === "start_workflow")?.status,
    "optional_failed"
  );

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps owner failure reports configured owner id", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  armLiveCanaryAdapterEnv();
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

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
  assert.equal(result.runStatus, "partial_success");
  assert.ok(result.summary.includes("required delivery completed"));
  assert.ok(result.warnings.some((w) => w.includes("Invalid user id") || w.includes("invalid")));

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
