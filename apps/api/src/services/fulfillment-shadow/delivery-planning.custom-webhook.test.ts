import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import { planDeliveryInstructionsForAllocation } from "./delivery-planning.service.js";

type Target = {
  id: string;
  clientAccountId: string;
  adapterKey: string;
  enabled: boolean;
  isPrimary: boolean;
  isRequired: boolean;
  displayName: string;
  configMetadataJson: Record<string, unknown>;
  readinessStatus: string;
};

const ghlTarget: Target = {
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

function sheetsTarget(adapterKey: string, id: string): Target {
  return {
    id,
    clientAccountId: "client_a",
    adapterKey,
    enabled: true,
    isPrimary: false,
    isRequired: true,
    displayName: adapterKey,
    configMetadataJson: { spreadsheetId: "sheet", worksheetId: 0 },
    readinessStatus: "configured",
  };
}

function webhookTarget(): Target {
  return {
    id: "webhook-target",
    clientAccountId: "client_a",
    adapterKey: "webhook.generic.v1",
    enabled: true,
    isPrimary: false,
    isRequired: true,
    displayName: "Webhook",
    configMetadataJson: {},
    readinessStatus: "ready_for_shadow",
  };
}

function plannerDb(targets: Target[]) {
  const created: Array<{ deliveryTargetId: string; sequence: number; isRequired: boolean; status: string }> = [];
  const db = {
    leadAllocation: {
      findUnique: async () => ({ id: "alloc_1", clientAccountId: "client_a" }),
    },
    deliveryTarget: {
      findMany: async () => targets,
    },
    deliveryInstruction: {
      createMany: async ({ data }: { data: typeof created }) => {
        created.push(...data);
        return { count: data.length };
      },
      findMany: async () =>
        created.map((row) => ({
          ...row,
          deliveryTarget: targets.find((target) => target.id === row.deliveryTargetId) ?? null,
        })),
    },
  };
  return { created, db: db as unknown as PrismaClient };
}

test("an enabled webhook target does not plan while the flag is off, and GHL still plans", async () => {
  const targets = [
    ghlTarget,
    webhookTarget(),
    sheetsTarget("google_sheets.v1", "sheets-target"),
    sheetsTarget("google_sheets.company.v1", "company-sheets-target"),
  ];
  const withExtras = plannerDb(targets);
  const ghlOnly = plannerDb([ghlTarget]);

  const mixed = await planDeliveryInstructionsForAllocation(
    { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
    withExtras.db,
    {}
  );
  const only = await planDeliveryInstructionsForAllocation(
    { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
    ghlOnly.db,
    { SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: "TRUE" }
  );

  assert.equal(mixed.ok, true);
  assert.equal(only.ok, true);
  assert.deepEqual(withExtras.created, [
    {
      leadAllocationId: "alloc_1",
      deliveryTargetId: "ghl-target",
      sequence: 1,
      isRequired: true,
      status: "planned",
    },
  ]);
  assert.deepEqual(withExtras.created, ghlOnly.created);
});

test("webhook-only and loose flag values create no DeliveryInstruction", async () => {
  for (const value of [undefined, "", "false", "TRUE", "1", "yes", "on"]) {
    const { created, db } = plannerDb([webhookTarget()]);
    const result = await planDeliveryInstructionsForAllocation(
      { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
      db,
      value === undefined ? {} : { SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: value }
    );
    assert.equal(result.ok, false, String(value));
    if (!result.ok) assert.equal(result.code, "no_enabled_targets");
    assert.equal(created.length, 0);
  }
});

test("exact true admits webhook planning and still excludes both Sheets adapter keys", async () => {
  const webhook = webhookTarget();
  webhook.isRequired = false;
  webhook.configMetadataJson = { endpointUrl: "https://example.test/hooks/leads" };
  const { created, db } = plannerDb([
    ghlTarget,
    webhook,
    sheetsTarget("google_sheets.v1", "sheets-target"),
    sheetsTarget("google_sheets.company.v1", "company-sheets-target"),
  ]);
  const result = await planDeliveryInstructionsForAllocation(
    { leadAllocationId: "alloc_1", clientAccountId: "client_a" },
    db,
    { SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED: " true " }
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    created.map((row) => row.deliveryTargetId),
    ["ghl-target", "webhook-target"]
  );
  assert.equal(created[0]?.isRequired, true);
  assert.equal(created[1]?.isRequired, false);
});
