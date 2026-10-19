import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  commitPplInventorySelection,
  PROVENANCE_REVALIDATION_FAILED,
  ORIGIN_CLIENT_REVALIDATION_FAILED,
} from "./inventory-selection.service.js";

/**
 * A preview can observe a LeadCapture row and a later commit can observe a
 * different locked row. Reservation must trust the lock, not the preview.
 */

function daysAgo(days: number, from: Date): Date {
  return new Date(from.getTime() - days * 86400000);
}

function buildFakeDb(input: {
  locked: Record<string, unknown>;
  reservedIds: string[];
  rawSql: string[];
}) {
  const evaluatedAt = new Date();
  const items = [
    {
      id: "item-stale",
      generatedAt: daysAgo(45, evaluatedAt),
      status: "available",
      inventoryClass: "aged",
      nicheKey: "trucker",
      normalizedState: "GA",
      commerceExcludedAt: null,
      originClientAccountId: null,
      sourceProvider: "leadcapture_io",
      metadataJson: {},
      inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
      sourceLeadEvent: {
        id: "evt-stale",
        sourceProvider: "leadcapture_io",
        sourceSystem: "webhook",
        normalizedPayloadJson: {
          contact: {
            first_name: "Ada",
            last_name: "Haul",
            phone_e164: "+14045550121",
            email: "stale.preview@example.test",
            state: "GA",
          },
          lead_details: { consumer_age: 62 },
        },
        rawPayloadJson: {},
        enrichmentMetadataJson: {},
      },
    },
  ];

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      input.rawSql.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("FOR UPDATE")) {
        return [
          {
            id: values[0],
            status: "available",
            commerceExcludedAt: null,
            metadataJson: {},
            normalizedPayloadJson: items[0]!.sourceLeadEvent.normalizedPayloadJson,
            rawPayloadJson: {},
            enrichmentMetadataJson: {},
            ...input.locked,
          },
        ];
      }
      return [{ id: "item-stale" }];
    },
    leadAllocation: {
      create: async (args: { data: { leadInventoryItemId: string } }) => {
        input.reservedIds.push(args.data.leadInventoryItemId);
        return { id: "alloc-should-not-exist" };
      },
    },
    leadOrder: { update: async () => ({}) },
  };

  return {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_stale",
        clientAccountId: "client_buyer",
        clientDisplayName: "JR Laird",
        orderNumber: "LO-PROV",
        requestedQuantity: 1,
        nicheKey: "trucker",
        statesJson: ["GA"],
        campaignType: null,
        notes: null,
        status: "active",
        orderKind: "pay_per_lead",
        canceledAt: null,
        completedAt: null,
        pausedAt: null,
      }),
    },
    leadAllocation: { findMany: async () => [] },
    protectedAgentExclusion: { findMany: async () => [] },
    buyerDeliveredIdentity: { findMany: async () => [] },
    leadInventoryItem: {
      findMany: async (args: { take: number }) => items.slice(0, args.take),
    },
    $transaction: async (callback: (client: unknown) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaClient;
}

async function commitLocked(locked: Record<string, unknown>, idempotencyKey: string) {
  const reservedIds: string[] = [];
  const rawSql: string[] = [];
  const db = buildFakeDb({ locked, reservedIds, rawSql });
  const previous = process.env.SA360_PPL_SELECTION_ENABLED;
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  try {
    const result = await commitPplInventorySelection(
      {
        orderId: "ord_stale",
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 1,
        idempotencyKey,
      },
      db
    );
    return { result, reservedIds, rawSql };
  } finally {
    if (previous === undefined) delete process.env.SA360_PPL_SELECTION_ENABLED;
    else process.env.SA360_PPL_SELECTION_ENABLED = previous;
  }
}

test("a stale preview cannot reserve unresolved-origin inventory under the row lock", async () => {
  const { result, reservedIds, rawSql } = await commitLocked(
    {
      originClientAccountId: null,
      itemSourceProvider: "manual_import",
      eventSourceProvider: "manual_import",
      eventSourceSystem: "csv_import",
    },
    "stale-unresolved-origin"
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "unresolved_provenance");
  assert.deepEqual(result.reasons, [PROVENANCE_REVALIDATION_FAILED]);
  assert.deepEqual(reservedIds, []);
  assert.ok(
    rawSql.some(
      (sql) =>
        sql.includes("FOR UPDATE OF i") &&
        sql.includes('"originClientAccountId"') &&
        sql.includes('"itemSourceProvider"')
    )
  );
});

test("the reservation lock rechecks buyer identity against confirmed origin", async () => {
  const { result, reservedIds } = await commitLocked(
    {
      originClientAccountId: "client_buyer",
      itemSourceProvider: "manual_import",
      eventSourceProvider: "manual_import",
      eventSourceSystem: "csv_import",
    },
    "stale-same-origin"
  );

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "origin_client_ineligible");
  assert.deepEqual(result.reasons, [ORIGIN_CLIENT_REVALIDATION_FAILED]);
  assert.deepEqual(reservedIds, []);
});
