import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  CONSUMER_AGE_REVALIDATION_FAILED,
  commitPplInventorySelection,
} from "./inventory-selection.service.js";

/**
 * The reservation commit must re-resolve CONSUMER age from the locked inventory
 * row rather than trusting the preview-time resolution. A row whose age has
 * since gone missing, become unusable, or crossed the maximum sellable age must
 * fail closed with no partial reservation.
 */

function daysAgo(days: number, from: Date): Date {
  return new Date(from.getTime() - days * 86400000);
}

type PayloadBag = Record<string, unknown>;

function makeItem(input: {
  id: string;
  phone: string;
  evaluatedAt: Date;
  normalizedPayloadJson: PayloadBag;
}) {
  return {
    id: input.id,
    generatedAt: daysAgo(45, input.evaluatedAt),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: "NC",
    commerceExcludedAt: null,
    originClientAccountId: null,
    metadataJson: {},
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: `evt-${input.id}`,
      normalizedPayloadJson: {
        contact: {
          first_name: "Ty",
          last_name: input.id,
          phone_e164: input.phone,
          email: `${input.id}@example.test`,
          state: "NC",
        },
        ...input.normalizedPayloadJson,
      },
      rawPayloadJson: {},
      enrichmentMetadataJson: {},
    },
  };
}

/**
 * Reaches the reservation transaction. `lockedPayload` is what the row lock
 * observes, which may deliberately differ from what the scan observed.
 */
function buildFakeDb(input: {
  scanPayload: PayloadBag;
  lockedPayload: PayloadBag;
  rawSql: string[];
  reservedIds: string[];
}) {
  const evaluatedAt = new Date();
  const items = [
    makeItem({
      id: "itemalpha",
      phone: "+15550000001",
      evaluatedAt,
      normalizedPayloadJson: input.scanPayload,
    }),
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
            normalizedPayloadJson: input.lockedPayload,
            rawPayloadJson: {},
            enrichmentMetadataJson: {},
          },
        ];
      }
      if (sql.includes('UPDATE "LeadAllocation"')) {
        return [
          {
            id: values[values.length - 1],
            leadOrderId: "ord_age",
            status: "reserved",
            leadInventoryItemId: "itemalpha",
          },
        ];
      }
      if (sql.includes('UPDATE "LeadOrder"')) {
        return [{ id: "ord_age", reservedQuantity: 1 }];
      }
      return [{ id: "itemalpha" }];
    },
    leadAllocation: {
      create: async (args: { data: { leadInventoryItemId: string } }) => {
        input.reservedIds.push(args.data.leadInventoryItemId);
        return { id: `alloc-${args.data.leadInventoryItemId}` };
      },
    },
    leadOrder: { update: async () => ({}) },
  };

  const db = {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_age",
        clientAccountId: "client_age",
        clientDisplayName: "Age Policy Vet",
        orderNumber: "LO-9099",
        requestedQuantity: 1,
        nicheKey: "vet",
        statesJson: ["NC"],
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
  };

  return db as unknown as PrismaClient;
}

async function commitWithPayloads(input: {
  scanPayload: PayloadBag;
  lockedPayload: PayloadBag;
  idempotencyKey: string;
}) {
  const rawSql: string[] = [];
  const reservedIds: string[] = [];
  const db = buildFakeDb({
    scanPayload: input.scanPayload,
    lockedPayload: input.lockedPayload,
    rawSql,
    reservedIds,
  });
  const previous = process.env.SA360_PPL_SELECTION_ENABLED;
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  try {
    const result = await commitPplInventorySelection(
      {
        orderId: "ord_age",
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 1,
        idempotencyKey: input.idempotencyKey,
      },
      db
    );
    return { result, rawSql, reservedIds };
  } finally {
    if (previous === undefined) delete process.env.SA360_PPL_SELECTION_ENABLED;
    else process.env.SA360_PPL_SELECTION_ENABLED = previous;
  }
}

const ELIGIBLE = { lead_details: { consumer_age: "62" } };

test("commit revalidates consumer age under the inventory row lock", async () => {
  const { result, rawSql, reservedIds } = await commitWithPayloads({
    scanPayload: ELIGIBLE,
    lockedPayload: ELIGIBLE,
    idempotencyKey: "age-reval-ok",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(reservedIds, ["itemalpha"]);
  assert.ok(
    rawSql.some(
      (sql) =>
        sql.includes("FOR UPDATE OF i") &&
        sql.includes('"normalizedPayloadJson"') &&
        sql.includes('"rawPayloadJson"')
    ),
    "the locking query must read the payloads age is resolved from"
  );
});

test("an age that disappeared after preview fails the commit closed", async () => {
  const { result, reservedIds } = await commitWithPayloads({
    scanPayload: ELIGIBLE,
    lockedPayload: {},
    idempotencyKey: "age-reval-missing",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "consumer_age_required");
  assert.deepEqual(result.reasons, [CONSUMER_AGE_REVALIDATION_FAILED]);
  assert.equal(result.selectedQuantity, 0);
  assert.equal(result.shortfallQuantity, 1);
  assert.deepEqual(reservedIds, [], "no partial reservation may remain");
});

test("a DOB that crosses the maximum sellable age before reservation fails closed", async () => {
  const turns87 = new Date();
  turns87.setUTCFullYear(turns87.getUTCFullYear() - 87);
  turns87.setUTCDate(turns87.getUTCDate() - 1);
  const dob = turns87.toISOString().slice(0, 10);

  const { result, reservedIds } = await commitWithPayloads({
    // Preview-time resolution saw a stale, still-sellable stored age.
    scanPayload: { lead_details: { consumer_age: "86" } },
    lockedPayload: { lead_details: { consumer_age: "86", date_of_birth: dob } },
    idempotencyKey: "age-reval-over-max",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "consumer_age_required");
  assert.deepEqual(reservedIds, []);
});

test("an unusable age value at commit time fails closed rather than exporting blank", async () => {
  const { result, reservedIds } = await commitWithPayloads({
    scanPayload: ELIGIBLE,
    lockedPayload: { lead_details: { consumer_age: "not-an-age" } },
    idempotencyKey: "age-reval-invalid",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "consumer_age_required");
  assert.deepEqual(reservedIds, []);
});
