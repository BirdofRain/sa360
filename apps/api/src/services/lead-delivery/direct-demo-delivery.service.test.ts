import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { LIVE_CANARY_CONFIRMATION_TEXT } from "../../lib/ghl-delivery-adapter-mode.js";
import {
  DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_CANONICAL_LOCATION_ID,
  LIVE_CANARY_DESTINATION_ALLOWLIST_ENV,
} from "../../lib/direct-demo-delivery-config.js";
import type { DirectDemoDeliveryBody } from "../../schemas/lead-delivery-direct-demo.schema.js";
import type { RoutingDryRunOutput } from "../routing-dry-run.service.js";
import {
  runDirectDemoDelivery,
  type DirectDemoDeliveryDeps,
} from "./direct-demo-delivery.service.js";
import {
  DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY,
  DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE,
  DUPLICATE_RISK_SHADOW_REVIEW_MESSAGE,
} from "./direct-demo-delivery.present.js";
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

function mockPlan(id = "plan_1", status = "planned") {
  return {
    id,
    status,
    deliveryMode: "direct_canary",
    generatedBy: "sa360_direct_canary_delivery",
    warnings: [] as string[],
    routingDryRunDecisionId: "dec_1",
    steps: [],
  };
}

const COMPLETE_CORE_FIELD_MAP = {
  sa360_lead_uid: "cf_lead_uid",
  sa360_client_account_id: "cf_client_account_id",
  sa360_lifecycle_stage: "cf_lifecycle_stage",
  sa360_routing_status: "cf_routing_status",
  sa360_backend_sync_status: "cf_backend_sync_status",
  sa360_delivery_plan_id: "cf_delivery_plan_id",
  sa360_delivery_run_id: "cf_delivery_run_id",
  sa360_event_uuid: "cf_event_uuid",
  sa360_utm_campaign: "cf_utm_campaign",
  sa360_campaign_id: "cf_campaign_id",
  sa360_source_platform: "cf_source_platform",
} as const;

function payloadWithPlanRefs(
  payload: DirectDemoDeliveryBody["payload"],
  refs: { decisionId?: string; planId?: string } = {}
): DirectDemoDeliveryBody["payload"] {
  const decisionId = refs.decisionId ?? "dec_1";
  const planId = refs.planId ?? "plan_1";
  return {
    ...payload,
    routing: {
      ...(payload.routing ?? {}),
      routing_dry_run_decision_id: decisionId,
      delivery_plan_id: planId,
    },
  };
}

function referencedDecision(
  decisionId = "dec_1",
  matchedRuleId = "rule_demo",
  destClient = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  destLocation = DIRECT_DEMO_CANONICAL_LOCATION_ID
) {
  return {
    id: decisionId,
    matched: true,
    matchedRuleId,
    destinationClientAccountId: destClient,
    destinationSubaccountIdGhl: destLocation,
    routingEventNameInternal: "lead_matched",
  } as never;
}

function referencedPlan(
  planId = "plan_1",
  decisionId = "dec_1",
  status = "planned",
  destClient = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  destLocation = DIRECT_DEMO_CANONICAL_LOCATION_ID
) {
  return {
    ...mockPlan(planId, status),
    routingDryRunDecisionId: decisionId,
    destinationClientAccountId: destClient,
    destinationSubaccountIdGhl: destLocation,
    masterClientAccountId: "lal_master_vet",
    sourceLeadUid: "lead_uid_ref",
    sourceEmail: "demo.direct.ref@example.test",
    sourcePhoneE164: "+15550100999",
    planVersion: 1,
  } as never;
}

