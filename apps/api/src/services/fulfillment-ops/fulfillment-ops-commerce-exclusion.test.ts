import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { prepareFulfillmentOpsCandidate } from "./fulfillment-ops.service.js";

function readyOrder() {
  return {
    id: "ord_1",
    orderNumber: "LO-1",
    clientAccountId: "client_a",
    clientDisplayName: "Demo",
    status: "active",
    nicheKey: "vet",
    productType: null,
    statesJson: ["NC"],
    leadVolume: 1,
    deliveryCadence: null,
    campaignType: "demo",
    crmPackage: "sim",
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
    submittedAt: new Date(),
    approvedAt: null,
    activatedAt: new Date(),
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    requestedQuantity: 1,
    fulfillmentCycleStart: null,
    fulfillmentCycleEnd: null,
    allowedSourceLanesJson: [],
    proofPolicyKey: null,
    exclusivityRequired: false,
    fulfillmentPriority: 100,
    proposedQuantity: 0,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("workbench prepare rejects a commerce-excluded available item", async () => {
  const db = {
    leadOrder: {
      findUnique: async () => readyOrder(),
    },
    leadInventoryItem: {
      findUnique: async () => ({
        id: "inv_ex",
        status: "available",
        commerceExcludedAt: new Date("2026-08-24T16:00:00.000Z"),
        nicheKey: "vet",
        normalizedState: "NC",
        sourceLeadEventId: "evt_ex",
      }),
    },
  } as unknown as PrismaClient;

  const result = await prepareFulfillmentOpsCandidate(
    { leadOrderId: "ord_1", inventoryItemId: "inv_ex" },
    db
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, "inventory_commerce_excluded");
    assert.deepEqual(result.reasons, ["inventory_commerce_excluded"]);
  }
});
