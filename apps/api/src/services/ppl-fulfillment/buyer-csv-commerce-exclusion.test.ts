import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";

import { reserveLeadAllocationAtomicTx } from "../fulfillment-execution/reservation.service.js";
import { queryEligibleInventoryCandidatesBounded } from "./inventory-selection.service.js";

const EXPORTABLE_ALLOCATION_STATUSES = ["reserved", "delivering", "committed"] as const;

test("excluded item cannot be selected or reserved and therefore cannot enter buyer CSV", async () => {
  const evaluatedAt = new Date("2026-08-24T00:00:00.000Z");
  const item = {
    id: "inv_csv_ex",
    generatedAt: new Date(evaluatedAt.getTime() - 90 * 86400000),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: "NC",
    commerceExcludedAt: new Date("2026-08-24T16:00:00.000Z"),
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: "evt_csv_ex",
      normalizedPayloadJson: {
        contact: {
          first_name: "Ty",
          last_name: "Csv",
          phone_e164: "+15553000999",
          email: "csvex@example.test",
          state: "NC",
        },
        lead_details: { consumer_age: 55 },
      },
      enrichmentMetadataJson: {},
    },
  };

  const allocations: Array<{ leadInventoryItemId: string; status: string }> = [];
  const db = {
    buyerDeliveredIdentity: { findMany: async () => [] },
    leadInventoryItem: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        if (args.where.commerceExcludedAt === null && item.commerceExcludedAt != null) {
          return [];
        }
        return [item];
      },
    },
    leadAllocation: {
      findMany: async (args: { where: { leadInventoryItemId?: string; status?: { in: string[] } } }) => {
        return allocations.filter((row) => {
          if (args.where.leadInventoryItemId && row.leadInventoryItemId !== args.where.leadInventoryItemId) {
            return false;
          }
          if (args.where.status?.in && !args.where.status.in.includes(row.status)) {
            return false;
          }
          return true;
        });
      },
    },
  } as unknown as PrismaClient;

  const scan = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO", "COMMERCE_3_6_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 5,
    },
    db
  );
  assert.equal(scan.candidates.length, 0);

  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(" ");
      if (sql.includes("LeadAllocation")) {
        return [
          {
            id: "alloc_csv",
            leadOrderId: "order_csv",
            status: "reserved",
            leadInventoryItemId: item.id,
          },
        ];
      }
      if (sql.includes("LeadOrder")) {
        return [{ id: "order_csv", reservedQuantity: 1 }];
      }
      if (sql.includes("LeadInventoryItem")) {
        return [];
      }
      return [];
    },
  };

  await assert.rejects(
    () =>
      reserveLeadAllocationAtomicTx(
        "alloc_csv",
        "res-csv",
        tx as never
      ),
    /inventory_reserve_failed/
  );

  const exportable = await db.leadAllocation.findMany({
    where: {
      leadInventoryItemId: item.id,
      status: { in: [...EXPORTABLE_ALLOCATION_STATUSES] },
    },
  });
  assert.equal(exportable.length, 0);
});
