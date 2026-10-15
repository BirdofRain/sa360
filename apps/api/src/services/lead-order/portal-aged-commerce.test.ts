import assert from "node:assert/strict";
import { test } from "node:test";

import type { Prisma } from "@prisma/client";
import { PPL_AGED_PRICING_VERSION } from "@sa360/shared";

import {
  CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED,
  CLIENT_LEAD_ORDER_PRICED_LINE_UNAVAILABLE,
  approveLeadOrder,
  confirmLeadOrderPayment,
  createClientLeadOrder,
  markLeadOrderPaymentNotRequired,
} from "./lead-order.service.js";
import { presentLeadOrderDetail } from "./lead-order-present.service.js";
import {
  applyAuthorizedPortalAgedOrderLineRepair,
  evaluatePortalAgedOrderLineRepair,
  presentAgedCommerceFromNotes,
  readClientAgedCommerceOptions,
  type PortalAgedOrderLineRepairEvidence,
  type PortalAgedOrderLineRepairExpectedSnapshot,
  type PortalAgedRepairDb,
  type PortalAgedRepairTx,
} from "./portal-aged-commerce.js";
import { resolveSelectionCommerceBuckets } from "../ppl-fulfillment/priced-bucket-enforcement.js";

const LO1060_NOTES =
  'Need a Monday start\n---\nsa360.portalAgedOptions.v1 {"requestedAgeBucket":"COMMERCE_6_9_MO","shortfallPolicy":"REFUND_UNFILLED"}';

const readyAccount = async () => ({
  id: "acct_hebda",
  status: "active",
  clientDisplayName: "Sam Hebda test client",
});

const agedBody = {
  nicheKey: "vet",
  states: ["CO", "KS", "CT", "DE", "FL", "GA", "HI", "AZ"] as [
    "CO",
    "KS",
    "CT",
    "DE",
    "FL",
    "GA",
    "HI",
    "AZ",
  ],
  leadVolume: 3,
  campaignType: "Aged leads",
  crmPackage: "lead_delivery",
  aiVoiceAddon: false,
  deliveryDestinationLabel: "Sam Hebda test client",
  notes: LO1060_NOTES,
};

test("portal aged notes parse the canonical 6-9 month bucket and shortfall", () => {
  const aged = readClientAgedCommerceOptions(LO1060_NOTES);
  assert.equal(aged.requestedAgeBucket, "COMMERCE_6_9_MO");
  assert.equal(aged.shortfallPolicy, "REFUND_UNFILLED");
  const presented = presentAgedCommerceFromNotes(LO1060_NOTES);
  assert.equal(presented?.label, "6–9 Months");
});

test("customer submits 3 Veteran 6-9 month leads and persists a priced line atomically", async () => {
  const persisted: { row: Record<string, unknown> | null } = { row: null };
  const created = await createClientLeadOrder(agedBody, "acct_hebda", {
    findClientAccountByIdImpl: readyAccount as never,
    nextLeadOrderNumberImpl: (async () => "LO-3060") as never,
    createLeadOrderRecordImpl: (async (input: Prisma.LeadOrderCreateInput) => {
      persisted.row = input as unknown as Record<string, unknown>;
      return {
        id: "ord_portal_aged",
        orderNumber: "LO-3060",
        notes: input.notes,
        campaignType: input.campaignType,
        nicheKey: input.nicheKey,
        leadVolume: input.leadVolume,
        states: input.statesJson,
        status: "submitted",
        orderKind: input.orderKind,
        fulfillmentMode: input.fulfillmentMode,
        requestedQuantity: input.requestedQuantity,
        pricedPpl: null,
      };
    }) as never,
  });
  assert.equal(created.ok, true);
  const saved = persisted.row;
  assert.ok(saved);
  assert.equal(saved.campaignType, "Aged leads");
  assert.equal(saved.nicheKey, "vet");
  assert.equal(saved.leadVolume, 3);
  assert.equal(saved.orderKind, "pay_per_lead");
  assert.equal(saved.fulfillmentMode, "pooled_matching");
  assert.equal(saved.requestedQuantity, 3);
  assert.match(String(saved.notes), /Need a Monday start/);
  assert.match(String(saved.notes), /sa360\.portalAgedOptions\.v1/);
  const lines = (saved.orderLines as { create: Array<Record<string, unknown>> }).create;
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0]?.ageBandKeysJson, ["COMMERCE_6_9_MO"]);
  assert.equal(lines[0]?.requestedQuantity, 3);
  assert.equal(lines[0]?.unitPriceCents, 300);
  assert.equal(lines[0]?.lineTotalCents, 900);
  const meta = lines[0]?.metadataJson as Record<string, unknown>;
  assert.equal(meta.schema, "ppl_order_line_pricing_v1");
  assert.equal(meta.commerceAgeBucketKey, "COMMERCE_6_9_MO");
  assert.equal(meta.pricingVersion, PPL_AGED_PRICING_VERSION);
  if (created.ok) {
    assert.equal(created.row.pricedPpl?.commerceAgeBucketKey, "COMMERCE_6_9_MO");
    assert.equal(created.row.pricedPpl?.unitPriceCents, 300);
    assert.equal(created.row.pricedPpl?.requestedQuantity, 3);
  }
});