function approvedDestinationClient(
  clientAccountId = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  locationId = DIRECT_DEMO_CANONICAL_LOCATION_ID
): {
  clientAccountId: string;
  clientDisplayName: string;
  ghlDestination: Record<string, unknown>;
} {
  return {
    clientAccountId,
    clientDisplayName: clientAccountId,
    ghlDestination: {
      id: "dest_1",
      destinationSubaccountIdGhl: locationId,
      destinationWorkflowIdGhl: null,
      destinationPipelineIdGhl: null,
      destinationPipelineStageIdGhl: null,
      defaultAssignedUserIdGhl: null,
      ghlConnectionStatus: "connected",
      snapshotInstalled: true,
      requiredFieldsInstalled: true,
      opportunityCreationEnabled: false,
      sa360CustomFieldIdMapJson: COMPLETE_CORE_FIELD_MAP,
      sa360CustomFieldOptionMapJson: {},
      customFieldStampRequired: false,
      ownerAssignmentRequired: false,
      workflowStartRequired: false,
      workflowTriggerMode: "tag_trigger",
      deliveryMode: "live",
      deliveryEnabled: true,
      clientCutoverApproved: true,
      internalApprovalStatus: "approved",
    },
  };
}

function referencedPlanDeps(
  opts: {
    decisionId?: string;
    planId?: string;
    status?: string;
    destClient?: string;
    destLocation?: string;
    matchedRuleId?: string;
    clientRecord?: unknown;
  } = {}
): Pick<
  DirectDemoDeliveryDeps,
  | "findRoutingDryRunDecisionById"
  | "findDeliveryPlanById"
  | "findDeliveryPlanByRoutingDecisionId"
  | "findClientAccountById"
  | "findGhlLocationConnectionByLocationId"
> {
  const decisionId = opts.decisionId ?? "dec_1";
  const planId = opts.planId ?? "plan_1";
  const destClient = opts.destClient ?? DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  const destLocation = opts.destLocation ?? DIRECT_DEMO_CANONICAL_LOCATION_ID;
  const status = opts.status ?? "planned";
  const matchedRuleId = opts.matchedRuleId ?? "rule_demo";
  return {
    findRoutingDryRunDecisionById: (async () =>
      referencedDecision(decisionId, matchedRuleId, destClient, destLocation)) as never,
    findDeliveryPlanById: (async () =>
      referencedPlan(planId, decisionId, status, destClient, destLocation)) as never,
    findDeliveryPlanByRoutingDecisionId: (async () =>
      referencedPlan(planId, decisionId, status, destClient, destLocation)) as never,
    findClientAccountById: (async () =>
      (opts.clientRecord ?? approvedDestinationClient(destClient, destLocation))) as never,
    findGhlLocationConnectionByLocationId: (async () =>
      ({
        id: "conn_1",
        locationId: destLocation,
        connectionStatus: "connected",
        lastProbeAt: new Date(),
        lastError: null,
      }) as never) as never,
  };
}

test("runDirectDemoDelivery simulate completes without external call", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "simulate";

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("sim1")),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateDirectCanaryDeliveryPlanForDecision: async () => ({ plan: mockPlan() as never }),
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

