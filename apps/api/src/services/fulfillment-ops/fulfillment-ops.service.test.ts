import assert from "node:assert/strict";
import { test } from "node:test";

import {
  activateFulfillmentOpsOrder,
  buildFulfillmentOpsSafetyPosture,
  createFulfillmentOpsClientLeadOrder,
  FULFILLMENT_OPS_SAFETY_MESSAGE,
  presentFulfillmentOpsOrder,
} from "./fulfillment-ops.service.js";

test("client lead orders reject noncanonical states", async () => {
  await assert.rejects(
    () =>
      createFulfillmentOpsClientLeadOrder(
        {
          clientAccountId: "client_a",
          nicheKey: "vet",
          states: ["South Columbia"],
          requestedQuantity: 1,
          commerceAgeBucketKey: "COMMERCE_1_3_MO",
        },
        {} as never
      ),
    /invalid_states/
  );
});

test("safety posture is simulation-only with live disabled by default", () => {
  const prevExec = process.env.SA360_LF2_EXECUTION_ENABLED;
  const prevCanary = process.env.SA360_LF2_GHL_CANARY_ENABLED;
  const prevReview = process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED;
  const prevReceiptImport = process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
  const prevReceiptSuppression = process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED;
  delete process.env.SA360_LF2_EXECUTION_ENABLED;
  delete process.env.SA360_LF2_GHL_CANARY_ENABLED;
  delete process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED;
  delete process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
  delete process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED;

  try {
    const safety = buildFulfillmentOpsSafetyPosture();
    assert.equal(safety.simulationOnly, true);
    assert.equal(safety.liveDeliveryEnabled, false);
    assert.equal(safety.liveDeliveryStatus, "LIVE DISABLED");
    assert.equal(safety.lf2ExecutionEnabled, false);
    assert.equal(safety.lf2GhlCanaryEnabled, false);
    assert.equal(safety.safetyMessage, FULFILLMENT_OPS_SAFETY_MESSAGE);
    assert.equal(safety.flags.SA360_LF2_EXECUTION_ENABLED, false);
    assert.equal(safety.flags.SA360_PPL_OPERATOR_REVIEW_ENABLED, false);
    assert.equal(safety.flags.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED, false);
    assert.equal(safety.flags.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED, true);
  } finally {
    if (prevExec === undefined) delete process.env.SA360_LF2_EXECUTION_ENABLED;
    else process.env.SA360_LF2_EXECUTION_ENABLED = prevExec;
    if (prevCanary === undefined) delete process.env.SA360_LF2_GHL_CANARY_ENABLED;
    else process.env.SA360_LF2_GHL_CANARY_ENABLED = prevCanary;
    if (prevReview === undefined) delete process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED;
    else process.env.SA360_PPL_OPERATOR_REVIEW_ENABLED = prevReview;
    if (prevReceiptImport === undefined) delete process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED;
    else process.env.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED = prevReceiptImport;
    if (prevReceiptSuppression === undefined) {
      delete process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED;
    } else {
      process.env.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED = prevReceiptSuppression;
    }
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
  assert.equal(presented.pricing, null);
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

type MemoryOrder = Record<string, unknown>;

function activationFixture(overrides: MemoryOrder = {}): MemoryOrder {
  const now = new Date("2026-08-01T12:00:00.000Z");
  return {
    id: "ord_ready",
    orderNumber: "LO-9",
    clientAccountId: "client_a",
    clientDisplayName: "Demo",
    status: "ready",
    nicheKey: "VET",
    productType: null,
    statesJson: ["TX"],
    leadVolume: 4,
    deliveryCadence: null,
    campaignType: "Aged leads",
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
    submittedAt: now,
    approvedAt: now,
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
    reviewCapacityAllowance: 7,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function sameSnapshotValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  if (expected && typeof expected === "object") return false;
  return actual === expected;
}

function rowMatchesSnapshot(
  row: MemoryOrder,
  where: { AND?: MemoryOrder[] }
): boolean {
  const clauses = Array.isArray(where.AND) ? where.AND : [];
  return (
    clauses.length > 0 &&
    clauses.every((clause) =>
      Object.entries(clause).every(([key, expected]) => sameSnapshotValue(row[key], expected))
    )
  );
}

function applyOrderPatch(row: MemoryOrder, data: MemoryOrder): MemoryOrder {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function memoryOrderDb(
  initial: MemoryOrder,
  beforeUpdate?: (row: MemoryOrder) => MemoryOrder
) {
  let stored: MemoryOrder | null = structuredClone(initial);
  const writes: Array<{ where: { AND?: MemoryOrder[] }; data: MemoryOrder }> = [];
  const unconditionalUpdates: unknown[] = [];
  const db = {
    leadOrder: {
      findUnique: async () => (stored ? structuredClone(stored) : null),
      update: async (args: unknown) => {
        unconditionalUpdates.push(args);
        throw new Error("unconditional_update");
      },
      updateMany: async (args: { where: { AND?: MemoryOrder[] }; data: MemoryOrder }) => {
        writes.push({ where: args.where, data: args.data });
        if (!stored) return { count: 0 };
        if (beforeUpdate) stored = beforeUpdate(stored);
        if (!rowMatchesSnapshot(stored, args.where)) return { count: 0 };
        stored = applyOrderPatch(stored, args.data);
        return { count: 1 };
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return {
    db,
    writes,
    unconditionalUpdates,
    read: () => (stored ? structuredClone(stored) : null),
  };
}

function snapshotClause(where: { AND?: MemoryOrder[] } | undefined): MemoryOrder {
  const clause = where?.AND?.[1];
  assert.ok(clause);
  return clause;
}

test("activateFulfillmentOpsOrder requires ready and does not jump from submitted", async () => {
  const submittedDb = {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_sub",
        status: "submitted",
        statesJson: ["TX"],
      }),
    },
  };
  const submitted = await activateFulfillmentOpsOrder("ord_sub", submittedDb as never);
  assert.equal(submitted.ok, false);
  if (!submitted.ok) {
    assert.equal(submitted.error, "submitted_cannot_activate");
    assert.ok(submitted.reasons.includes("activation_requires_ready"));
  }

  let activated = false;
  const interestDb = {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_interest",
        status: "ready",
        statesJson: ["TX"],
        campaignType: "availability_interest:live_transfer",
        notes: null,
      }),
      update: async () => {
        activated = true;
        return {};
      },
      updateMany: async () => {
        activated = true;
        return { count: 1 };
      },
    },
    $transaction: async () => {
      activated = true;
      return { matched: true, order: null };
    },
  };
  const interest = await activateFulfillmentOpsOrder("ord_interest", interestDb as never);
  assert.equal(interest.ok, false);
  if (!interest.ok) assert.equal(interest.error, "availability_interest_only");
  assert.equal(activated, false);

  const legacyDb = {
    leadOrder: {
      findUnique: async () =>
        activationFixture({
          id: "ord_legacy",
          campaignType: "Live transfer",
          notes: null,
          leadVolume: 3,
        }),
      update: async () => {
        throw new Error("unconditional_update");
      },
      updateMany: async () => {
        throw new Error("legacy_live_transfer_reached_update");
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(legacyDb),
  };
  await assert.rejects(
    () => activateFulfillmentOpsOrder("ord_legacy", legacyDb as never),
    /legacy_live_transfer_reached_update/
  );
});

test("rejected activation leaves every order field unchanged", async () => {
  const initial = activationFixture({
    requestedQuantity: 2,
    reservedQuantity: 2,
    fulfilledQuantity: 0,
    leadVolume: 2,
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
  });
  const harness = memoryOrderDb(initial);
  const before = harness.read();

  const result = await activateFulfillmentOpsOrder("ord_ready", harness.db as never);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "order_not_allocation_ready");
    assert.deepEqual(result.reasons, ["order_capacity_exhausted"]);
  }
  assert.equal(harness.writes.length, 0);
  assert.equal(harness.unconditionalUpdates.length, 0);
  assert.deepEqual(harness.read(), before);
});

test("successful activation fills defaults and pins the validated snapshot", async () => {
  const harness = memoryOrderDb(
    activationFixture({
      fulfilledQuantity: 1,
      campaignType: "Live transfer",
      notes: "historical transfer",
    })
  );

  const result = await activateFulfillmentOpsOrder("ord_ready", harness.db as never);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.order.status, "active");
  assert.equal(result.order.orderKind, "pay_per_lead");
  assert.equal(result.order.fulfillmentMode, "pooled_matching");
  assert.equal(result.order.requestedQuantity, 4);
  assert.equal(result.order.allocationReady, true);
  assert.equal(result.order.remainingCapacity, 3);
  assert.equal(harness.writes.length, 1);
  assert.equal(harness.unconditionalUpdates.length, 0);

  const snapshot = snapshotClause(harness.writes[0]?.where);
  assert.equal(snapshot.status, "ready");
  assert.equal(typeof snapshot.status, "string");
  assert.equal(snapshot.reservedQuantity, 0);
  assert.equal(snapshot.fulfilledQuantity, 1);
  assert.equal(snapshot.requestedQuantity, null);
  assert.equal(snapshot.leadVolume, 4);
  assert.equal(snapshot.orderKind, null);
  assert.equal(snapshot.fulfillmentMode, null);
  assert.equal(snapshot.campaignType, "Live transfer");
  assert.equal(snapshot.notes, "historical transfer");
  assert.equal(snapshot.canceledAt, null);
  assert.equal(snapshot.completedAt, null);
  assert.equal(snapshot.pausedAt, null);
  assert.equal(snapshot.activatedAt, null);
  assert.equal(snapshot.reviewCapacityAllowance, undefined);

  const data = harness.writes[0]?.data;
  assert.ok(data);
  assert.equal(data.status, "active");
  assert.equal(data.orderKind, "pay_per_lead");
  assert.equal(data.fulfillmentMode, "pooled_matching");
  assert.equal(data.requestedQuantity, 4);
  assert.equal(data.pausedAt, null);
  assert.ok(data.activatedAt instanceof Date);
  assert.ok(data.fulfillmentCycleStart instanceof Date);
  assert.ok(data.fulfillmentCycleEnd instanceof Date);
  assert.equal(
    (data.fulfillmentCycleEnd as Date).getTime() - (data.fulfillmentCycleStart as Date).getTime(),
    7 * 24 * 60 * 60 * 1000
  );
});

test("repeated activation of an allocation-ready order keeps the original activatedAt", async () => {
  const activatedAt = new Date("2026-08-01T00:00:00.000Z");
  const cycleEnd = new Date("2026-08-08T00:00:00.000Z");
  const harness = memoryOrderDb(
    activationFixture({
      status: "active",
      activatedAt,
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 3,
      leadVolume: 3,
      fulfillmentCycleStart: activatedAt,
      fulfillmentCycleEnd: cycleEnd,
    })
  );

  const result = await activateFulfillmentOpsOrder("ord_ready", harness.db as never);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.order.status, "active");
  assert.equal(result.order.activatedAt, activatedAt.toISOString());
  assert.equal(harness.writes.length, 1);
  const snapshot = snapshotClause(harness.writes[0]?.where);
  assert.equal(snapshot.status, "active");
  assert.ok(snapshot.activatedAt instanceof Date);
  assert.equal((snapshot.activatedAt as Date).getTime(), activatedAt.getTime());
  const data = harness.writes[0]?.data;
  assert.ok(data);
  assert.equal((data.activatedAt as Date).getTime(), activatedAt.getTime());
  assert.equal(data.orderKind, undefined);
  assert.equal(data.requestedQuantity, undefined);
  assert.equal(data.fulfillmentCycleStart, undefined);
  assert.equal((harness.read()?.activatedAt as Date).getTime(), activatedAt.getTime());
});

