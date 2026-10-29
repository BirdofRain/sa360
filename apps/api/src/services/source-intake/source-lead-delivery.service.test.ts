import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent } from "@prisma/client";
import {
  approveSourceLeadDelivery,
  requeueSourceLeadEvent,
  type SourceLeadDeliveryDeps,
} from "./source-lead-delivery.service.js";
import { SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION } from "./source-intake.types.js";
import {
  DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  DIRECT_DEMO_CANONICAL_LOCATION_ID,
} from "../../lib/direct-demo-delivery-config.js";
import type { DirectDemoDeliveryResult } from "../lead-delivery/direct-demo-delivery.service.js";

const NORMALIZED_PAYLOAD = {
  schema_version: "MASTER 2.0",
  client_account_id: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  contact: {
    lead_uid: "leadcaptureio-leadcapture_io_legacy-4681191",
    first_name: "James",
    last_name: "Wilkins",
    phone_e164: "+17066210688",
  },
  state: {
    lifecycle_stage: "NEW",
    routing_status: "RECEIVED",
    lead_type: "VET",
  },
  event: {
    event_uuid: "evt_4681191",
    event_name_internal: "lead_created",
    event_name_meta: "Lead",
  },
};

function fakeEvent(overrides: Partial<SourceLeadEvent> = {}): SourceLeadEvent {
  return {
    id: "sle_1",
    status: "routing_matched",
    routingRuleIdResolved: "rule_1",
    clientAccountIdResolved: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
    destinationLocationIdResolved: DIRECT_DEMO_CANONICAL_LOCATION_ID,
    normalizedPayloadJson: NORMALIZED_PAYLOAD,
    duplicateRiskJson: null,
    ...overrides,
  } as unknown as SourceLeadEvent;
}

type UpdateCall = { id: string; data: Record<string, unknown> };

function buildDeps(
  event: SourceLeadEvent,
  deliveryResult: DirectDemoDeliveryResult | null,
  updates: UpdateCall[]
): SourceLeadDeliveryDeps {
  return {
    findSourceLeadEventById: (async () => event) as SourceLeadDeliveryDeps["findSourceLeadEventById"],
    updateSourceLeadEvent: (async (id: string, data: Record<string, unknown>) => {
      updates.push({ id, data });
      return { ...event, ...data } as unknown as SourceLeadEvent;
    }) as SourceLeadDeliveryDeps["updateSourceLeadEvent"],
    runDirectDemoDelivery: (async () => deliveryResult) as SourceLeadDeliveryDeps["runDirectDemoDelivery"],
  };
}

const RUNTIME_MODE_BLOCK: DirectDemoDeliveryResult = {
  ok: false,
  error: "delivery_blocked",
  reason:
    "mode=live_canary requires effective runtime mode live_canary (max: live_canary, effective: simulate).",
  mode: "live_canary",
  matched: false,
  destinationClientAccountId: null,
  destinationSubaccountIdGhl: null,
  routingDryRunDecisionId: null,
  deliveryPlanId: null,
  adapterRunId: null,
  liveRunId: null,
  externalCallExecuted: false,
  blockers: ["runtime mode mismatch"],
  warnings: [],
  nextAction: "Switch runtime mode to live_canary.",
};

test("runtime mode mismatch does not strand a source lead in delivery_failed (no external write)", async () => {
  const event = fakeEvent();
  const updates: UpdateCall[] = [];
  const result = await approveSourceLeadDelivery(
    {
      sourceLeadEventId: event.id,
      mode: "live_canary",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
      confirmLiveDeliveryRisk: true,
    },
    buildDeps(event, RUNTIME_MODE_BLOCK, updates)
  );

  assert.equal(result.ok, false);
  const lastUpdate = updates.at(-1);
  assert.ok(lastUpdate);
  // Recoverable: back to a matched, approvable status — never delivery_failed.
  assert.equal(lastUpdate?.data.status, "routing_matched");
  assert.notEqual(lastUpdate?.data.status, "delivery_failed");
  assert.equal(lastUpdate?.data.approvedAt, null);
  assert.ok(lastUpdate?.data.deliveryResultJson, "delivery result is preserved for debugging");
  assert.ok(
    typeof lastUpdate?.data.errorSummary === "string" &&
      (lastUpdate.data.errorSummary as string).includes("live_canary")
  );
  // No update ever set delivery_failed.
  assert.equal(updates.some((u) => u.data.status === "delivery_failed"), false);
});

