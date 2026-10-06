import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma, type PrismaClient } from "@prisma/client";

import {
  commitPplInventorySelection,
  PPL_SELECTION_TRANSACTION_MAX_WAIT_MS,
  PPL_SELECTION_TRANSACTION_TIMEOUT_MS,
} from "./inventory-selection.service.js";

/**
 * Regression guard for the LO-1057 production defect: the reservation commit ran
 * inside an interactive Serializable transaction that passed only `isolationLevel`,
 * so Prisma's 5s default timeout aborted a measured ~45.7s 300-row reservation and
 * surfaced as an opaque 500 on the normal HTTP route.
 */

type CapturedTx = {
  isolationLevel?: unknown;
  maxWait?: number;
  timeout?: number;
};

function daysAgo(days: number, from: Date): Date {
  return new Date(from.getTime() - days * 86400000);
}

function makeItem(id: string, phone: string, evaluatedAt: Date) {
  return {
    id,
    generatedAt: daysAgo(45, evaluatedAt),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: "NC",
    commerceExcludedAt: null,
    originClientAccountId: null,
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: `evt-${id}`,
      normalizedPayloadJson: {
        contact: {
          first_name: "Ty",
          last_name: id,
          phone_e164: phone,
          email: `${id}@example.test`,
          state: "NC",
        },
      },
      enrichmentMetadataJson: {},
    },
  };
}

/**
 * Fake client that reaches the reservation transaction. `leadOrderLine` is
 * deliberately absent so pricing stays on the unpriced path (this hotfix does
 * not touch pricing).
 */
function buildFakeDb(input: {
  capturedTx: CapturedTx[];
  /** Errors thrown by successive `$transaction` attempts before one succeeds. */
  failures?: Error[];
  rawSql: string[];
}) {
  const failures = [...(input.failures ?? [])];
  const evaluatedAt = new Date();
  const items = [
    makeItem("itemalpha", "+15550000001", evaluatedAt),
    makeItem("itembravo", "+15550000002", evaluatedAt),
  ];

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      input.rawSql.push(sql.replace(/\s+/g, " ").trim());
      if (sql.includes("FOR UPDATE")) {
        return [{ id: values[0], status: "available", commerceExcludedAt: null }];
      }
      if (sql.includes('UPDATE "LeadAllocation"')) {
        return [
          {
            id: values[values.length - 1],
            leadOrderId: "ord_budget",
            status: "reserved",
            leadInventoryItemId: "itemalpha",
          },
        ];
      }
      if (sql.includes('UPDATE "LeadOrder"')) {
        return [{ id: "ord_budget", reservedQuantity: 1 }];
      }
      return [{ id: "itemalpha" }];
    },
    leadAllocation: {
      create: async (args: { data: { leadInventoryItemId: string } }) => ({
        id: `alloc-${args.data.leadInventoryItemId}`,
      }),
    },
    leadOrder: { update: async () => ({}) },
  };

  const db = {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_budget",
        clientAccountId: "client_budget",
        clientDisplayName: "Budget Vet",
        orderNumber: "LO-9057",
        requestedQuantity: 2,
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
    $transaction: async (
      callback: (client: unknown) => Promise<unknown>,
      options?: CapturedTx
    ) => {
      input.capturedTx.push({ ...(options ?? {}) });
      const failure = failures.shift();
      if (failure) throw failure;
      return callback(tx);
    },
  };

  return db as unknown as PrismaClient;
}

async function withSelectionEnabled<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.SA360_PPL_SELECTION_ENABLED;
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.SA360_PPL_SELECTION_ENABLED;
    else process.env.SA360_PPL_SELECTION_ENABLED = previous;
  }
}