test("payment-not-required and payment-confirmed leave the priced line untouched", async () => {
  const existing = {
    id: "ord_portal_aged",
    status: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
    pricedPpl: {
      lineId: "line_1",
      nicheKey: "vet",
      commerceAgeBucketKey: "COMMERCE_6_9_MO",
      pricingVersion: PPL_AGED_PRICING_VERSION,
      unitPriceCents: 300,
      lineTotalCents: 900,
      requestedQuantity: 3,
      states: ["CO"],
      label: "6–9 Months",
    },
  };
  let paymentPatch: Record<string, unknown> | null = {};
  const notRequired = await markLeadOrderPaymentNotRequired("ord_portal_aged", "alex", {
    findLeadOrderByIdImpl: (async () => existing) as never,
    updateLeadOrderRecordImpl: (async (_id: string, patch: Prisma.LeadOrderUpdateInput) => {
      paymentPatch = patch as Record<string, unknown>;
      return { ...existing, paymentConfirmationStatus: "not_required" };
    }) as never,
  });
  assert.equal(notRequired.ok, true);
  assert.equal(paymentPatch?.paymentConfirmationStatus, "not_required");
  assert.equal("orderLines" in (paymentPatch ?? {}), false);

  const confirmed = await confirmLeadOrderPayment("ord_portal_aged", "alex", {
    findLeadOrderByIdImpl: (async () => ({
      ...existing,
      paymentConfirmationStatus: "pending_confirmation",
    })) as never,
    updateLeadOrderRecordImpl: (async (_id: string, patch: Prisma.LeadOrderUpdateInput) => {
      paymentPatch = patch as Record<string, unknown>;
      return { ...existing, paymentConfirmationStatus: "confirmed" };
    }) as never,
  });
  assert.equal(confirmed.ok, true);
  assert.equal(paymentPatch?.paymentConfirmationStatus, "confirmed");
  assert.equal("orderLines" in (paymentPatch ?? {}), false);
});

test("approve and activate do not reprice a portal aged order", async () => {
  let approvePatch: Record<string, unknown> | null = {};
  const approved = await approveLeadOrder("ord_portal_aged", {
    findLeadOrderByIdImpl: (async () => ({
      id: "ord_portal_aged",
      status: "submitted",
      paymentConfirmationStatus: "not_required",
      campaignType: "Aged leads",
      notes: LO1060_NOTES,
      pricedPpl: { commerceAgeBucketKey: "COMMERCE_6_9_MO", unitPriceCents: 300 },
    })) as never,
    updateLeadOrderRecordImpl: (async (_id: string, patch: Prisma.LeadOrderUpdateInput) => {
      approvePatch = patch as Record<string, unknown>;
      return { id: "ord_portal_aged", status: "ready" };
    }) as never,
  });
  assert.equal(approved.ok, true);
  assert.equal(approvePatch?.status, "ready");
  assert.equal("orderLines" in (approvePatch ?? {}), false);
  assert.equal(approvePatch?.unitPriceCents, undefined);
});

