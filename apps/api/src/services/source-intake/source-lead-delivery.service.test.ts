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

test("requeue returns not_found for missing lead", async () => {
  const result = await requeueSourceLeadEvent("missing", {
    findSourceLeadEventById: (async () => null) as SourceLeadDeliveryDeps["findSourceLeadEventById"],
  });
  assert.deepEqual(result, { ok: false, error: "not_found" });
});
