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
  assert.ok(Array.isArray(client.setupWarnings));
  assert.equal((client.setupWarnings as string[]).length > 0, true);
});

test("admin output includes admin fields", () => {
  const admin = presentLeadOrderListRow(baseRow, "admin") as Record<string, unknown>;
  assert.equal(admin.adminNotes, "Secret admin note");
  assert.equal(admin.routingRuleId, "rule_1");
  assert.equal(admin.campaignId, "camp_1");
});