test("Stage 2b locks to the priced 6-9 month bucket and rejects operator override", () => {
  const locked = resolveSelectionCommerceBuckets({
    requestBuckets: ["COMMERCE_6_9_MO"],
    pricedCommerceAgeBucketKey: "COMMERCE_6_9_MO",
  });
  assert.equal(locked.ok, true);
  if (locked.ok) assert.deepEqual(locked.commerceAgeBucketKeys, ["COMMERCE_6_9_MO"]);

  const mismatch = resolveSelectionCommerceBuckets({
    requestBuckets: ["COMMERCE_3_6_MO"],
    pricedCommerceAgeBucketKey: "COMMERCE_6_9_MO",
  });
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) assert.equal(mismatch.code, "priced_bucket_mismatch");
});

test("malformed or missing age bucket cannot persist a priced fulfillment line", async () => {
  const persist = async () => {
    throw new Error("should not persist");
  };
  const deps = {
    findClientAccountByIdImpl: readyAccount as never,
    nextLeadOrderNumberImpl: (async () => "LO-3099") as never,
    createLeadOrderRecordImpl: persist as never,
  };
  const missing = await createClientLeadOrder({ ...agedBody, notes: "Need a Monday start" }, "acct_hebda", deps);
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED);

  const malformed = await createClientLeadOrder(
    {
      ...agedBody,
      notes:
        'Need a Monday start\n---\nsa360.portalAgedOptions.v1 {"requestedAgeBucket":"SIX_TO_NINE","shortfallPolicy":"REFUND_UNFILLED"}',
    },
    "acct_hebda",
    deps
  );
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED);

  const holdBucket = await createClientLeadOrder(
    {
      ...agedBody,
      notes:
        'Need a Monday start\n---\nsa360.portalAgedOptions.v1 {"requestedAgeBucket":"FRESH","shortfallPolicy":"REFUND_UNFILLED"}',
    },
    "acct_hebda",
    deps
  );
  assert.equal(holdBucket.ok, false);
  if (!holdBucket.ok) {
    assert.ok(
      holdBucket.code === CLIENT_LEAD_ORDER_AGED_OPTIONS_REQUIRED ||
        holdBucket.code === CLIENT_LEAD_ORDER_PRICED_LINE_UNAVAILABLE
    );
  }
});

test("client and admin presenters show the same authoritative age selection", () => {
  const row = {
    id: "ord_portal_aged",
    orderNumber: "LO-3060",
    clientAccountId: "acct_hebda",
    clientDisplayName: "Sam Hebda test client",
    status: "active" as const,
    nicheKey: "vet",
    productType: null,
    states: ["CO", "KS"],
    leadVolume: 3,
    deliveryCadence: null,
    campaignType: "Aged leads",
    crmPackage: "lead_delivery",
    aiVoiceAddon: false,
    requestedStartDate: null,
    deliveryDestinationType: null,
    deliveryDestinationLabel: "Sam Hebda",
    notes: LO1060_NOTES,
    adminNotes: null,
    trustStatusSnapshotJson: null,
    statesJson: ["CO", "KS"],
    routingRuleId: null,
    campaignId: null,
    createdByRole: "client" as const,
    createdByUserId: null,
    submittedAt: new Date("2026-10-14T12:00:00.000Z"),
    approvedAt: new Date("2026-10-14T13:00:00.000Z"),
    activatedAt: new Date("2026-10-14T14:00:00.000Z"),
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    paymentConfirmationStatus: "not_required" as const,
    paymentConfirmedAt: new Date("2026-10-14T12:30:00.000Z"),
    paymentConfirmedBy: "alex",
    orderKind: "pay_per_lead" as const,
    fulfillmentMode: "pooled_matching" as const,
    requestedQuantity: 3,
    fulfillmentCycleStart: null,
    fulfillmentCycleEnd: null,
    allowedSourceLanesJson: [],
    proofPolicyKey: null,
    exclusivityRequired: false,
    fulfillmentPriority: 100,
    proposedQuantity: 0,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    reviewCapacityAllowance: 1,
    committedAllocationCount: 0,
    createdAt: new Date("2026-10-14T12:00:00.000Z"),
    updatedAt: new Date("2026-10-14T14:00:00.000Z"),
    pricedPpl: {
      lineId: "line_1",
      nicheKey: "vet",
      commerceAgeBucketKey: "COMMERCE_6_9_MO" as const,
      pricingVersion: PPL_AGED_PRICING_VERSION,
      unitPriceCents: 300,
      lineTotalCents: 900,
      requestedQuantity: 3,
      states: ["CO", "KS"],
      label: "6–9 Months",
    },
  };
  const client = presentLeadOrderDetail(row, "client") as Record<string, unknown>;
  const admin = presentLeadOrderDetail(row, "admin") as Record<string, unknown>;
  assert.deepEqual(client.pricedPpl, admin.pricedPpl);
  assert.deepEqual(client.agedCommerce, admin.agedCommerce);
  assert.equal((client.pricedPpl as { commerceAgeBucketKey: string }).commerceAgeBucketKey, "COMMERCE_6_9_MO");
  assert.equal((client.pricedPpl as { unitPriceCents: number }).unitPriceCents, 300);
  assert.equal((client.agedCommerce as { requestedAgeBucket: string }).requestedAgeBucket, "COMMERCE_6_9_MO");
  assert.equal(String(client.notes).includes("sa360.portalAgedOptions"), false);
  assert.equal(String(admin.notes).includes("sa360.portalAgedOptions"), false);
  assert.match(String(client.notes), /Need a Monday start/);
  assert.equal(client.reviewCapacityAllowance, undefined);
});

