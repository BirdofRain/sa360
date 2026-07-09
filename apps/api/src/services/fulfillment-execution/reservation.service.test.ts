import test from "node:test";
import assert from "node:assert/strict";
import type { LeadAllocation, LeadOrder, PrismaClient } from "@prisma/client";

import { validateReservationEligibility } from "./reservation-eligibility.service.js";
import { reserveLeadAllocation } from "./reservation.service.js";
import { buildReservationIdempotencyKey } from "./fulfillment-execution-keys.js";

type AllocationFixture = LeadAllocation & {
  leadOrder: LeadOrder;
  deliveryInstructions: Array<{ id: string; isRequired: boolean; status: string }>;
};

function baseOrder(overrides: Partial<LeadOrder> = {}): LeadOrder {
  return {
    id: "order_1",
    orderNumber: "ORD-1",
    clientAccountId: "client_a",
    clientDisplayName: null,
    status: "active",
    nicheKey: "solar",
    productType: null,
    statesJson: [],
    leadVolume: 10,
    deliveryCadence: null,
    campaignType: "lead_gen",
    crmPackage: "basic",
    aiVoiceAddon: false,
    requestedStartDate: null,
    deliveryDestinationType: null,
    deliveryDestinationLabel: null,
    notes: null,
    adminNotes: null,
    trustStatusSnapshotJson: null,
    routingRuleId: null,
    campaignId: null,
    createdByRole: "admin",
    createdByUserId: null,
    submittedAt: null,
    approvedAt: null,
    activatedAt: new Date(),
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    requestedQuantity: 5,
    fulfillmentCycleStart: null,
    fulfillmentCycleEnd: null,
    allowedSourceLanesJson: [],
    proofPolicyKey: null,
    exclusivityRequired: false,
    fulfillmentPriority: 100,
    proposedQuantity: 1,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LeadOrder;
}

function baseAllocation(overrides: Partial<AllocationFixture> = {}): AllocationFixture {
  return {
    id: "alloc_1",
    sourceLeadEventId: "evt_1",
    leadOrderId: "order_1",
    clientAccountId: "client_a",
    status: "shadow",
    allocationPolicyVersion: "1.0.0",
    decisionReasonsJson: [],
    candidateCount: 1,
    idempotencyKey: "allocation:shadow:evt_1:1.0.0",
    reservationIdempotencyKey: null,
    reservationPolicyVersion: null,
    releaseReasonJson: null,
    reviewReasonJson: null,
    proposedAt: new Date(),
    reservedAt: null,
    committedAt: null,
    releasedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    leadOrder: baseOrder(),
    deliveryInstructions: [{ id: "instr_1", isRequired: true, status: "planned" }],
    ...overrides,
  };
}

test("validateReservationEligibility rejects inactive order", async () => {
  const allocation = baseAllocation({
    leadOrder: baseOrder({ status: "paused", pausedAt: new Date() }),
  });
  const db = {
    leadAllocation: { findFirst: async () => null },
  } as unknown as PrismaClient;

  const result = await validateReservationEligibility(allocation, db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "order_not_active");
});

test("validateReservationEligibility rejects null requestedQuantity", async () => {
  const allocation = baseAllocation({
    leadOrder: baseOrder({ requestedQuantity: null }),
  });
  const db = {
    leadAllocation: { findFirst: async () => null },
  } as unknown as PrismaClient;

  const result = await validateReservationEligibility(allocation, db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "order_not_configured");
});

test("validateReservationEligibility rejects ineligible assessment", async () => {
  const allocation = baseAllocation();
  const db = {
    leadAllocation: { findFirst: async () => null },
    leadEligibilityAssessment: {
      findUnique: async () => ({ status: "review_required" }),
    },
  } as unknown as PrismaClient;

  const result = await validateReservationEligibility(allocation, db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "ineligible_assessment");
});

test("validateReservationEligibility rejects missing required instruction", async () => {
  const allocation = baseAllocation({ deliveryInstructions: [] });
  const db = {
    leadAllocation: { findFirst: async () => null },
    leadEligibilityAssessment: {
      findUnique: async () => ({ status: "eligible" }),
    },
  } as unknown as PrismaClient;

  const result = await validateReservationEligibility(allocation, db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "missing_required_instruction");
});

test("validateReservationEligibility rejects exclusive source conflict", async () => {
  const allocation = baseAllocation();
  const db = {
    leadAllocation: {
      findFirst: async () => ({ id: "alloc_other", status: "reserved" }),
    },
    leadEligibilityAssessment: {
      findUnique: async () => ({ status: "eligible" }),
    },
  } as unknown as PrismaClient;

  const result = await validateReservationEligibility(allocation, db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "exclusive_source_conflict");
});

test("validateReservationEligibility rejects full order capacity", async () => {
  const allocation = baseAllocation({
    leadOrder: baseOrder({ requestedQuantity: 2, reservedQuantity: 1, fulfilledQuantity: 1 }),
  });
  const db = {
    leadAllocation: { findFirst: async () => null },
    leadEligibilityAssessment: {
      findUnique: async () => ({ status: "eligible" }),
    },
  } as unknown as PrismaClient;

  const result = await validateReservationEligibility(allocation, db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "capacity_exhausted");
});

test("validateReservationEligibility rejects cross-tenant mismatch", async () => {
  const allocation = baseAllocation({
    clientAccountId: "client_a",
    leadOrder: baseOrder({ clientAccountId: "client_b" }),
  });
  const db = {
    leadAllocation: { findFirst: async () => null },
  } as unknown as PrismaClient;

  const result = await validateReservationEligibility(allocation, db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "tenant_mismatch");
});

test("reserveLeadAllocation replays without double increment", async () => {
  const reservationKey = buildReservationIdempotencyKey("alloc_1");
  const db = {
    leadAllocation: {
      findUnique: async ({ where }: { where: { reservationIdempotencyKey?: string; id?: string } }) => {
        if (where.reservationIdempotencyKey === reservationKey) {
          return {
            id: "alloc_1",
            leadOrderId: "order_1",
            status: "reserved",
            leadOrder: { reservedQuantity: 1 },
          };
        }
        return null;
      },
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;

  const result = await reserveLeadAllocation("alloc_1", db);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.status, "already_reserved");
    assert.equal(result.reservedQuantity, 1);
  }
});

test("reserveLeadAllocation rejects tenant override path via missing allocation", async () => {
  const db = {
    leadAllocation: {
      findUnique: async () => null,
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;

  const result = await reserveLeadAllocation("missing", db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "allocation_not_found");
});