test("runDirectDemoDelivery simulate does not block on Phase 4D shadow-only warning", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "simulate";

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("nophase4d")),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateDirectCanaryDeliveryPlanForDecision: async () => ({
        plan: {
          ...mockPlan("plan_adapter"),
          warnings: [],
        } as never,
      }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () =>
        ({
          id: "rule_demo",
          matchType: "campaign_id",
          campaignId: "demo_campaign",
          clientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
          destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
          deliveryEnabled: true,
        }) as never,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_nophase4d", summary: "simulated" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "simulate",
          blockedReason: null,
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.planType, "adapter_simulation_plan");
    assert.equal(result.planPath, "adapter_plan");
    assert.ok(
      !(result.warnings ?? []).some((w) => w.includes("Phase 4D only records shadow plans")),
      "Phase 4D shadow warning must not appear on direct canary path"
    );
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery needs_config includes plan type and missing adapter fields", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "simulate";

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("needsconfig")),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateDirectCanaryDeliveryPlanForDecision: async () => ({
        plan: {
          ...mockPlan("plan_needs", "needs_config"),
          steps: [
            {
              stepType: "create_or_update_opportunity",
              status: "needs_config",
              title: "Create opportunity",
              warnings: ["destinationPipelineStageIdGhl missing"],
            },
          ],
        } as never,
      }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () =>
        ({
          id: "rule_demo",
          matchType: "campaign_id",
          campaignId: "demo_campaign",
          clientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
          destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.planType, "adapter_simulation_plan");
    assert.equal(result.planPath, "adapter_plan");
    assert.ok(result.missingConfigFields?.includes("destinationPipelineStageIdGhl"));
    assert.ok(
      result.blockers.some((b) => b.includes("adapter_simulation_plan")),
      "blockers must name plan type"
    );
    assert.ok(
      result.blockers.some((b) => b.includes("destinationPipelineStageIdGhl")),
      "blockers must list missing fields"
    );
    assert.ok(
      !result.blockers.some((b) => b.includes("Phase 4D")),
      "must not use generic Phase 4D shadow blocker"
    );
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery simulate allows non-demo destination with matched routing", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  process.env.GHL_DELIVERY_ADAPTER_MODE = "simulate";

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("baddest")),
    {
      runRoutingDryRun: async () => ({
        ...matchedDryRun(),
        destinationClientAccountId: "other_client",
        destinationSubaccountIdGhl: "other_location",
      }),
      generateDirectCanaryDeliveryPlanForDecision: async () => ({
        plan: referencedPlan("plan_other", "dec_1", "planned", "other_client", "other_location"),
      }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_other", summary: "simulated", status: "simulated" },
          validation: {},
          safetyMessage: "safe",
          adapterMode: "simulate",
          blockedReason: null,
        }) as never,
    }
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.destinationClientAccountId, "other_client");
    assert.equal(result.externalCallExecuted, false);
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery live_canary blocks raw custom payload without plan refs", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  armLiveCanaryAdapterEnv();

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("liveenv"), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    })
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.includes("raw custom payload cannot run live canary"));
    assert.ok(
      result.blockers.includes("Live canary requires a matched routing decision and delivery plan.")
    );
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery live_canary rejects without exact confirmation", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  armLiveCanaryAdapterEnv();
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
  armLiveCanaryAdapterEnv();

  const result = await runDirectDemoDelivery(
    directDemoInput(loadFixturePayload("simlivecanary")),
    {
      runRoutingDryRun: async () => matchedDryRun(),
      generateDirectCanaryDeliveryPlanForDecision: async () => ({ plan: mockPlan() as never }),
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
  armLiveCanaryAdapterEnv();
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const callOrder: string[] = [];
  await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("liveorder"), { planId: "plan_order" }), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps({ planId: "plan_order" }),
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
  armLiveCanaryAdapterEnv();
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  let preflightCalled = false;
  const result = await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("livesimfail")), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps(),
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
  const prevAllowlist = process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
  armLiveCanaryAdapterEnv();
  process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] =
    `${DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID}:${DIRECT_DEMO_CANONICAL_LOCATION_ID}`;

  const result = await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("livebaddest"), { planId: "plan_other" }), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps({
        planId: "plan_other",
        destClient: "other_client",
        destLocation: "other_location",
      }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
    }
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.includes("destination not in live canary allowlist"));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevAllowlist !== undefined) process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV] = prevAllowlist;
  else delete process.env[LIVE_CANARY_DESTINATION_ALLOWLIST_ENV];
});