const LO1060_STATES = ["CO", "KS", "CT", "DE", "FL", "GA", "HI", "AZ"] as const;

function completeExpected(
  overrides: Partial<PortalAgedOrderLineRepairExpectedSnapshot> = {}
): PortalAgedOrderLineRepairExpectedSnapshot {
  return {
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: [...LO1060_STATES],
    leadVolume: 3,
    paymentConfirmationStatus: "not_required",
    status: "active",
    unitPriceCents: 300,
    pricingVersion: PPL_AGED_PRICING_VERSION,
    ...overrides,
  };
}

function matchingPricedLine(overrides: Record<string, unknown> = {}) {
  return {
    id: "line_1",
    nicheKey: "vet",
    requestedQuantity: 3,
    unitPriceCents: 300,
    lineTotalCents: 900,
    normalizedStatesJson: [...LO1060_STATES],
    ageBandKeysJson: ["COMMERCE_6_9_MO"],
    metadataJson: {
      schema: "ppl_order_line_pricing_v1",
      pricingVersion: PPL_AGED_PRICING_VERSION,
      commerceAgeBucketKey: "COMMERCE_6_9_MO",
      unitPriceCents: 300,
    },
    ...overrides,
  };
}

function completeEvidence(
  overrides: Partial<PortalAgedOrderLineRepairEvidence> = {}
): PortalAgedOrderLineRepairEvidence {
  return {
    orderNumber: "LO-1060",
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: [...LO1060_STATES],
    leadVolume: 3,
    campaignType: "Aged leads",
    notes: LO1060_NOTES,
    paymentConfirmationStatus: "not_required",
    status: "active",
    existingLines: [],
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    proposedQuantity: 0,
    committedAllocationCount: 0,
    allocationRowCount: 0,
    exportPackageCount: 0,
    deliveryReceiptCount: 0,
    expected: completeExpected(),
    ...overrides,
  };
}

test("unpriced legacy orders with one verified bucket are eligible for controlled repair", () => {
  const decision = evaluatePortalAgedOrderLineRepair(completeEvidence());
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.alreadyRepaired, false);
    assert.equal(decision.commerceAgeBucketKey, "COMMERCE_6_9_MO");
    assert.equal(decision.line.snapshot.unitPriceCents, 300);
    assert.equal(decision.line.snapshot.lineTotalCents, 900);
    assert.equal(decision.line.data.lineNumber, 1);
  }
});

