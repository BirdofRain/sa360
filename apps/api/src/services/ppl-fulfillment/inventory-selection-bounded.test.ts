import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  PPL_SELECTION_MAX_SCANNED_ROWS,
  PPL_SELECTION_PAGE_SIZE,
  queryEligibleInventoryCandidatesBounded,
} from "./inventory-selection.service.js";

type FakeItem = {
  id: string;
  generatedAt: Date;
  status: string;
  inventoryClass: string;
  nicheKey: string;
  normalizedState: string;
  inventoryLot: { supplierAccountId: string | null; status: string };
  sourceLeadEvent: {
    id: string;
    normalizedPayloadJson: unknown;
    enrichmentMetadataJson: unknown;
  };
};

function daysAgo(days: number, evaluatedAt: Date): Date {
  return new Date(evaluatedAt.getTime() - days * 86400000);
}

function makeItem(input: {
  id: string;
  ageDays: number;
  evaluatedAt: Date;
  phone: string;
  email: string;
  state?: string;
}): FakeItem {
  return {
    id: input.id,
    generatedAt: daysAgo(input.ageDays, input.evaluatedAt),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: input.state ?? "NC",
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: `evt-${input.id}`,
      normalizedPayloadJson: {
        contact: {
          first_name: "T",
          last_name: input.id,
          phone_e164: input.phone,
          email: input.email,
          state: input.state ?? "NC",
        },
      },
      enrichmentMetadataJson: {},
    },
  };
}

function buildFakeDb(allItems: FakeItem[], priorFingerprints: Array<{ phone?: string; email?: string }> = []) {
  let findManyCalls = 0;
  const db = {
    buyerDeliveredIdentity: {
      findMany: async () =>
        priorFingerprints.map((row) => ({
          phoneFingerprint: row.phone ?? null,
          emailFingerprint: row.email ?? null,
        })),
    },
    leadInventoryItem: {
      findMany: async (args: {
        where: Record<string, unknown>;
        orderBy: unknown;
        take: number;
      }) => {
        findManyCalls += 1;
        const take = args.take;
        // Apply a simplified cursor filter: AND may contain generatedAt/id cursor.
        let rows = [...allItems].sort((a, b) => {
          const d = a.generatedAt.getTime() - b.generatedAt.getTime();
          if (d !== 0) return d;
          return a.id.localeCompare(b.id);
        });

        const and = args.where.AND as Array<Record<string, unknown>> | undefined;
        if (and) {
          for (const clause of and) {
            if (clause.OR && Array.isArray(clause.OR)) {
              const or = clause.OR as Array<Record<string, unknown>>;
              // Cursor shape: generatedAt gt OR (generatedAt eq + id gt)
              if (or.some((entry) => entry.id != null || entry.generatedAt != null)) {
                const gtGen = or.find((entry) => {
                  const g = entry.generatedAt as { gt?: Date } | Date | undefined;
                  return g && typeof g === "object" && "gt" in g;
                });
                const eqGen = or.find((entry) => entry.id != null);
                if (gtGen || eqGen) {
                  const cursorGen =
                    (gtGen?.generatedAt as { gt?: Date } | undefined)?.gt ??
                    (eqGen?.generatedAt as Date | undefined);
                  const cursorId = (eqGen?.id as { gt?: string } | undefined)?.gt;
                  rows = rows.filter((row) => {
                    if (!cursorGen) return true;
                    if (row.generatedAt.getTime() > cursorGen.getTime()) return true;
                    if (
                      cursorId &&
                      row.generatedAt.getTime() === cursorGen.getTime() &&
                      row.id > cursorId
                    ) {
                      return true;
                    }
                    return false;
                  });
                }
              }
            }
          }
        }

        return rows.slice(0, take);
      },
    },
  };

  return {
    db: db as unknown as PrismaClient,
    getFindManyCalls: () => findManyCalls,
  };
}

test("bounded selection pages until target eligible then stops", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const items: FakeItem[] = [];
  for (let i = 0; i < 400; i += 1) {
    items.push(
      makeItem({
        id: `item-${String(i).padStart(4, "0")}`,
        ageDays: 45,
        evaluatedAt,
        phone: `+1555000${String(i).padStart(4, "0")}`,
        email: `lead${i}@example.test`,
      })
    );
  }

  const { db, getFindManyCalls } = buildFakeDb(items);
  const result = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 10,
      pageSize: 50,
      maxScannedRows: 500,
    },
    db
  );

  assert.equal(result.candidates.length, 10);
  assert.ok(result.pagesRead >= 1);
  assert.ok(result.rowsScanned <= 50); // first page had enough after classify
  assert.equal(result.scanCeilingHit, false);
  assert.ok(getFindManyCalls() <= 2);
  // FCFS: earliest generatedAt / id first
  assert.equal(result.candidates[0]?.item.id, "item-0000");
});

test("bounded selection respects max scanned ceiling on shortage", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  // All rows invalid identity → never become eligible, scan must stop at ceiling.
  const items: FakeItem[] = [];
  for (let i = 0; i < 300; i += 1) {
    const item = makeItem({
      id: `bad-${i}`,
      ageDays: 45,
      evaluatedAt,
      phone: "",
      email: "",
    });
    item.sourceLeadEvent.normalizedPayloadJson = { contact: { state: "NC" } };
    items.push(item);
  }

  const { db } = buildFakeDb(items);
  const result = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 50,
      pageSize: 40,
      maxScannedRows: 120,
    },
    db
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.rowsScanned, 120);
  assert.equal(result.scanCeilingHit, true);
  assert.ok(result.pagesRead <= Math.ceil(120 / 40));
  assert.ok(result.exclusionCounts.invalidIdentity > 0);
});

test("same-buyer prior delivery excludes matching fingerprints in bounded scan", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const { fingerprintIdentityValue } = await import("../../lib/identity-fingerprint.js");
  const phone = "+15551110001";
  const email = "prior@example.test";
  const items = [
    makeItem({ id: "z", ageDays: 40, evaluatedAt, phone, email }),
    makeItem({
      id: "ok",
      ageDays: 41,
      evaluatedAt,
      phone: "+15551110002",
      email: "ok@example.test",
    }),
  ];
  const { db } = buildFakeDb(items, [
    {
      phone: fingerprintIdentityValue("phone", phone),
      email: fingerprintIdentityValue("email", email),
    },
  ]);

  const result = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 10,
      pageSize: PPL_SELECTION_PAGE_SIZE,
      maxScannedRows: PPL_SELECTION_MAX_SCANNED_ROWS,
    },
    db
  );

  assert.deepEqual(
    result.candidates.map((c) => c.item.id),
    ["ok"]
  );
  assert.equal(result.exclusionCounts.sameBuyerPriorDelivery, 1);
});