test("live delivery failure after external write marks the lead delivery_failed", async () => {
  const event = fakeEvent();
  const updates: UpdateCall[] = [];
  const failedAfterWrite: DirectDemoDeliveryResult = {
    ...RUNTIME_MODE_BLOCK,
    error: "live_canary_failed",
    reason: "Live canary execution failed after external GHL write was attempted.",
    matched: true,
    externalCallExecuted: true,
  };
  const result = await approveSourceLeadDelivery(
    {
      sourceLeadEventId: event.id,
      mode: "live_canary",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
      confirmLiveDeliveryRisk: true,
    },
    buildDeps(event, failedAfterWrite, updates)
  );

  assert.equal(result.ok, false);
  assert.equal(updates.at(-1)?.data.status, "delivery_failed");
});

test("requeue resets a matched delivery_failed lead to routing_matched", async () => {
  const event = fakeEvent({ status: "delivery_failed" });
  const updates: UpdateCall[] = [];
  const result = await requeueSourceLeadEvent(event.id, buildDeps(event, null, updates));
  assert.deepEqual(result, { ok: true, status: "routing_matched" });
  assert.equal(updates.at(-1)?.data.status, "routing_matched");
  assert.equal(updates.at(-1)?.data.approvedAt, null);
});

test("requeue resets an unmatched lead to routing_unmatched", async () => {
  const event = fakeEvent({
    status: "delivery_failed",
    routingRuleIdResolved: null,
    clientAccountIdResolved: null,
  });
  const updates: UpdateCall[] = [];
  const result = await requeueSourceLeadEvent(event.id, buildDeps(event, null, updates));
  assert.deepEqual(result, { ok: true, status: "routing_unmatched" });
});

test("requeue refuses delivered and rejected leads", async () => {
  const delivered = fakeEvent({ status: "delivered" });
  const rejected = fakeEvent({ status: "rejected" });
  const deliveredResult = await requeueSourceLeadEvent(
    delivered.id,
    buildDeps(delivered, null, [])
  );
  const rejectedResult = await requeueSourceLeadEvent(rejected.id, buildDeps(rejected, null, []));
  assert.deepEqual(deliveredResult, { ok: false, error: "already_delivered" });
  assert.deepEqual(rejectedResult, { ok: false, error: "already_rejected" });
});

const SIMULATE_OK = {
  ok: true,
  mode: "simulate",
  matched: true,
  destinationClientAccountId: DIRECT_DEMO_CANONICAL_CLIENT_ACCOUNT_ID,
  destinationSubaccountIdGhl: DIRECT_DEMO_CANONICAL_LOCATION_ID,
  routingDryRunDecisionId: "dec_assoc",
  deliveryPlanId: "plan_assoc",
  adapterRunId: "adapter_1",
  liveRunId: null,
  externalCallExecuted: false,
  summary: "simulated",
  blockers: [],
  warnings: [],
  nextAction: "none",
  matchedRuleId: null,
  duplicateRisk: null,
  readiness: null,
  deliveryPlanStatus: "planned",
  adapterMode: "simulate",
} as DirectDemoDeliveryResult;

test("persisted association lead reuses its plan and stamps delivery refs without a campaign rule", async () => {
  const event = fakeEvent({
    routingRuleIdResolved: null,
    routingDryRunDecisionId: "dec_assoc",
  });
  const updates: UpdateCall[] = [];
  const seenPayloads: Array<Record<string, unknown>> = [];
  let generateCalls = 0;
  const result = await approveSourceLeadDelivery(
    {
      sourceLeadEventId: event.id,
      mode: "simulate",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    },
    {
      ...buildDeps(event, SIMULATE_OK, updates),
      findDeliveryPlanByRoutingDecisionId: (async () =>
        ({ id: "plan_existing" }) as never) as SourceLeadDeliveryDeps["findDeliveryPlanByRoutingDecisionId"],
      generateDirectCanaryDeliveryPlanForDecision: (async () => {
        generateCalls += 1;
        return { notFound: true as const };
      }) as SourceLeadDeliveryDeps["generateDirectCanaryDeliveryPlanForDecision"],
      runDirectDemoDelivery: (async (input) => {
        seenPayloads.push(input.payload as unknown as Record<string, unknown>);
        return SIMULATE_OK;
      }) as SourceLeadDeliveryDeps["runDirectDemoDelivery"],
    }
  );

  assert.equal(result.ok, true);
  assert.equal(generateCalls, 0);
  const routing = seenPayloads[0]?.routing as Record<string, unknown>;
  assert.equal(routing.routing_dry_run_decision_id, "dec_assoc");
  assert.equal(routing.delivery_plan_id, "plan_existing");
  assert.equal("matchedRuleId" in routing, false);
  assert.equal("matched_rule_id" in routing, false);
  assert.equal(updates[0]?.data.status, "approved");
});

