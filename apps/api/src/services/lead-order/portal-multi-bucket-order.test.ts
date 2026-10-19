import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import { presentLeadOrderListRow } from "./lead-order-present.service.js";
import {
  CLIENT_LEAD_ORDER_LINE_INVALID,
  CLIENT_LEAD_ORDER_MULTI_BUCKET_DISABLED,
  createClientLeadOrder,
} from "./lead-order.service.js";
import type { PortalOrderIdempotencyStore } from "./portal-order-idempotency.js";

const readyAccount = async () => ({
  id: "acct_buyer",
  status: "active",
  clientDisplayName: "Buyer",
});

function memoryStore(): PortalOrderIdempotencyStore {
  const values = new Map<string, string>();
  return {
    async claim(key) {
      const existing = values.get(key);
      if (existing) return existing;
      values.set(key, "pending");
      return "acquired";
    },
    async complete(key, orderId) {
      values.set(key, orderId);
    },
    async release(key) {
      if (values.get(key) === "pending") values.delete(key);
    },
  };
}

const base = {
  nicheKey: "vet",
  states: ["TX", "CO"] as ["TX", "CO"],
  leadVolume: 5,
  campaignType: "Aged leads",
  crmPackage: "lead_delivery",
  aiVoiceAddon: false,
  deliveryDestinationLabel: "Buyer CRM",
  shortfallPolicy: "REFUND_UNFILLED" as const,
  idempotencyKey: "portal-order-abcdef12",
  lines: [
    { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
    { commerceAgeBucketKey: "COMMERCE_3_6_MO", requestedQuantity: 3 },
  ],
};

test("multi-bucket orders stay disabled unless the portal flag is on", async () => {
  const rejected = await createClientLeadOrder(base, "acct_buyer", {
    findClientAccountByIdImpl: readyAccount as never,
    multiBucketEnabled: false,
    idempotencyStore: memoryStore(),
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.code, CLIENT_LEAD_ORDER_MULTI_BUCKET_DISABLED);
});

test("one order persists every priced line and ignores tampered browser totals", async () => {
  const creates: Prisma.LeadOrderCreateInput[] = [];
  const created = await createClientLeadOrder(
    {
      ...base,
      notes: "Call after 4",
      lines: base.lines.map((line) => ({ ...line, unitPriceCents: 1, lineTotalCents: 1 }) as never),
    },
    "acct_buyer",
    {
      findClientAccountByIdImpl: readyAccount as never,
      nextLeadOrderNumberImpl: (async () => "LO-5001") as never,
      multiBucketEnabled: true,
      idempotencyStore: memoryStore(),
      createLeadOrderRecordImpl: (async (input: Prisma.LeadOrderCreateInput) => {
        creates.push(input);
        return {
          id: "ord_multi",
          orderNumber: "LO-5001",
          clientAccountId: "acct_buyer",
          notes: input.notes,
          campaignType: input.campaignType,
          nicheKey: input.nicheKey,
          leadVolume: input.leadVolume,
          states: input.statesJson,
          status: "submitted",
          paymentConfirmationStatus: "pending_confirmation",
          requestedQuantity: input.requestedQuantity,
          pricedPpl: null,
        };
      }) as never,
    }
  );
  assert.equal(creates.length, 1);
  assert.equal(created.ok, true);
  const saved = creates[0]!;
  assert.equal(saved.leadVolume, 5);
  assert.equal(saved.requestedQuantity, 5);
  assert.equal(saved.paymentConfirmationStatus, "pending_confirmation");
  assert.match(String(saved.notes), /sa360\.portalAgedLines\.v1/);
  assert.equal(String(saved.notes).includes("COMMERCE_1_3_MO"), false);
  const lines = (saved.orderLines as { create: Array<Record<string, unknown>> }).create;
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.unitPriceCents, 600);
  assert.equal(lines[0]?.lineTotalCents, 1200);
  assert.equal(lines[1]?.unitPriceCents, 400);
  assert.equal(lines[1]?.lineTotalCents, 1200);
  assert.deepEqual(
    lines.map((line) => line.ageBandKeysJson),
    [["COMMERCE_1_3_MO"], ["COMMERCE_3_6_MO"]]
  );
});

test("duplicate buckets and a retried idempotency key do not create another order", async () => {
  const store = memoryStore();
  let creates = 0;
  const deps = {
    findClientAccountByIdImpl: readyAccount as never,
    nextLeadOrderNumberImpl: (async () => "LO-5002") as never,
    multiBucketEnabled: true,
    idempotencyStore: store,
    findLeadOrderByIdImpl: (async () => ({
      id: "ord_once",
      clientAccountId: "acct_buyer",
      orderNumber: "LO-5002",
    })) as never,
    createLeadOrderRecordImpl: (async () => {
      creates += 1;
      return { id: "ord_once", clientAccountId: "acct_buyer", orderNumber: "LO-5002", pricedPpl: null };
    }) as never,
  };
  const duplicate = await createClientLeadOrder(
    {
      ...base,
      lines: [
        { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 2 },
        { commerceAgeBucketKey: "COMMERCE_1_3_MO", requestedQuantity: 3 },
      ],
    },
    "acct_buyer",
    deps
  );
  assert.equal(duplicate.ok, false);
  if (!duplicate.ok) assert.equal(duplicate.code, CLIENT_LEAD_ORDER_LINE_INVALID);
  assert.equal(creates, 0);

  const first = await createClientLeadOrder(base, "acct_buyer", deps);
  assert.equal(first.ok, true);
  assert.equal(creates, 1);
  const retry = await createClientLeadOrder(base, "acct_buyer", deps);
  assert.equal(retry.ok, true);
  if (retry.ok) assert.equal(retry.row.id, "ord_once");
  assert.equal(creates, 1);
});

test("presented lines keep their own shortfall and do not price the order from the first bucket", () => {
  const presented = presentLeadOrderListRow(
    {
      id: "ord_multi",
      orderNumber: "LO-5001",
      clientAccountId: "acct_buyer",
      clientDisplayName: "Buyer",
      status: "submitted",
      nicheKey: "vet",
      productType: null,
      states: ["TX"],
      leadVolume: 5,
      deliveryCadence: null,
      campaignType: "Aged leads",
      crmPackage: "GHL",
      aiVoiceAddon: false,
      requestedStartDate: null,
      deliveryDestinationType: null,
      deliveryDestinationLabel: "CRM",
      notes: 'sa360.portalAgedLines.v1 {"shortfallPolicy":"ALLOW_OLDER_WITH_PRICE_ADJUSTMENT","lineCount":2}',
      adminNotes: null,
      trustStatusSnapshotJson: null,
      statesJson: ["TX"],
      routingRuleId: null,
      campaignId: null,
      createdByRole: "client",
      createdByUserId: null,
      submittedAt: new Date("2026-10-19T15:00:00.000Z"),
      approvedAt: null,
      activatedAt: null,
      pausedAt: null,
      completedAt: null,
      canceledAt: null,
      paymentConfirmationStatus: "pending_confirmation",
      paymentConfirmedAt: null,
      paymentConfirmedBy: null,
      requestedQuantity: 5,
      committedAllocationCount: 1,
      createdAt: new Date("2026-10-19T15:00:00.000Z"),
      updatedAt: new Date("2026-10-19T15:00:00.000Z"),
      pricedPpl: null,
      orderLines: [
        {
          id: "ln_1",
          lineNumber: 1,
          status: "active",
          requestedQuantity: 2,
          reservedQuantity: 0,
          fulfilledQuantity: 0,
          unitPriceCents: 600,
          lineTotalCents: 1200,
          metadataJson: {
            schema: "ppl_order_line_pricing_v1",
            pricingVersion: "ppl_aged_beta_2026_08_v1",
            commerceAgeBucketKey: "COMMERCE_1_3_MO",
            unitPriceCents: 600,
          },
        },
        {
          id: "ln_2",
          lineNumber: 2,
          status: "active",
          requestedQuantity: 3,
          reservedQuantity: 0,
          fulfilledQuantity: 0,
          unitPriceCents: 400,
          lineTotalCents: 1200,
          metadataJson: {
            schema: "ppl_order_line_pricing_v1",
            pricingVersion: "ppl_aged_beta_2026_08_v1",
            commerceAgeBucketKey: "COMMERCE_3_6_MO",
            unitPriceCents: 400,
          },
        },
      ],
      lineProgress: {
        ln_1: { reserved: 0, fulfilled: 1 },
        ln_2: { reserved: 1, fulfilled: 0 },
      },
    } as never,
    "client"
  ) as {
    lines: Array<{
      lineId: string;
      shortfallQuantity: number;
      fulfilledQuantity: number;
      potentialCreditCents: number;
      unitPriceCents: number;
    }>;
    orderTotalCents: number;
    shortfallPolicy: string;
    pricedPpl: { unitPriceCents: number; lineTotalCents: number };
    notes: string | null;
  };
  assert.equal(presented.orderTotalCents, 2400);
  assert.equal(presented.pricedPpl.unitPriceCents, 600);
  assert.equal(presented.pricedPpl.lineTotalCents, 1200);
  assert.equal(presented.lines[0]?.fulfilledQuantity, 1);
  assert.equal(presented.lines[0]?.shortfallQuantity, 1);
  assert.equal(presented.lines[0]?.potentialCreditCents, 600);
  assert.equal(presented.lines[1]?.fulfilledQuantity, 0);
  assert.equal(presented.lines[1]?.shortfallQuantity, 3);
  assert.equal(presented.lines[1]?.potentialCreditCents, 1200);
  assert.equal(presented.shortfallPolicy, "ALLOW_OLDER_WITH_PRICE_ADJUSTMENT");
  assert.equal(presented.notes, null);
});
