import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildFulfillmentOpsSafetyPosture,
  FULFILLMENT_OPS_SAFETY_MESSAGE,
  presentFulfillmentOpsOrder,
} from "./fulfillment-ops.service.js";

test("safety posture is simulation-only with live disabled by default", () => {
  const prevExec = process.env.SA360_LF2_EXECUTION_ENABLED;
  const prevCanary = process.env.SA360_LF2_GHL_CANARY_ENABLED;
  delete process.env.SA360_LF2_EXECUTION_ENABLED;
  delete process.env.SA360_LF2_GHL_CANARY_ENABLED;

  try {
    const safety = buildFulfillmentOpsSafetyPosture();
    assert.equal(safety.simulationOnly, true);
    assert.equal(safety.liveDeliveryEnabled, false);
    assert.equal(safety.liveDeliveryStatus, "LIVE DISABLED");
    assert.equal(safety.lf2ExecutionEnabled, false);
    assert.equal(safety.lf2GhlCanaryEnabled, false);
    assert.equal(safety.safetyMessage, FULFILLMENT_OPS_SAFETY_MESSAGE);
    assert.equal(safety.flags.SA360_LF2_EXECUTION_ENABLED, false);
  } finally {
    if (prevExec === undefined) delete process.env.SA360_LF2_EXECUTION_ENABLED;
    else process.env.SA360_LF2_EXECUTION_ENABLED = prevExec;
    if (prevCanary === undefined) delete process.env.SA360_LF2_GHL_CANARY_ENABLED;
    else process.env.SA360_LF2_GHL_CANARY_ENABLED = prevCanary;
  }
});

test("presentFulfillmentOpsOrder serializes nullable LF2 fields and blockers safely", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const presented = presentFulfillmentOpsOrder({
    id: "ord_1",
    orderNumber: "LO-1",
    clientAccountId: "client_a",
    clientDisplayName: "Demo Client",
    status: "submitted",
    nicheKey: "TRUCKER",
    productType: null,
    statesJson: ["TX", "OK"],
    states: ["TX", "OK"],
    leadVolume: 5,
    deliveryCadence: null,
    campaignType: "demo",
    crmPackage: "sim",
    aiVoiceAddon: false,
    requestedStartDate: null,
    deliveryDestinationType: null,
    deliveryDestinationLabel: "sim",
    notes: null,
    adminNotes: null,
    trustStatusSnapshotJson: null,
    routingRuleId: null,
    campaignId: null,
    createdByRole: "admin",
    createdByUserId: null,
    submittedAt: now,
    approvedAt: null,
    activatedAt: null,
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    orderKind: null,
    fulfillmentMode: null,
    requestedQuantity: null,
    fulfillmentCycleStart: null,
    fulfillmentCycleEnd: null,
    allowedSourceLanesJson: [],
    proofPolicyKey: null,
    exclusivityRequired: false,
    fulfillmentPriority: 100,
    proposedQuantity: 0,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    createdAt: now,
    updatedAt: now,
  } as never);

  assert.equal(presented.requestedQuantity, null);
  assert.equal(presented.orderKind, null);
  assert.equal(presented.allocationReady, false);
  assert.ok(presented.allocationBlockers.includes("order_status_submitted"));
  assert.ok(presented.allocationBlockers.includes("order_kind_missing_or_unsupported"));
  assert.deepEqual(presented.states, ["TX", "OK"]);
});

test("presentFulfillmentOpsOrder marks active LF2 order allocation-ready", () => {
  const now = new Date("2026-07-22T12:00:00.000Z");
  const presented = presentFulfillmentOpsOrder({
    id: "ord_2",
    orderNumber: "LO-2",
    clientAccountId: "client_a",
    clientDisplayName: null,
    status: "active",
    nicheKey: "VET",
    productType: null,
    statesJson: ["FL"],
    states: ["FL"],
    leadVolume: 3,
    deliveryCadence: null,
    campaignType: "demo",
    crmPackage: "sim",
    aiVoiceAddon: false,
    requestedStartDate: null,
    deliveryDestinationType: "simulation",
    deliveryDestinationLabel: "sim",
    notes: null,
    adminNotes: null,
    trustStatusSnapshotJson: null,
    routingRuleId: null,
    campaignId: null,
    createdByRole: "admin",
    createdByUserId: null,
    submittedAt: now,
    approvedAt: null,
    activatedAt: now,
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    requestedQuantity: 3,
    fulfillmentCycleStart: now,
    fulfillmentCycleEnd: new Date(now.getTime() + 86400000),
    allowedSourceLanesJson: [],
    proofPolicyKey: null,
    exclusivityRequired: false,
    fulfillmentPriority: 100,
    proposedQuantity: 1,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    createdAt: now,
    updatedAt: now,
  } as never);

  assert.equal(presented.allocationReady, true);
  assert.deepEqual(presented.allocationBlockers, []);
  assert.equal(presented.remainingCapacity, 3);
});