test("persisted association lead creates a direct-canary plan before delivery", async () => {
  const event = fakeEvent({
    routingRuleIdResolved: null,
    routingDryRunDecisionId: "dec_assoc",
  });
  const updates: UpdateCall[] = [];
  const seenPayloads: Array<Record<string, unknown>> = [];
  let generatedFor: string | null = null;
  const result = await approveSourceLeadDelivery(
    {
      sourceLeadEventId: event.id,
      mode: "simulate",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    },
    {
      ...buildDeps(event, SIMULATE_OK, updates),
      findDeliveryPlanByRoutingDecisionId: (async () =>
        null) as SourceLeadDeliveryDeps["findDeliveryPlanByRoutingDecisionId"],
      generateDirectCanaryDeliveryPlanForDecision: (async (decisionId) => {
        generatedFor = decisionId;
        return { plan: { id: "plan_created" } } as never;
      }) as SourceLeadDeliveryDeps["generateDirectCanaryDeliveryPlanForDecision"],
      runDirectDemoDelivery: (async (input) => {
        seenPayloads.push(input.payload as unknown as Record<string, unknown>);
        return SIMULATE_OK;
      }) as SourceLeadDeliveryDeps["runDirectDemoDelivery"],
    }
  );

  assert.equal(result.ok, true);
  assert.equal(generatedFor, "dec_assoc");
  const routing = seenPayloads[0]?.routing as Record<string, unknown>;
  assert.equal(routing.delivery_plan_id, "plan_created");
  assert.equal(routing.routing_dry_run_decision_id, "dec_assoc");
});

test("missing stored routing decision does not approve the lead", async () => {
  const event = fakeEvent({ routingDryRunDecisionId: "dec_missing" });
  const updates: UpdateCall[] = [];
  const result = await approveSourceLeadDelivery(
    {
      sourceLeadEventId: event.id,
      mode: "simulate",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    },
    {
      ...buildDeps(event, null, updates),
      findDeliveryPlanByRoutingDecisionId: (async () =>
        null) as SourceLeadDeliveryDeps["findDeliveryPlanByRoutingDecisionId"],
      generateDirectCanaryDeliveryPlanForDecision: (async () =>
        ({ notFound: true as const })) as SourceLeadDeliveryDeps["generateDirectCanaryDeliveryPlanForDecision"],
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "routing_decision_not_found");
  assert.equal(updates.length, 0);
});

test("company sheets plan block does not approve the lead", async () => {
  const event = fakeEvent({ routingDryRunDecisionId: "dec_sheets" });
  const updates: UpdateCall[] = [];
  const result = await approveSourceLeadDelivery(
    {
      sourceLeadEventId: event.id,
      mode: "simulate",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    },
    {
      ...buildDeps(event, null, updates),
      findDeliveryPlanByRoutingDecisionId: (async () =>
        null) as SourceLeadDeliveryDeps["findDeliveryPlanByRoutingDecisionId"],
      generateDirectCanaryDeliveryPlanForDecision: (async () =>
        ({ blocked: "company_sheets_internal_pilot" as const })) as SourceLeadDeliveryDeps["generateDirectCanaryDeliveryPlanForDecision"],
    }
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "company_sheets_internal_pilot");
  assert.equal(updates.length, 0);
});

test("association block before an external write stays routing_matched", async () => {
  const event = fakeEvent({
    routingRuleIdResolved: null,
    routingDryRunDecisionId: "dec_assoc",
  });
  const updates: UpdateCall[] = [];
  const result = await approveSourceLeadDelivery(
    {
      sourceLeadEventId: event.id,
      mode: "live_canary",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
      confirmLiveDeliveryRisk: true,
    },
    {
      ...buildDeps(event, RUNTIME_MODE_BLOCK, updates),
      findDeliveryPlanByRoutingDecisionId: (async () =>
        ({ id: "plan_existing" }) as never) as SourceLeadDeliveryDeps["findDeliveryPlanByRoutingDecisionId"],
    }
  );
  assert.equal(result.ok, false);
  assert.equal(updates.at(-1)?.data.status, "routing_matched");
});

test("requeue keeps an association lead routing_matched without a campaign rule", async () => {
  const event = fakeEvent({
    status: "delivery_failed",
    routingRuleIdResolved: null,
  });
  const updates: UpdateCall[] = [];
  const result = await requeueSourceLeadEvent(event.id, buildDeps(event, null, updates));
  assert.deepEqual(result, { ok: true, status: "routing_matched" });
});

test("requeue returns not_found for missing lead", async () => {
  const result = await requeueSourceLeadEvent("missing", {
    findSourceLeadEventById: (async () => null) as SourceLeadDeliveryDeps["findSourceLeadEventById"],
  });
  assert.deepEqual(result, { ok: false, error: "not_found" });
});
