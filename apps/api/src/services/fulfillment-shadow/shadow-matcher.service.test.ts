import test from "node:test";
import assert from "node:assert/strict";
import type { LeadOrder } from "@prisma/client";

import {
  matchPayPerLeadCampaignBound,
  matchPayPerLeadPooled,
  matchRetainerCampaignBound,
  resolveShadowMatch,
  type ShadowMatchContext,
} from "./shadow-matcher.service.js";

function baseOrder(overrides: Partial<LeadOrder> = {}): LeadOrder {
  return {
    id: "order_1",
    orderNumber: "FO-10001",
    clientAccountId: "client_a",
    clientDisplayName: "Client A",
    status: "active",
    nicheKey: "final_expense",
    productType: "fe",
    statesJson: ["NC"],
    leadVolume: 10,
    deliveryCadence: null,
    campaignType: "exclusive",
    crmPackage: "ghl",
    aiVoiceAddon: false,
    requestedStartDate: null,
    deliveryDestinationType: null,
    deliveryDestinationLabel: "Primary",
    notes: null,
    adminNotes: null,
    trustStatusSnapshotJson: null,
    routingRuleId: "rule_1",
    campaignId: "camp_1",
    createdByRole: "admin",
    createdByUserId: null,
    submittedAt: null,
    approvedAt: null,
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    orderKind: "retainer_allocation",
    fulfillmentMode: "campaign_bound",
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as LeadOrder;
}

const context: ShadowMatchContext = {
  sourceLeadEventId: "evt_1",
  clientAccountId: "client_a",
  campaignId: "camp_1",
  routingRuleId: "rule_1",
  nicheKey: "final_expense",
  productType: "fe",
  sourceLane: "meta_lead_ads",
  state: "NC",
};

test("retainer matcher selects exact campaign-bound order", () => {
  const result = matchRetainerCampaignBound([baseOrder()], context);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.selected.id, "order_1");
    assert.ok(result.decisionReasons.includes("selected_exact_campaign_match"));
  }
});

test("retainer matcher rejects inactive order", () => {
  const result = matchRetainerCampaignBound([baseOrder({ status: "paused" })], context);
  assert.equal(result.ok, false);
});

test("ppl matcher excludes full orders and respects priority tie-break", () => {
  const lowPriority = baseOrder({
    id: "order_low",
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    fulfillmentPriority: 10,
    leadVolume: 5,
    fulfilledQuantity: 5,
  });
  const highPriority = baseOrder({
    id: "order_high",
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    fulfillmentPriority: 200,
    activatedAt: new Date("2026-02-01T00:00:00.000Z"),
  });
  const samePriorityOlder = baseOrder({
    id: "order_older",
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    fulfillmentPriority: 200,
    activatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });

  const excluded = matchPayPerLeadPooled([lowPriority], context);
  assert.equal(excluded.ok, false);

  const selected = matchPayPerLeadPooled([highPriority, samePriorityOlder], context);
  assert.equal(selected.ok, true);
  if (selected.ok) assert.equal(selected.selected.id, "order_older");
});

test("resolveShadowMatch replays deterministically for same inputs", () => {
  const orders = [baseOrder(), baseOrder({ id: "order_2", campaignId: "other" })];
  const first = resolveShadowMatch(orders, context);
  const second = resolveShadowMatch(orders, context);
  assert.deepEqual(first, second);
});

test("legacy order without fulfillment fields is never matched", () => {
  const legacy = baseOrder({
    orderKind: null,
    fulfillmentMode: null,
    status: "active",
  });
  const result = resolveShadowMatch([legacy], context);
  assert.equal(result.ok, false);
});

test("ppl remaining capacity ignores proposedQuantity in shadow mode", () => {
  const proposedOnlyFull = baseOrder({
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    leadVolume: 5,
    proposedQuantity: 5,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
  });
  const result = matchPayPerLeadPooled([proposedOnlyFull], context);
  assert.equal(result.ok, true);
});

test("ppl campaign-bound matcher prefers exact campaign over pooled", () => {
  const bound = baseOrder({
    id: "order_bound",
    orderKind: "pay_per_lead",
    fulfillmentMode: "campaign_bound",
    campaignId: "camp_1",
    requestedQuantity: 10,
  });
  const pooled = baseOrder({
    id: "order_pooled",
    orderKind: "pay_per_lead",
    fulfillmentMode: "pooled_matching",
    fulfillmentPriority: 999,
    requestedQuantity: 10,
  });
  const boundOnly = matchPayPerLeadCampaignBound([bound, pooled], context);
  assert.equal(boundOnly.ok, true);
  if (boundOnly.ok) assert.equal(boundOnly.selected.id, "order_bound");

  const resolved = resolveShadowMatch([pooled, bound], context);
  assert.equal(resolved.ok, true);
  if (resolved.ok) assert.equal(resolved.selected.id, "order_bound");
});