test("transaction budget constants leave headroom over the measured 300-row reservation", () => {
  // Production measurement that motivated the fix: 300 rows took ~45.7s.
  const measuredMs = 45_700;
  assert.ok(
    PPL_SELECTION_TRANSACTION_TIMEOUT_MS >= measuredMs * 1.5,
    "timeout must keep meaningful headroom over the measured reservation"
  );
  assert.ok(
    PPL_SELECTION_TRANSACTION_TIMEOUT_MS > PPL_SELECTION_TRANSACTION_MAX_WAIT_MS,
    "timeout must exceed the pool acquisition budget"
  );
  // Both must beat Prisma's 2s/5s interactive-transaction defaults.
  assert.ok(PPL_SELECTION_TRANSACTION_TIMEOUT_MS > 5_000);
  assert.ok(PPL_SELECTION_TRANSACTION_MAX_WAIT_MS > 2_000);
});

test("reservation commit passes explicit maxWait/timeout and keeps Serializable isolation", async () => {
  const capturedTx: CapturedTx[] = [];
  const rawSql: string[] = [];
  const db = buildFakeDb({ capturedTx, rawSql });

  const result = await withSelectionEnabled(() =>
    commitPplInventorySelection(
      {
        orderId: "ord_budget",
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 2,
        idempotencyKey: "budget-key-1",
      },
      db
    )
  );

  assert.equal(result.ok, true);
  assert.equal(capturedTx.length, 1);

  const options = capturedTx[0]!;
  assert.equal(
    options.isolationLevel,
    Prisma.TransactionIsolationLevel.Serializable,
    "isolation must stay Serializable"
  );
  assert.equal(options.maxWait, PPL_SELECTION_TRANSACTION_MAX_WAIT_MS);
  assert.equal(options.timeout, PPL_SELECTION_TRANSACTION_TIMEOUT_MS);

  // Per-item revalidation and its row lock must survive the budget change.
  assert.ok(
    rawSql.some((sql) => sql.includes("FOR UPDATE") && sql.includes('FROM "LeadInventoryItem"')),
    "commit must still lock and revalidate each candidate row"
  );
});

test("serializable retries reuse the same explicit transaction budget", async () => {
  const capturedTx: CapturedTx[] = [];
  const rawSql: string[] = [];
  const db = buildFakeDb({
    capturedTx,
    rawSql,
    // Classified as a serializable conflict, so the existing retry loop engages.
    failures: [new Error("deadlock detected")],
  });

  const result = await withSelectionEnabled(() =>
    commitPplInventorySelection(
      {
        orderId: "ord_budget",
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 2,
        idempotencyKey: "budget-key-2",
      },
      db
    )
  );

  assert.equal(result.ok, true);
  assert.equal(capturedTx.length, 2, "first attempt conflicts, second succeeds");
  for (const options of capturedTx) {
    assert.equal(options.isolationLevel, Prisma.TransactionIsolationLevel.Serializable);
    assert.equal(options.maxWait, PPL_SELECTION_TRANSACTION_MAX_WAIT_MS);
    assert.equal(options.timeout, PPL_SELECTION_TRANSACTION_TIMEOUT_MS);
  }
});

test("exhausted serializable retries still report reservation_conflict with no partial reservation", async () => {
  const capturedTx: CapturedTx[] = [];
  const rawSql: string[] = [];
  const db = buildFakeDb({
    capturedTx,
    rawSql,
    failures: [
      new Error("deadlock detected"),
      new Error("deadlock detected"),
      new Error("deadlock detected"),
    ],
  });

  const result = await withSelectionEnabled(() =>
    commitPplInventorySelection(
      {
        orderId: "ord_budget",
        commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
        requestedQuantity: 2,
        idempotencyKey: "budget-key-3",
      },
      db
    )
  );

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "reservation_conflict");
    assert.equal(result.selectedQuantity, 0);
  }
  assert.equal(capturedTx.length, 3, "retry ceiling is unchanged");
  for (const options of capturedTx) {
    assert.equal(options.timeout, PPL_SELECTION_TRANSACTION_TIMEOUT_MS);
  }
});