test("incomplete comparison evidence fails closed and never treats missing counts as zero", () => {
  const missingExpected = evaluatePortalAgedOrderLineRepair(completeEvidence({ expected: null }));
  assert.equal(missingExpected.eligible, false);
  if (!missingExpected.eligible) assert.equal(missingExpected.code, "comparison_evidence_incomplete");

  const partialExpected = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      expected: {
        clientAccountId: "acct_hebda",
        nicheKey: "vet",
        states: [...LO1060_STATES],
        leadVolume: 3,
        paymentConfirmationStatus: "not_required",
      },
    })
  );
  assert.equal(partialExpected.eligible, false);
  if (!partialExpected.eligible) {
    assert.equal(partialExpected.code, "comparison_evidence_incomplete");
    assert.ok(partialExpected.reasons.includes("expected_status_missing"));
    assert.ok(partialExpected.reasons.includes("expected_quoted_price_missing"));
    assert.ok(partialExpected.reasons.includes("expected_pricing_version_missing"));
  }

  const missingLines = evaluatePortalAgedOrderLineRepair(
    completeEvidence({ existingLines: undefined })
  );
  assert.equal(missingLines.eligible, false);
  if (!missingLines.eligible) assert.equal(missingLines.code, "comparison_evidence_incomplete");

  for (const [field, value] of [
    ["reservedQuantity", undefined],
    ["reservedQuantity", null],
    ["reservedQuantity", Number.NaN],
    ["reservedQuantity", -1],
    ["fulfilledQuantity", 1.5],
    ["proposedQuantity", "0"],
    ["committedAllocationCount", undefined],
    ["allocationRowCount", undefined],
    ["exportPackageCount", null],
    ["deliveryReceiptCount", Number.POSITIVE_INFINITY],
  ] as const) {
    const decision = evaluatePortalAgedOrderLineRepair(completeEvidence({ [field]: value }));
    assert.equal(decision.eligible, false, `${field}=${String(value)} must fail closed`);
    if (!decision.eligible) {
      assert.equal(decision.code, "counts_unverified", `${field}=${String(value)}`);
    }
  }
});

test("duplicate or conflicting notes markers fail closed", () => {
  const duplicate = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      notes: `${LO1060_NOTES}\n---\nsa360.portalAgedOptions.v1 {"requestedAgeBucket":"COMMERCE_3_6_MO","shortfallPolicy":"REFUND_UNFILLED"}`,
    })
  );
  assert.equal(duplicate.eligible, false);
  if (!duplicate.eligible) {
    assert.equal(duplicate.code, "notes_marker_conflict");
    assert.ok(duplicate.reasons.includes("conflicting_portal_aged_option_markers"));
  }

  const incompleteMarker = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      notes: 'Need a Monday start\n---\nsa360.portalAgedOptions.v1 {"requestedAgeBucket":"COMMERCE_6_9_MO"}',
    })
  );
  assert.equal(incompleteMarker.eligible, false);
  if (!incompleteMarker.eligible) assert.equal(incompleteMarker.code, "notes_request_incomplete");
});

test("unrecognized or mismatched existing lines fail closed", () => {
  const unrecognized = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      existingLines: [{ id: "line_note", displayName: "Operator note", nicheKey: "vet", requestedQuantity: 3 }],
    })
  );
  assert.equal(unrecognized.eligible, false);
  if (!unrecognized.eligible) assert.equal(unrecognized.code, "unrecognized_existing_line");

  const mismatchedBucket = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      existingLines: [
        matchingPricedLine({
          unitPriceCents: 400,
          lineTotalCents: 1200,
          ageBandKeysJson: ["COMMERCE_3_6_MO"],
          metadataJson: {
            schema: "ppl_order_line_pricing_v1",
            pricingVersion: PPL_AGED_PRICING_VERSION,
            commerceAgeBucketKey: "COMMERCE_3_6_MO",
            unitPriceCents: 400,
          },
        }),
      ],
    })
  );
  assert.equal(mismatchedBucket.eligible, false);
  if (!mismatchedBucket.eligible) assert.equal(mismatchedBucket.code, "conflicting_priced_order_line");

  const mismatchedPrice = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      existingLines: [matchingPricedLine({ unitPriceCents: 250, lineTotalCents: 750 })],
    })
  );
  assert.equal(mismatchedPrice.eligible, false);
  if (!mismatchedPrice.eligible) assert.equal(mismatchedPrice.code, "conflicting_priced_order_line");
});

