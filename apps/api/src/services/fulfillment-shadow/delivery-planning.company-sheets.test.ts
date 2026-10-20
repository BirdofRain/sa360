import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { planDeliveryInstructionsForAllocation } from "./delivery-planning.service.js";

test("company sheets adapter key is excluded from planning and does not change GHL instructions", async () => {
  const created: string[] = [];
  const db = {
    leadAllocation: {
      findUnique: async () => ({ id: "alloc_1", clientAccountId: "client_a" }),
    },
    deliveryTarget: {
      findMany: async () => [
        {
          id: "ghl-target",
          clientAccountId: "client_a",
          adapterKey: "ghl.crm.v1",
          enabled: true,
          isPrimary: true,
          isRequired: true,
          displayName: "GHL",
          configMetadataJson: { destinationSubaccountIdGhl: "loc_1" },
          readinessStatus: "ready_for_shadow",
        },
        {
          id: "company-sheets",
          clientAccountId: "client_a",
          adapterKey: "google_sheets.company.v1",
          enabled: true,
          isPrimary: false,
          isRequired: true,
          displayName: "Company Sheets",
          configMetadataJson: { spreadsheetId: "sheet", worksheetId: 0 },
          readinessStatus: "configured",
        },
      ],
    },
    deliveryInstruction: {
      createMany: async ({ data }: { data: Array<{ deliveryTargetId: string }> }) => {
        created.push(...data.map((row) => row.deliveryTargetId));
        return { count: data.length };
      },
      findMany: async () =>
        created.map((deliveryTargetId) => ({
          deliveryTargetId,
          deliveryTarget: { id: deliveryTargetId },
        })),
    },
  };
  const result = await planDeliveryInstructionsForAllocation(
    { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
    db as unknown as PrismaClient
  );
  assert.equal(result.ok, true);
  assert.deepEqual(created, ["ghl-target"]);
});
