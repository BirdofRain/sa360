import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { planDeliveryInstructionsForAllocation } from "./delivery-planning.service.js";
import { getDeliveryAdapter } from "./delivery-adapter.registry.js";

test("AM/AN/AL. google_sheets.v1 is excluded from planning and does not change GHL instructions", async () => {
  const created: Array<{ deliveryTargetId: string; isRequired: boolean }> = [];
  const ghl = {
    id: "ghl-target",
    clientAccountId: "client_a",
    adapterKey: "ghl.crm.v1",
    enabled: true,
    isPrimary: true,
    isRequired: true,
    displayName: "GHL",
    configMetadataJson: { destinationSubaccountIdGhl: "loc_1" },
    readinessStatus: "ready_for_shadow",
  };
  const sheets = {
    id: "sheets-target",
    clientAccountId: "client_a",
    adapterKey: "google_sheets.v1",
    enabled: true,
    isPrimary: false,
    isRequired: true,
    displayName: "Google Sheets",
    configMetadataJson: { spreadsheetId: "sheet", worksheetId: 0 },
    readinessStatus: "configured",
  };
  const db = {
    leadAllocation: {
      findUnique: async () => ({ id: "alloc_1", clientAccountId: "client_a" }),
    },
    deliveryTarget: {
      findMany: async () => [ghl, sheets],
    },
    deliveryInstruction: {
      createMany: async ({ data }: { data: Array<{ deliveryTargetId: string; isRequired: boolean }> }) => {
        created.push(...data);
        return { count: data.length };
      },
      findMany: async () =>
        created.map((row, index) => ({
          id: `instr_${index}`,
          ...row,
          deliveryTarget: row.deliveryTargetId === "ghl-target" ? ghl : sheets,
        })),
    },
  } as unknown as PrismaClient;

  const withoutSheetsCreated: typeof created = [];
  const dbGhlOnly = {
    ...db,
    deliveryTarget: { findMany: async () => [ghl] },
    deliveryInstruction: {
      createMany: async ({ data }: { data: Array<{ deliveryTargetId: string; isRequired: boolean }> }) => {
        withoutSheetsCreated.push(...data);
        return { count: data.length };
      },
      findMany: async () =>
        withoutSheetsCreated.map((row, index) => ({
          id: `instr_${index}`,
          ...row,
          deliveryTarget: ghl,
        })),
    },
  } as unknown as PrismaClient;

  const before = await planDeliveryInstructionsForAllocation(
    { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
    dbGhlOnly
  );
  const after = await planDeliveryInstructionsForAllocation(
    { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
    db
  );
  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  assert.equal(created.length, 1);
  assert.equal(created[0]?.deliveryTargetId, "ghl-target");
  assert.deepEqual(
    created.map((row) => row.deliveryTargetId),
    withoutSheetsCreated.map((row) => row.deliveryTargetId)
  );
});

test("AM. a Sheets-only enabled target does not plan any DeliveryInstruction", async () => {
  const created: unknown[] = [];
  const db = {
    leadAllocation: {
      findUnique: async () => ({ id: "alloc_1", clientAccountId: "client_a" }),
    },
    deliveryTarget: {
      findMany: async () => [
        {
          id: "sheets-target",
          clientAccountId: "client_a",
          adapterKey: "google_sheets.v1",
          enabled: true,
          isPrimary: true,
          isRequired: true,
          configMetadataJson: { spreadsheetId: "sheet", worksheetId: 0 },
        },
      ],
    },
    deliveryInstruction: {
      createMany: async ({ data }: { data: unknown[] }) => {
        created.push(...data);
        return { count: data.length };
      },
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
  const result = await planDeliveryInstructionsForAllocation(
    { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
    db
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "no_enabled_targets");
  assert.equal(created.length, 0);
});

test("google_sheets.v1 validateTarget stays dormant even when spreadsheet metadata is present", () => {
  const adapter = getDeliveryAdapter("google_sheets.v1");
  assert.ok(adapter);
  const result = adapter!.validateTarget({
    configMetadata: { spreadsheetId: "abc", worksheetId: 0, connectionRefId: "conn" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "google_sheets_live_delivery_not_enabled");
});
