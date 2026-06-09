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
import type { RoutingDryRunOutput } from "../routing-dry-run.service.js";
import {
  runDirectDemoDelivery,
  type DirectDemoDeliveryDeps,
} from "./direct-demo-delivery.service.js";

const fixturePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/sa360-demo-lead-created.json"
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

function directDemoInput(
  payload: DirectDemoDeliveryBody["payload"],
  overrides: Partial<Omit<DirectDemoDeliveryBody, "payload">> = {}
): DirectDemoDeliveryBody {
  return {
    payload,
    mode: "simulate",
    confirmLiveDeliveryRisk: false,
    operatorConfirmationText: "",
    ...overrides,
  };
}

function matchedDryRun(decisionId = "dec_1"): RoutingDryRunOutput {
  return {
    matched: true,
    confidence: "high",
    matchType: "campaign_id",
    matchedRuleId: "rule_demo",
    destinationClientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
    destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
    reason: "Matched demo rule",
    deliveryMode: "dry_run",
    routingEventNameInternal: "lead_matched",
    decisionId,
    lifecycleEventsEmitted: ["lead_matched", "lead_routed_dry_run"],
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
    directDemoInput(loadFixturePayload("sim1")),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan() as never }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_1", summary: "simulated" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "simulate",
          blockedReason: null,
        }) as never,
    } satisfies DirectDemoDeliveryDeps
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
    directDemoInput(loadFixturePayload("baddest")),
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
    assert.ok(
      result.blockers.some((b: string) => b.includes("Allowed demo client")) ||
        (result.reason?.includes("allowlist") ?? false)
    );
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

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("liveenv"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    })
  );

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

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("liveconfirm"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: "WRONG",
    })
  );

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

test("runDirectDemoDelivery simulate allowed when GHL_DELIVERY_ADAPTER_MODE=live_canary", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("simlivecanary")),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan() as never }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_sim_lc", summary: "simulated", status: "simulated" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "live_canary",
          blockedReason: null,
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.externalCallExecuted, false);
    assert.equal(result.adapterSimulationPassed, true);
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery live_canary runs adapter simulation before preflight", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const callOrder: string[] = [];
  await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("liveorder"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan("plan_order") as never }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () => {
        callOrder.push("simulate");
        return {
          ok: true,
          adapterRun: { id: "adapter_order", summary: "sim ok" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "live_canary",
          blockedReason: null,
        } as never;
      },
      getLiveCanaryPreflightForPlan: async () => {
        callOrder.push("preflight");
        return {
          preflight: {
            canExecute: false,
            blockers: ["Recent successful GHL adapter simulation is required before live canary."],
            warnings: [],
            adapterMode: "live_canary",
            idempotencyKey: "idem_1",
            lastAdapterSimulationRunId: null,
            lastAdapterSimulationStatus: null,
            lastAdapterSimulationMode: null,
            lastAdapterSimulationPassed: false,
            lastAdapterSimulationDetail: "No adapter run found for this deliveryPlanId.",
            lastLiveRunStatus: null,
            duplicateRiskLevel: null,
            duplicateBlocksLive: false,
            readinessCanDeliverLive: true,
          },
          safetyMessage: "safe",
          adapterMode: "live_canary",
        };
      },
    } satisfies DirectDemoDeliveryDeps
  );

  assert.deepEqual(callOrder, ["simulate", "preflight"]);

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});

test("runDirectDemoDelivery live_canary blocks when adapter simulation fails", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  let preflightCalled = false;
  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("livesimfail"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan() as never }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: false,
          adapterRun: { id: "adapter_fail", summary: "failed" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "live_canary",
          blockedReason: "Adapter validation failed.",
        }) as never,
      getLiveCanaryPreflightForPlan: async () => {
        preflightCalled = true;
        throw new Error("preflight should not run when simulation fails");
      },
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(preflightCalled, false);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.blockers.some((b: string) => /adapter|simulation/i.test(b)) ||
        (result.reason?.toLowerCase().includes("simulation") ?? false)
    );
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});

test("runDirectDemoDelivery live_canary blocks non-allowlisted destination", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("livebaddest"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      runRoutingDryRun: async () => ({
        ...matchedDryRun(),
        destinationClientAccountId: "other_client",
      }),
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.blockers.some((b: string) => b.includes("Allowed demo client")) ||
        (result.reason?.includes("allowlist") ?? false)
    );
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});

test("runDirectDemoDelivery live_canary blocks duplicate idempotent live execution", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "live_canary";
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("liveidem"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan() as never }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_idem", summary: "sim ok" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "live_canary",
          blockedReason: null,
        }) as never,
      getLiveCanaryPreflightForPlan: async () => ({
        preflight: {
          canExecute: true,
          blockers: [],
          warnings: [],
          adapterMode: "live_canary",
          idempotencyKey: "idem_dup",
          lastAdapterSimulationRunId: "adapter_idem",
          lastAdapterSimulationStatus: "simulated",
          lastAdapterSimulationMode: "simulate",
          lastAdapterSimulationPassed: true,
          lastAdapterSimulationDetail: "ok",
          lastLiveRunStatus: null,
          duplicateRiskLevel: null,
          duplicateBlocksLive: false,
          readinessCanDeliverLive: true,
        },
        safetyMessage: "safe",
        adapterMode: "live_canary",
      }),
      executeLiveCanaryForPlan: async () =>
        ({
          ok: false,
          skippedDuplicate: true,
          liveRun: { id: "live_dup", summary: "skipped" },
          externalCallExecuted: false,
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.some((b: string) => b.toLowerCase().includes("idempotency")));
    assert.equal(result.externalCallExecuted, false);
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

  const result = await runDirectDemoDelivery(directDemoInput(payload));
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
    directDemoInput(loadFixturePayload("dup"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan() as never }),
      getDuplicateRiskForRoutingDecision: async () =>
        ({
          id: "dup_1",
          riskLevel: "likely_duplicate",
          confidence: "high",
          reasons: ["test"],
          candidateMatches: [],
          recommendedAction: "Review duplicate",
          identityStatus: "linked",
          blocksLiveDelivery: true,
          isWarningOnly: false,
          operatorOverrideStatus: null,
          operatorNotes: null,
          operatorUpdatedAt: null,
          operatorUpdatedBy: null,
        }) as never,
      findCampaignRoutingRuleById: async () => null,
    } satisfies DirectDemoDeliveryDeps
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
    directDemoInput(loadFixturePayload("liveexec"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateLeadDeliveryPlanForDecision: async () => ({ plan: mockPlan("plan_live") as never }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_live", summary: "sim ok" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "live_canary",
          blockedReason: null,
        }) as never,
      getLiveCanaryPreflightForPlan: async () => ({
        preflight: {
          canExecute: true,
          blockers: [],
          warnings: [],
          adapterMode: "live_canary",
          idempotencyKey: "idem_1",
          lastAdapterSimulationRunId: "adapter_live",
          lastAdapterSimulationStatus: "simulated",
          lastAdapterSimulationMode: "simulate",
          lastAdapterSimulationPassed: true,
          lastAdapterSimulationDetail: "Adapter run counts as recent successful simulation.",
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
          contactIdGhl: null,
          opportunityIdGhl: null,
          workflowStarted: false,
        } as never;
      },
    } satisfies DirectDemoDeliveryDeps
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
