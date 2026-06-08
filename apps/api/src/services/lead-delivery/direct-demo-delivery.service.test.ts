import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";
import {
  DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_CANONICAL_LOCATION_ID,
} from "../../lib/direct-demo-delivery-config.js";
import type { DirectDemoDeliveryBody } from "../../schemas/lead-delivery-direct-demo.schema.js";
import { runDirectDemoDelivery } from "./direct-demo-delivery.service.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sa360-demo-lead-created.json"
);

function loadFixturePayload(uniqueSuffix: string): DirectDemoDeliveryBody["payload"] {
  const raw = JSON.parse(readFileSync(fixturePath, "utf8")) as DirectDemoDeliveryBody["payload"];
  return {
    ...raw,
    contact: {
      ...raw.contact,
      lead_uid: `demo_sa360_direct_${uniqueSuffix}`,
      email: `demo.direct.${uniqueSuffix}@example.test`,
    },
    event: {
      ...raw.event,
      event_uuid: `demo_sa360_evt_${uniqueSuffix}`,
    },
  };
}

function matchedDryRun(decisionId = "dec_1") {
  return {
    matched: true,
    confidence: "high",
    matchType: "campaign_id",
    matchedRuleId: "rule_demo",
    destinationClientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
    destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
    reason: "Matched demo rule",
    deliveryMode: "dry_run" as const,
    routingEventNameInternal: "lead_matched" as const,
    decisionId,
    lifecycleEventsEmitted: ["lead_matched", "lead_routed_dry_run"] as const,
  };
}

function mockPlan(id = "plan_1") {
  return {
    id,
    status: "planned",
    warnings: [] as string[],
    routingDryRunDecisionId: "dec_1",
  };
}

test("runDirectDemoDelivery simulate completes without external call", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "simulate";

  const result = await runDirectDemoDelivery(
    { payload: loadFixturePayload("sim1"), mode: "simulate" },
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan() }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () => ({
        ok: true,
        adapterRun: { id: "adapter_1", summary: "simulated" },
        validation: {},
        safetyMessage: "safe",
        adapterMode: "simulate",
        blockedReason: null,
      }),
    }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.externalCallExecuted, false);
    assert.equal(result.adapterRunId, "adapter_1");
    assert.equal(result.destinationClientAccountId, DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID);
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery rejects non-allowlisted destination", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "simulate";

  const result = await runDirectDemoDelivery(
    { payload: loadFixturePayload("baddest"), mode: "simulate" },
    {
      runRoutingDryRun: async () => ({
        ...matchedDryRun(),
        destinationClientAccountId: "other_client",
      }),
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "delivery_blocked");
    assert.ok(result.blockers.some((b: string) => b.includes("allowlist")));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery live_canary rejects without env allowlist", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;

  const result = await runDirectDemoDelivery({
    payload: loadFixturePayload("liveenv"),
    mode: "live_canary",
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.some((b: string) => b.includes("SA360_DIRECT_DELIVERY_ALLOWED")));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
});

test("runDirectDemoDelivery live_canary rejects without exact confirmation", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery({
    payload: loadFixturePayload("liveconfirm"),
    mode: "live_canary",
    confirmLiveDeliveryRisk: true,
    operatorConfirmationText: "WRONG",
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.some((b: string) => b.includes(LIVE_CANARY_CONFIRMATION_TEXT)));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});

test("runDirectDemoDelivery rejects appointment_set payload", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "simulate";
  const payload = loadFixturePayload("appt");
  payload.event.event_name_internal = "appointment_set";

  const result = await runDirectDemoDelivery({ payload, mode: "simulate" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.some((b: string) => b.includes("lead_created")));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery blocks live when duplicate risk blocks", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery(
    {
      payload: loadFixturePayload("dup"),
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    },
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan() }),
      getDuplicateRiskForRoutingDecision: async () => ({
        id: "dup_1",
        riskLevel: "likely_duplicate",
        confidence: "high",
        reasons: ["test"],
        candidateMatches: [],
        recommendedAction: "Review duplicate",
        identityStatus: "matched",
        blocksLiveDelivery: true,
        isWarningOnly: false,
        operatorOverrideStatus: null,
        operatorNotes: null,
        operatorUpdatedAt: null,
        operatorUpdatedBy: null,
      }),
      findCampaignRoutingRuleById: async () => null,
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.some((b: string) => b.toLowerCase().includes("duplicate")));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});

test("runDirectDemoDelivery live reuses executeLiveCanaryForPlan", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  let executeCalled = false;
  const result = await runDirectDemoDelivery(
    {
      payload: loadFixturePayload("liveexec"),
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    },
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan("plan_live") }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () => ({
        ok: true,
        adapterRun: { id: "adapter_live", summary: "sim ok" },
        validation: {},
        safetyMessage: "safe",
        adapterMode: "live_canary",
        blockedReason: null,
      }),
      getLiveCanaryPreflightForPlan: async () => ({
        preflight: {
          canExecute: true,
          blockers: [],
          warnings: [],
          adapterMode: "live_canary",
          idempotencyKey: "idem_1",
          lastAdapterSimulationStatus: "simulated",
          lastAdapterSimulationPassed: true,
          lastLiveRunStatus: null,
          duplicateRiskLevel: null,
          duplicateBlocksLive: false,
          readinessCanDeliverLive: true,
        },
        safetyMessage: "safe",
        adapterMode: "live_canary",
      }),
      executeLiveCanaryForPlan: async () => {
        executeCalled = true;
        return {
          ok: true,
          liveRun: { id: "live_1", summary: "live ok", warnings: [] },
          externalCallExecuted: true,
          preflight: undefined,
          safetyMessage: "safe",
        };
      },
    }
  );

  assert.equal(executeCalled, true);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.liveRunId, "live_1");
    assert.equal(result.externalCallExecuted, true);
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});