test("runDirectDemoDelivery live_canary allows approved client cutover destination", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  armLiveCanaryAdapterEnv();

  const jamesClient = "vet_life_james_torrey";
  const jamesLocation = "9xSNvQCbGaPE9YNxgl4B";
  const result = await runDirectDemoDelivery(
    directDemoInput(
      payloadWithPlanRefs(loadFixturePayload("jameslive"), {
        decisionId: "dec_james",
        planId: "plan_james",
      }),
      {
        mode: "live_canary",
        confirmLiveDeliveryRisk: true,
        operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
      }
    ),
    {
      ...referencedPlanDeps({
        decisionId: "dec_james",
        planId: "plan_james",
        destClient: jamesClient,
        destLocation: jamesLocation,
        clientRecord: approvedDestinationClient(jamesClient, jamesLocation),
      }),
      getDuplicateRiskForRoutingDecision: async () =>
        ({ riskLevel: "none", blocksLiveDelivery: false, recommendedAction: null }) as never,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_james", summary: "sim ok", status: "simulated" },
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
          idempotencyKey: "idem_james",
          lastAdapterSimulationRunId: "adapter_james",
          lastAdapterSimulationStatus: "simulated",
          lastAdapterSimulationMode: "simulate",
          lastAdapterSimulationPassed: true,
          lastAdapterSimulationDetail: "ok",
          lastLiveRunStatus: null,
          duplicateRiskLevel: "none",
          duplicateBlocksLive: false,
          readinessCanDeliverLive: true,
        },
        safetyMessage: "safe",
        adapterMode: "live_canary",
      }),
      executeLiveCanaryForPlan: async () =>
        ({
          ok: true,
          liveRun: { id: "live_james", status: "succeeded", summary: "ok", warnings: [], stepRuns: [] },
          externalCallExecuted: true,
          contactIdGhl: "contact_james",
          opportunityIdGhl: "opp_james",
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.destinationClientAccountId, jamesClient);
    assert.equal(result.destinationSubaccountIdGhl, jamesLocation);
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery live_canary blocks unapproved destination gates", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  armLiveCanaryAdapterEnv();

  const baseClientRecord = approvedDestinationClient("vet_life_james_torrey", "9xSNvQCbGaPE9YNxgl4B");
  const unapprovedClientRecord = {
    ...baseClientRecord,
    ghlDestination: {
      ...baseClientRecord.ghlDestination,
      deliveryEnabled: false,
      clientCutoverApproved: false,
      internalApprovalStatus: "ready_for_review",
      deliveryMode: "shadow",
    },
  } as never;

  const result = await runDirectDemoDelivery(
    directDemoInput(
      payloadWithPlanRefs(loadFixturePayload("jamesblocked"), {
        decisionId: "dec_james_blocked",
        planId: "plan_james_blocked",
      }),
      {
        mode: "live_canary",
        confirmLiveDeliveryRisk: true,
        operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
      }
    ),
    {
      ...referencedPlanDeps({
        decisionId: "dec_james_blocked",
        planId: "plan_james_blocked",
        destClient: "vet_life_james_torrey",
        destLocation: "9xSNvQCbGaPE9YNxgl4B",
        clientRecord: unapprovedClientRecord,
      }),
      getDuplicateRiskForRoutingDecision: async () =>
        ({ riskLevel: "none", blocksLiveDelivery: false, recommendedAction: null }) as never,
      findCampaignRoutingRuleById: async () => null,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.blockers.includes("delivery mode must be live"));
    assert.ok(result.blockers.includes("delivery enabled is false"));
    assert.ok(result.blockers.includes("client cutover approved is false"));
    assert.ok(result.blockers.includes("internal approval status must be approved"));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
});