test("paused orders still activate and clear pausedAt", async () => {
  const pausedAt = new Date("2026-08-02T00:00:00.000Z");
  const harness = memoryOrderDb(
    activationFixture({
      status: "paused",
      pausedAt,
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 3,
      leadVolume: 3,
    })
  );

  const result = await activateFulfillmentOpsOrder("ord_ready", harness.db as never);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.order.status, "active");
  assert.equal(result.order.allocationReady, true);
  const stored = harness.read();
  assert.equal(stored?.status, "active");
  assert.equal(stored?.pausedAt, null);
  assert.ok(stored?.activatedAt instanceof Date);
  const snapshot = snapshotClause(harness.writes[0]?.where);
  assert.equal(snapshot.status, "paused");
  assert.ok(snapshot.pausedAt instanceof Date);
  assert.equal((snapshot.pausedAt as Date).getTime(), pausedAt.getTime());
});

test("a concurrent capacity change invalidates activation without a write", async () => {
  const harness = memoryOrderDb(
    activationFixture({
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 3,
      leadVolume: 3,
      reservedQuantity: 0,
      fulfilledQuantity: 0,
    }),
    (row) => ({ ...row, reservedQuantity: 3 })
  );

  const result = await activateFulfillmentOpsOrder("ord_ready", harness.db as never);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "order_not_allocation_ready");
    assert.ok(result.reasons.includes("order_capacity_exhausted"));
  }
  assert.equal(harness.unconditionalUpdates.length, 0);
  const stored = harness.read();
  assert.equal(stored?.status, "ready");
  assert.equal(stored?.activatedAt, null);
  assert.equal(stored?.reservedQuantity, 3);
  assert.equal(stored?.orderKind, "pay_per_lead");
});