test("conflicting, started, or drifted orders fail closed", () => {
  const reserved = evaluatePortalAgedOrderLineRepair(completeEvidence({ reservedQuantity: 1 }));
  assert.equal(reserved.eligible, false);
  if (!reserved.eligible) assert.equal(reserved.code, "fulfillment_already_started");

  const exported = evaluatePortalAgedOrderLineRepair(completeEvidence({ exportPackageCount: 1 }));
  assert.equal(exported.eligible, false);
  if (!exported.eligible) assert.equal(exported.code, "fulfillment_already_started");

  const releasedHistory = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      reservedQuantity: 0,
      fulfilledQuantity: 0,
      proposedQuantity: 0,
      committedAllocationCount: 0,
      allocationRowCount: 1,
    })
  );
  assert.equal(releasedHistory.eligible, false);
  if (!releasedHistory.eligible) {
    assert.equal(releasedHistory.code, "fulfillment_already_started");
    assert.ok(releasedHistory.reasons.includes("historical_allocation_exists"));
  }

  const recoveryRejected = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      allocationRowCount: 1,
      historicalAllocationRecovery: { policy: "recreate_line_after_release", ticket: "TICKET" },
    })
  );
  assert.equal(recoveryRejected.eligible, false);
  if (!recoveryRejected.eligible) {
    assert.equal(recoveryRejected.code, "fulfillment_already_started");
    assert.ok(recoveryRejected.reasons.includes("historical_allocation_recovery_not_approved"));
  }

  const ambiguous = evaluatePortalAgedOrderLineRepair(
    completeEvidence({ notes: "Customer asked for older leads" })
  );
  assert.equal(ambiguous.eligible, false);
  if (!ambiguous.eligible) assert.equal(ambiguous.code, "notes_request_incomplete");

  const priceBlocker = evaluatePortalAgedOrderLineRepair(
    completeEvidence({ expected: completeExpected({ unitPriceCents: 999 }) })
  );
  assert.equal(priceBlocker.eligible, false);
  if (!priceBlocker.eligible) assert.equal(priceBlocker.code, "original_price_unrecoverable");

  const canceled = evaluatePortalAgedOrderLineRepair(completeEvidence({ status: "canceled" }));
  assert.equal(canceled.eligible, false);
  if (!canceled.eligible) assert.equal(canceled.code, "order_status_changed");

  const completed = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      status: "completed",
      expected: completeExpected({ status: "completed" }),
    })
  );
  assert.equal(completed.eligible, false);
  if (!completed.eligible) assert.equal(completed.code, "order_status_changed");
});

test("released historical allocations block repair even when current counters are zero", () => {
  const decision = evaluatePortalAgedOrderLineRepair(
    completeEvidence({
      reservedQuantity: 0,
      fulfilledQuantity: 0,
      proposedQuantity: 0,
      committedAllocationCount: 0,
      allocationRowCount: 2,
    })
  );
  assert.equal(decision.eligible, false);
  if (!decision.eligible) {
    assert.equal(decision.code, "fulfillment_already_started");
    assert.ok(decision.reasons.includes("historical_allocation_exists"));
    assert.equal(decision.reasons.includes("inventory_reserved"), false);
  }
});

test("matching existing line is already-repaired only after full field verification", () => {
  const decision = evaluatePortalAgedOrderLineRepair(
    completeEvidence({ existingLines: [matchingPricedLine()] })
  );
  assert.equal(decision.eligible, true);
  if (decision.eligible) assert.equal(decision.alreadyRepaired, true);

  const wrongQty = evaluatePortalAgedOrderLineRepair(
    completeEvidence({ existingLines: [matchingPricedLine({ requestedQuantity: 2, lineTotalCents: 600 })] })
  );
  assert.equal(wrongQty.eligible, false);
  if (!wrongQty.eligible) assert.equal(wrongQty.code, "conflicting_priced_order_line");
});

