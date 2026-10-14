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
  evaluatePortalAgedOrderLineRepair,
  presentAgedCommerceFromNotes,
  readClientAgedCommerceOptions,
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
  let paymentPatch: Record<string, unknown> | null = null;
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
  let approvePatch: Record<string, unknown> | null = null;
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
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
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

test("unpriced legacy orders with one verified bucket are eligible for controlled repair", () => {
  const decision = evaluatePortalAgedOrderLineRepair({
    orderNumber: "LO-1060",
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: ["CO", "KS", "CT", "DE", "FL", "GA", "HI", "AZ"],
    leadVolume: 3,
    campaignType: "Aged leads",
    notes: LO1060_NOTES,
    paymentConfirmationStatus: "not_required",
    status: "active",
    existingLines: [],
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    committedAllocationCount: 0,
    exportPackageCount: 0,
    deliveryReceiptCount: 0,
    expected: {
      clientAccountId: "acct_hebda",
      nicheKey: "vet",
      states: ["CO", "KS", "CT", "DE", "FL", "GA", "HI", "AZ"],
      leadVolume: 3,
      paymentConfirmationStatus: "not_required",
    },
    expectedUnitPriceCents: 300,
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) {
    assert.equal(decision.alreadyRepaired, false);
    assert.equal(decision.commerceAgeBucketKey, "COMMERCE_6_9_MO");
    assert.equal(decision.line.snapshot.unitPriceCents, 300);
    assert.equal(decision.line.snapshot.lineTotalCents, 900);
  }
});

test("conflicting or started legacy orders fail closed", () => {
  const conflicting = evaluatePortalAgedOrderLineRepair({
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: ["CO"],
    leadVolume: 3,
    notes: LO1060_NOTES,
    existingLines: [
      {
        metadataJson: {
          schema: "ppl_order_line_pricing_v1",
          pricingVersion: PPL_AGED_PRICING_VERSION,
          commerceAgeBucketKey: "COMMERCE_3_6_MO",
          unitPriceCents: 400,
        },
        unitPriceCents: 400,
        lineTotalCents: 1200,
        ageBandKeysJson: ["COMMERCE_3_6_MO"],
        requestedQuantity: 3,
        nicheKey: "vet",
      },
    ],
  });
  assert.equal(conflicting.eligible, false);
  if (!conflicting.eligible) assert.equal(conflicting.code, "conflicting_priced_order_line");

  const reserved = evaluatePortalAgedOrderLineRepair({
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: ["CO"],
    leadVolume: 3,
    notes: LO1060_NOTES,
    existingLines: [],
    reservedQuantity: 1,
  });
  assert.equal(reserved.eligible, false);
  if (!reserved.eligible) assert.equal(reserved.code, "fulfillment_already_started");

  const ambiguous = evaluatePortalAgedOrderLineRepair({
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: ["CO"],
    leadVolume: 3,
    notes: "Customer asked for older leads",
    existingLines: [],
  });
  assert.equal(ambiguous.eligible, false);
  if (!ambiguous.eligible) assert.equal(ambiguous.code, "notes_request_incomplete");

  const priceBlocker = evaluatePortalAgedOrderLineRepair({
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: ["CO"],
    leadVolume: 3,
    notes: LO1060_NOTES,
    existingLines: [],
    expectedUnitPriceCents: 999,
  });
  assert.equal(priceBlocker.eligible, false);
  if (!priceBlocker.eligible) assert.equal(priceBlocker.code, "original_price_unrecoverable");
});

test("matching existing line is idempotent already-repaired", () => {
  const decision = evaluatePortalAgedOrderLineRepair({
    clientAccountId: "acct_hebda",
    nicheKey: "vet",
    states: ["CO"],
    leadVolume: 3,
    notes: LO1060_NOTES,
    existingLines: [
      {
        id: "line_1",
        metadataJson: {
          schema: "ppl_order_line_pricing_v1",
          pricingVersion: PPL_AGED_PRICING_VERSION,
          commerceAgeBucketKey: "COMMERCE_6_9_MO",
          unitPriceCents: 300,
        },
        unitPriceCents: 300,
        lineTotalCents: 900,
        ageBandKeysJson: ["COMMERCE_6_9_MO"],
        requestedQuantity: 3,
        nicheKey: "vet",
      },
    ],
  });
  assert.equal(decision.eligible, true);
  if (decision.eligible) assert.equal(decision.alreadyRepaired, true);
});