test("a concurrent edit that still looks activatable does not apply the stale patch", async () => {
  const harness = memoryOrderDb(
    activationFixture({
      orderKind: "pay_per_lead",
      fulfillmentMode: "pooled_matching",
      requestedQuantity: 4,
      leadVolume: 4,
      notes: null,
    }),
    (row) => ({ ...row, notes: "changed after read", leadVolume: 9 })
  );

  const result = await activateFulfillmentOpsOrder("ord_ready", harness.db as never);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "activation_conflict");
    assert.deepEqual(result.reasons, ["activation_snapshot_changed"]);
  }
  assert.equal(harness.unconditionalUpdates.length, 0);
  const stored = harness.read();
  assert.equal(stored?.status, "ready");
  assert.equal(stored?.activatedAt, null);
  assert.equal(stored?.notes, "changed after read");
  assert.equal(stored?.leadVolume, 9);
  assert.equal(stored?.requestedQuantity, 4);
});

test("a concurrent activation that already left the order ready is idempotent", async () => {
  const winnerActivatedAt = new Date("2026-08-03T00:00:00.000Z");
  const harness = memoryOrderDb(activationFixture({ leadVolume: 4 }), (row) => ({
    ...row,
    status: "active",
    activatedAt: winnerActivatedAt,
    pausedAt: null,
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    requestedQuantity: 4,
    fulfillmentCycleStart: winnerActivatedAt,
    fulfillmentCycleEnd: new Date("2026-08-10T00:00:00.000Z"),
  }));

  const result = await activateFulfillmentOpsOrder("ord_ready", harness.db as never);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.order.status, "active");
  assert.equal(result.order.activatedAt, winnerActivatedAt.toISOString());
  assert.equal(result.order.allocationReady, true);
  assert.equal((harness.read()?.activatedAt as Date).getTime(), winnerActivatedAt.getTime());
  assert.equal(harness.unconditionalUpdates.length, 0);
});