function createFakeRepairDb(initial: {
  order: Record<string, unknown>;
  lines?: unknown[];
  allocations?: Array<{ id: string; status: string }>;
  exportCount?: number;
  receiptCount?: number;
  createImpl?: (args: unknown) => Promise<unknown>;
}): PortalAgedRepairDb & {
  lines: unknown[];
  createdCount: number;
  queriesAfterCreateError: number;
  transactionCount: number;
} {
  const state = {
    lines: [...(initial.lines ?? [])],
    createdCount: 0,
    queriesAfterCreateError: 0,
    transactionCount: 0,
  };
  let order = { ...initial.order };
  let createFailedThisTxn = false;
  const noteQuery = () => {
    if (createFailedThisTxn) state.queriesAfterCreateError += 1;
  };
  const db = {
    lines: state.lines,
    get createdCount() {
      return state.createdCount;
    },
    get queriesAfterCreateError() {
      return state.queriesAfterCreateError;
    },
    get transactionCount() {
      return state.transactionCount;
    },
    $transaction: async <T,>(fn: (tx: PortalAgedRepairTx) => Promise<T>) => {
      state.transactionCount += 1;
      createFailedThisTxn = false;
      return fn(db);
    },
    $queryRaw: async () => {
      noteQuery();
      return [{ id: order.id }];
    },
    leadOrder: {
      findUnique: async () => {
        noteQuery();
        return { ...order, orderLines: [...state.lines] };
      },
      update: async (args: { data?: Record<string, unknown> }) => {
        noteQuery();
        order = { ...order, ...(args.data ?? {}) };
        return order;
      },
    },
    leadOrderLine: {
      findMany: async () => {
        noteQuery();
        return [...state.lines];
      },
      create: async (args: unknown) => {
        state.createdCount += 1;
        try {
          if (initial.createImpl) return await initial.createImpl(args);
          const created = { id: `line_${state.createdCount}`, ...(args as { data: Record<string, unknown> }).data };
          state.lines.push(created);
          return created;
        } catch (error) {
          createFailedThisTxn = true;
          throw error;
        }
      },
    },
    leadAllocation: {
      findMany: async () => initial.allocations ?? [],
      count: async () => (initial.allocations ?? []).length,
    },
    leadDeliveryExportPackage: { count: async () => initial.exportCount ?? 0 },
    buyerDeliveredIdentity: { count: async () => initial.receiptCount ?? 0 },
  } as PortalAgedRepairDb & {
    lines: unknown[];
    createdCount: number;
    queriesAfterCreateError: number;
    transactionCount: number;
  };
  return db;
}

const applyAuth = {
  confirmed: true as const,
  ticket: "LO-1060-REPAIR-LOCAL",
  orderNumber: "LO-1060",
};

function legacyUnpricedOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "ord_lo1060",
    orderNumber: "LO-1060",
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    statesJson: [...LO1060_STATES],
    leadVolume: 3,
    campaignType: "Aged leads",
    notes: LO1060_NOTES,
    paymentConfirmationStatus: "not_required",
    status: "active",
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    proposedQuantity: 0,
    orderKind: null,
    fulfillmentMode: null,
    requestedQuantity: null,
    ...overrides,
  };
}

test("authorized local apply writes one line and is idempotent on retry", async () => {
  const db = createFakeRepairDb({ order: legacyUnpricedOrder() });
  const first = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(first.eligible, true);
  assert.equal(first.wrote, true);
  assert.equal(db.createdCount, 1);

  const second = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(second.eligible, true);
  assert.equal(second.alreadyRepaired, true);
  assert.equal(second.wrote, false);
  assert.equal(db.createdCount, 1);
});

test("concurrent unique-constraint retry is already-repaired and never writes a second line", async () => {
  const db = createFakeRepairDb({
    order: legacyUnpricedOrder(),
    createImpl: async () => {
      const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      db.lines.push(matchingPricedLine());
      throw err;
    },
  });
  const result = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(result.eligible, true);
  assert.equal(result.alreadyRepaired, true);
  assert.equal(result.wrote, false);
  assert.equal(db.queriesAfterCreateError, 0);
  assert.ok(db.transactionCount >= 2);
});