test("runDirectDemoDelivery live_canary blocks duplicate idempotent live execution", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  armLiveCanaryAdapterEnv();
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("liveidem")), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps(),
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
  armLiveCanaryAdapterEnv();
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("dup")), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps(),
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
  armLiveCanaryAdapterEnv();
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  let executeCalled = false;
  const result = await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("liveexec"), { planId: "plan_live" }), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps({ planId: "plan_live" }),
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
          liveRun: {
            id: "live_1",
            status: "succeeded",
            summary: "live ok",
            warnings: [],
            stepRuns: [
              {
                stepType: "create_or_update_contact",
                status: "succeeded",
                requestRedactedJson: {},
              },
              {
                stepType: "stamp_custom_fields",
                status: "succeeded",
                requestRedactedJson: {
                  stampPhases: {
                    text: { attemptedFields: ["sa360_lead_uid"] },
                    option: { attemptedFields: ["sa360_routing_status"] },
                  },
                },
              },
              { stepType: "add_tags", status: "succeeded", requestRedactedJson: {} },
              {
                stepType: "create_or_update_opportunity",
                status: "succeeded",
                requestRedactedJson: {},
              },
              { stepType: "assign_owner", status: "skipped", requestRedactedJson: {} },
              { stepType: "start_workflow", status: "succeeded", requestRedactedJson: {} },
            ],
          },
          externalCallExecuted: true,
          preflight: undefined,
          safetyMessage: "safe",
          contactIdGhl: "contact_live",
          opportunityIdGhl: "opp_live",
          workflowStarted: true,
        } as never;
      },
      getDuplicateRiskForRoutingDecision: async () =>
        ({
          riskLevel: "none",
          confidence: "high",
          blocksLiveDelivery: false,
          recommendedAction: DUPLICATE_RISK_SHADOW_REVIEW_MESSAGE,
          reasons: [],
          candidateMatches: [],
          identityStatus: "linked",
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(executeCalled, true);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.liveRunId, "live_1");
    assert.equal(result.externalCallExecuted, true);
    assert.equal(result.liveRunStatus, "succeeded");
    assert.equal(result.planType, "live_canary_plan");
    assert.equal(result.sourceLane, "meta_lead_ads");
    assert.equal(result.sourceLaneLabel, "Meta Lead Ads");
    assert.equal(result.summary, DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY);
    assert.equal(
      result.duplicateRisk?.recommendedAction,
      DUPLICATE_RISK_DIRECT_CANARY_REVIEW_MESSAGE
    );
    const stamp = result.liveRunStepSummary?.find((s) => s.stepType === "stamp_custom_fields");
    assert.ok(stamp?.customFieldStampSummary?.includes("TEXT stamped"));
    assert.ok(stamp?.customFieldStampSummary?.includes("Option fields stamped"));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});

test("runDirectDemoDelivery live_canary contact failure returns ok=false with sanitized error", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  armLiveCanaryAdapterEnv();
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("livecontactfail"), { planId: "plan_fail" }), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps({ planId: "plan_fail" }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_fail", summary: "sim ok" },
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
          idempotencyKey: "idem_fail",
          lastAdapterSimulationRunId: "adapter_fail",
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
          externalCallExecuted: true,
          liveRun: {
            id: "live_fail",
            status: "failed",
            summary: "Contact creation failed; remaining GHL write steps were not executed.",
            errors: ["customFields must be an array"],
            warnings: [],
            stepRuns: [
              {
                id: "step_fail",
                stepOrder: 1,
                stepType: "create_or_update_contact",
                targetSystem: "ghl",
                targetId: DIRECT_DEMO_CANONICAL_LOCATION_ID,
                status: "failed",
                externalId: null,
                errorCode: "http_400",
                errorSummary: "customFields must be an array",
                warnings: [],
                requestRedactedJson: {
                  method: "POST",
                  url: "https://services.leadconnectorhq.com/contacts/upsert",
                  headers: { Authorization: "Bearer [REDACTED]" },
                  body: {
                    locationId: DIRECT_DEMO_CANONICAL_LOCATION_ID,
                    email: "demo@example.test",
                  },
                },
                responseRedactedJson: { externalCallExecuted: true },
                externalCallExecuted: true,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
              },
            ],
            contactIdGhl: null,
            opportunityIdGhl: null,
            workflowStarted: false,
          },
          safetyMessage: "safe",
          contactIdGhl: null,
          opportunityIdGhl: null,
          workflowStarted: false,
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.externalCallExecuted, true);
    assert.equal(result.liveRunId, "live_fail");
    assert.equal(result.liveRunStatus, "failed");
    assert.equal(result.liveRunFailure?.failedStepType, "create_or_update_contact");
    assert.equal(result.liveRunFailure?.httpStatus, 400);
    assert.equal(result.liveRunFailure?.errorMessage, "customFields must be an array");
    assert.equal(result.liveRunFailure?.partialContactCreated, false);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("Bearer "));
    assert.ok(!serialized.toLowerCase().includes("token"));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});

