import assert from "node:assert/strict";
import { test } from "node:test";
import type { LeadAllocation, LeadOrder, Prisma, PrismaClient } from "@prisma/client";

import { reserveLeadAllocationAtomicTx } from "./reservation.service.js";
import { validateReservationEligibility } from "./reservation-eligibility.service.js";

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
    nicheKey: "vet",
    productType: null,
    statesJson: ["NC"],
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
    leadOrderLineId: null,
    leadInventoryItemId: "inv_1",
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

test("validateReservationEligibility rejects commerce-excluded inventory", async () => {
  const db = {
    leadInventoryItem: {
      findUnique: async () => ({ commerceExcludedAt: new Date("2026-08-24T16:00:00.000Z") }),
    },
  } as unknown as PrismaClient;
  const result = await validateReservationEligibility(baseAllocation(), db);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "inventory_commerce_excluded");
});

test("validateReservationEligibility still allows a normal available item", async () => {
  const db = {
    leadInventoryItem: {
      findUnique: async () => ({ commerceExcludedAt: null }),
    },
    leadAllocation: { findFirst: async () => null },
    leadEligibilityAssessment: {
      findUnique: async () => ({ status: "eligible" }),
    },
  } as unknown as PrismaClient;
  const result = await validateReservationEligibility(baseAllocation(), db);
  assert.equal(result.ok, true);
});

test("atomic reserve UPDATE matches zero rows for a commerce-excluded item", async () => {
  const sqlSeen: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      sqlSeen.push(sql);
      if (sql.includes("LeadAllocation")) {
        return [
          {
            id: "alloc_1",
            leadOrderId: "order_1",
            status: "reserved",
            leadInventoryItemId: "inv_1",
          },
        ];
      }
      if (sql.includes("LeadOrder")) {
        return [{ id: "order_1", reservedQuantity: 1 }];
      }
      if (sql.includes("LeadInventoryItem")) {
        assert.match(sql, /commerceExcludedAt/);
        return [];
      }
      return [];
    },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    () => reserveLeadAllocationAtomicTx("alloc_1", "res-key", tx),
    /inventory_reserve_failed/
  );
  assert.ok(sqlSeen.some((sql) => sql.includes("commerceExcludedAt")));
});

test("race: selection-visible item that is then excluded cannot reserve", async () => {
  const item = {
    id: "inv_race",
    commerceExcludedAt: null as Date | null,
    status: "available",
  };
  const selected = item.commerceExcludedAt == null && item.status === "available";
  assert.equal(selected, true);

  item.commerceExcludedAt = new Date();

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("LeadAllocation")) {
        return [
          {
            id: "alloc_race",
            leadOrderId: "order_1",
            status: "reserved",
            leadInventoryItemId: item.id,
          },
        ];
      }
      if (sql.includes("LeadOrder")) {
        return [{ id: "order_1", reservedQuantity: 1 }];
      }
      if (sql.includes("LeadInventoryItem")) {
        if (item.commerceExcludedAt != null) return [];
        return [{ id: item.id }];
      }
      return [];
    },
  } as unknown as Prisma.TransactionClient;

  await assert.rejects(
    () => reserveLeadAllocationAtomicTx("alloc_race", "res-race", tx),
    /inventory_reserve_failed/
  );
});
