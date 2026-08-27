import test from "node:test";
import assert from "node:assert/strict";

import { presentLeadOrderListRow } from "./lead-order-present.service.js";

const baseRow = {
  id: "ord_1",
  orderNumber: "LO-1043",
  clientAccountId: "acct_a",
  clientDisplayName: "Summit",
  status: "needs_setup" as const,
  nicheKey: "Insurance",
  productType: null,
  states: ["TX"],
  leadVolume: 100,
  deliveryCadence: null,
  campaignType: "Fresh",
  crmPackage: "GHL",
  aiVoiceAddon: false,
  requestedStartDate: null,
  deliveryDestinationType: null,
  deliveryDestinationLabel: "GHL Summit",
  notes: "Client note",
  adminNotes: "Secret admin note",
  trustStatusSnapshotJson: { warnings: ["GHL not connected"] },
  statesJson: ["TX"],
  routingRuleId: "rule_1",
  campaignId: "camp_1",
  createdByRole: "client" as const,
  createdByUserId: "user_1",
  submittedAt: new Date("2026-07-01T10:00:00.000Z"),
  approvedAt: null,
  activatedAt: null,
  pausedAt: null,
  completedAt: null,
  canceledAt: null,
  paymentConfirmationStatus: "pending_confirmation" as const,
  paymentConfirmedAt: null,
  paymentConfirmedBy: null,
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
  committedAllocationCount: 0,
  createdAt: new Date("2026-07-01T10:00:00.000Z"),
  updatedAt: new Date("2026-07-01T10:00:00.000Z"),
};

test("client output strips adminNotes and internal fields", () => {
  const client = presentLeadOrderListRow(baseRow, "client") as Record<string, unknown>;
  assert.equal(client.adminNotes, undefined);
  assert.equal(client.routingRuleId, undefined);
  assert.equal(client.campaignId, undefined);
  assert.equal(client.createdByUserId, undefined);
  assert.equal(client.trustStatusSnapshot, undefined);
  assert.equal(client.paymentConfirmedAt, undefined);
  assert.equal(client.paymentConfirmedBy, undefined);
  assert.equal(client.paymentConfirmationStatus, "pending_confirmation");
  assert.equal(client.reservedQuantity, undefined);
  assert.equal(client.fulfilledQuantity, undefined);
  assert.equal(client.proposedQuantity, undefined);
  assert.equal(client.committedAllocationCount, undefined);
  assert.ok(Array.isArray(client.setupWarnings));
  assert.equal((client.setupWarnings as string[]).length > 0, true);
  assert.equal(client.fulfillmentAvailable, false);
  assert.equal(client.fulfillment, null);
  assert.equal(
    client.fulfillmentSummary,
    "Fulfillment tracking will appear here once delivery is linked."
  );
});

test("admin output includes admin fields and omits client fulfillment contract", () => {
  const admin = presentLeadOrderListRow(
    {
      ...baseRow,
      paymentConfirmationStatus: "confirmed",
      paymentConfirmedAt: new Date("2026-07-02T10:00:00.000Z"),
      paymentConfirmedBy: "alex",
    },
    "admin"
  ) as Record<string, unknown>;
  assert.equal(admin.adminNotes, "Secret admin note");
  assert.equal(admin.routingRuleId, "rule_1");
  assert.equal(admin.campaignId, "camp_1");
  assert.equal(admin.paymentConfirmationStatus, "confirmed");
  assert.equal(admin.paymentConfirmedAt, "2026-07-02T10:00:00.000Z");
  assert.equal(admin.paymentConfirmedBy, "alex");
  assert.equal(admin.fulfillment, undefined);
  assert.equal(admin.fulfillmentAvailable, undefined);
  assert.equal(admin.fulfillmentSummary, undefined);
});

test("legacy active and completed orders remain readable with stored payment state", () => {
  const legacyActive = presentLeadOrderListRow(
    { ...baseRow, status: "active", paymentConfirmationStatus: "pending_confirmation" },
    "admin"
  ) as Record<string, unknown>;
  const legacyCompleted = presentLeadOrderListRow(
    { ...baseRow, status: "completed", paymentConfirmationStatus: "pending_confirmation" },
    "client"
  ) as Record<string, unknown>;
  assert.equal(legacyActive.status, "active");
  assert.equal(legacyActive.paymentConfirmationStatus, "pending_confirmation");
  assert.equal(legacyCompleted.status, "completed");
  assert.equal(legacyCompleted.paymentConfirmationStatus, "pending_confirmation");
});

test("client fulfillment uses committed allocations, not reserved quantity", () => {
  const client = presentLeadOrderListRow(
    {
      ...baseRow,
      status: "active",
      requestedQuantity: 25,
      reservedQuantity: 7,
      fulfilledQuantity: 0,
      committedAllocationCount: 5,
    },
    "client"
  ) as Record<string, unknown>;
  assert.deepEqual(client.fulfillment, {
    requestedQuantity: 25,
    fulfilledQuantity: 5,
    remainingQuantity: 20,
    status: "in_progress",
  });
  assert.equal(client.fulfillmentAvailable, true);
  assert.equal(client.fulfillmentSummary, "5 of 25 delivered");
  assert.equal(client.reservedQuantity, undefined);
});