test("runDirectDemoDelivery live_canary partial success returns ok=false not full success", async () => {
  const prevMode = process.env.GHL_DELIVERY_ADAPTER_MODE;
  const prevC = process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  const prevL = process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
  armLiveCanaryAdapterEnv();
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID;
  process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = DIRECT_DEMO_CANONICAL_LOCATION_ID;

  const result = await runDirectDemoDelivery(
    directDemoInput(payloadWithPlanRefs(loadFixturePayload("livepartial"), { planId: "plan_partial" }), {
      mode: "live_canary",
      confirmLiveDeliveryRisk: true,
      operatorConfirmationText: LIVE_CANARY_CONFIRMATION_TEXT,
    }),
    {
      ...referencedPlanDeps({ planId: "plan_partial" }),
      getDuplicateRiskForRoutingDecision: async () => null,
      findCampaignRoutingRuleById: async () => null,
      runGhlAdapterSimulationForPlan: async () =>
        ({
          ok: true,
          adapterRun: { id: "adapter_partial", summary: "sim ok" },
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
          idempotencyKey: "idem_partial",
          lastAdapterSimulationRunId: "adapter_partial",
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
          externalCallExecuted: true,
          liveRun: {
            id: "live_partial",
            status: "partial_success",
            summary: "Live canary partially succeeded — review step errors and GHL subaccount before retry.",
            errors: ["pipelineStageId is invalid"],
            warnings: [
              "Owner assignment skipped — no valid GHL user configured.",
              "Workflow skipped — opportunity creation did not succeed.",
            ],
            stepRuns: [
              {
                id: "step_contact",
                stepOrder: 1,
                stepType: "create_or_update_contact",
                targetSystem: "ghl",
                targetId: DIRECT_DEMO_CANONICAL_LOCATION_ID,
                status: "succeeded",
                externalId: "AjPwW9LZ8cKiABHbPFpd",
                errorCode: null,
                errorSummary: null,
                warnings: [],
                requestRedactedJson: {
                  method: "POST",
                  headers: { Authorization: "Bearer [REDACTED]" },
                  body: {
                    locationId: DIRECT_DEMO_CANONICAL_LOCATION_ID,
                    email: "demo@example.test",
                  },
                },
                responseRedactedJson: { externalCallExecuted: true },
                externalCallExecuted: true,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
              },
              {
                id: "step_opp",
                stepOrder: 4,
                stepType: "create_or_update_opportunity",
                targetSystem: "ghl",
                targetId: DIRECT_DEMO_CANONICAL_LOCATION_ID,
                status: "failed",
                externalId: null,
                errorCode: "http_422",
                errorSummary: "pipelineStageId is invalid",
                warnings: [],
                requestRedactedJson: {
                  method: "POST",
                  body: {
                    locationId: DIRECT_DEMO_CANONICAL_LOCATION_ID,
                    contactId: "AjPwW9LZ8cKiABHbPFpd",
                    name: "VET lead — demo@example.test",
                    status: "open",
                  },
                },
                responseRedactedJson: { externalCallExecuted: true },
                externalCallExecuted: true,
                startedAt: new Date().toISOString(),
                completedAt: new Date().toISOString(),
              },
            ],
            contactIdGhl: "AjPwW9LZ8cKiABHbPFpd",
            opportunityIdGhl: null,
            workflowStarted: false,
          },
          safetyMessage: "safe",
          contactIdGhl: "AjPwW9LZ8cKiABHbPFpd",
          opportunityIdGhl: null,
          workflowStarted: false,
        }) as never,
    } satisfies DirectDemoDeliveryDeps
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "live_canary_partial_failure");
    assert.equal(result.liveRunStatus, "partial_success");
    assert.equal(result.contactIdGhl, "AjPwW9LZ8cKiABHbPFpd");
    assert.ok(Array.isArray(result.liveRunStepSummary));
    assert.ok(result.liveRunStepSummary!.length >= 1);
    const serialized = JSON.stringify(result);
    assert.ok(!serialized.includes("Bearer "));
    assert.ok(!serialized.toLowerCase().includes("secret-token"));
  }

  if (prevMode !== undefined) process.env.GHL_DELIVERY_ADAPTER_MODE = prevMode;
  else delete process.env.GHL_DELIVERY_ADAPTER_MODE;
  if (prevC !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS = prevC;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS;
  if (prevL !== undefined) process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS = prevL;
  else delete process.env.SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS;
});