test("concurrent retry against a mismatched line fails closed", async () => {
  const db = createFakeRepairDb({
    order: legacyUnpricedOrder(),
    createImpl: async () => {
      const err = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      db.lines.push(
        matchingPricedLine({
          unitPriceCents: 400,
          lineTotalCents: 1200,
          ageBandKeysJson: ["COMMERCE_3_6_MO"],
          metadataJson: {
            schema: "ppl_order_line_pricing_v1",
            pricingVersion: PPL_AGED_PRICING_VERSION,
            commerceAgeBucketKey: "COMMERCE_3_6_MO",
            unitPriceCents: 400,
          },
        })
      );
      throw err;
    },
  });
  const result = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(result.eligible, false);
  assert.equal(result.wrote, false);
  assert.equal(db.queriesAfterCreateError, 0);
  if (!result.eligible) assert.equal(result.code, "conflicting_priced_order_line");
});

test("released historical allocations block apply even when current counters are zero", async () => {
  const db = createFakeRepairDb({
    order: legacyUnpricedOrder(),
    allocations: [{ id: "alloc_released", status: "released" }],
  });
  const result = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(result.eligible, false);
  assert.equal(result.wrote, false);
  if (!result.eligible) {
    assert.equal(result.code, "fulfillment_already_started");
    assert.ok(result.reasons.includes("historical_allocation_exists"));
  }
  assert.equal(db.createdCount, 0);
});

test("apply fails closed when FOR UPDATE locking is unavailable", async () => {
  const db = createFakeRepairDb({ order: legacyUnpricedOrder() });
  delete db.$queryRaw;
  const result = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(result.eligible, false);
  assert.equal(result.wrote, false);
  if (!result.eligible) assert.equal(result.code, "row_lock_unavailable");
  assert.equal(db.createdCount, 0);
});

test("apply fails closed when live status has changed", async () => {
  const db = createFakeRepairDb({ order: legacyUnpricedOrder({ status: "canceled" }) });
  const result = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(result.eligible, false);
  assert.equal(result.wrote, false);
  if (!result.eligible) assert.equal(result.code, "order_status_changed");
});

test("serializable write conflicts retry once then fail closed without throwing", async () => {
  let attempts = 0;
  const db = createFakeRepairDb({ order: legacyUnpricedOrder() });
  db.$transaction = async <T,>(fn: (tx: PortalAgedRepairTx) => Promise<T>) => {
    attempts += 1;
    if (attempts === 1) {
      throw Object.assign(new Error("Raw query failed. Code: `40001`. Message: `could not serialize access due to concurrent update`"), {
        code: "P2010",
        meta: { code: "40001" },
      });
    }
    return fn(db);
  };
  const result = await applyAuthorizedPortalAgedOrderLineRepair(
    {
      orderId: "ord_lo1060",
      expected: completeExpected(),
      authorization: applyAuth,
      environment: "local_test",
    },
    db
  );
  assert.equal(attempts, 2);
  assert.equal(result.eligible, true);
  assert.equal(result.wrote, true);
});

test("production apply is blocked without the matching authorization ticket", async () => {
  const previous = process.env.SA360_PORTAL_AGED_LINE_REPAIR_TICKET;
  delete process.env.SA360_PORTAL_AGED_LINE_REPAIR_TICKET;
  const db = createFakeRepairDb({ order: legacyUnpricedOrder() });
  try {
    const blocked = await applyAuthorizedPortalAgedOrderLineRepair(
      {
        orderId: "ord_lo1060",
        expected: completeExpected(),
        authorization: applyAuth,
        environment: "authorized_production",
      },
      db
    );
    assert.equal(blocked.eligible, false);
    assert.equal(blocked.wrote, false);
    if (!blocked.eligible) assert.equal(blocked.code, "repair_environment_blocked");
    assert.equal(db.createdCount, 0);
  } finally {
    if (previous === undefined) delete process.env.SA360_PORTAL_AGED_LINE_REPAIR_TICKET;
    else process.env.SA360_PORTAL_AGED_LINE_REPAIR_TICKET = previous;
  }
});
