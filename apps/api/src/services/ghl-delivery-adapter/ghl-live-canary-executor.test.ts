import test from "node:test";
import assert from "node:assert/strict";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { executeLiveCanaryGhlSteps } from "./ghl-live-canary-executor.service.js";
import type { GhlLiveHttpDeps } from "./ghl-live-transport.js";

function makeCtx(): GhlAdapterPlanContext {
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
      defaultAssignedUserIdGhl: "user_1",
      opportunityCreationEnabled: true,
      nicheKey: "vet",
      sourcePlatform: "meta",
    } as GhlAdapterPlanContext["rule"],
  };
}

test("executeLiveCanaryGhlSteps stops after contact failure", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const calls: string[] = [];
  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/contacts/upsert")) {
        return new Response(JSON.stringify({ message: "bad request" }), { status: 400 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const result = await executeLiveCanaryGhlSteps(makeCtx(), "idem_key_test", deps, {
    emitLifecycle: async () => {},
  });
  assert.equal(result.runStatus, "failed");
  assert.ok(calls.some((c) => c.includes("/contacts/upsert")));
  assert.equal(
    calls.filter((c) => c.includes("/tags")).length,
    0,
    "tags should not run after contact failure"
  );

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
  else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
});

test("executeLiveCanaryGhlSteps records partial_success when workflow fails", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "test-token";

  const deps: GhlLiveHttpDeps = {
    fetch: async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/contacts/upsert") && method === "POST") {
        return new Response(JSON.stringify({ contact: { id: "contact_abc" } }), { status: 200 });
      }
      if (url.includes("/workflow/") && method === "POST") {
        return new Response(JSON.stringify({ message: "workflow failed" }), { status: 500 });
      }
      return new Response(JSON.stringify({ contact: { id: "contact_abc" } }), { status: 200 });
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

test("webhook route does not import live canary executor", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const webhookPath = join(dirname(fileURLToPath(import.meta.url)), "../../routes/webhook.ts");
  const src = readFileSync(webhookPath, "utf8");
  assert.doesNotMatch(src, /ghl-live-canary|executeLiveCanaryForPlan|ghl-live\/canary/);
});
