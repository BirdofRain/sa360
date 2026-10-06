import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import {
  BUYER_CSV_V2_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V4_FIELD_SCHEMA_VERSION,
  previewBuyerCsvExport,
} from "./buyer-csv-export.service.js";
import {
  previewPplInventorySelection,
  queryEligibleInventoryCandidatesBounded,
} from "./inventory-selection.service.js";

type FakeItem = {
  id: string;
  generatedAt: Date;
  status: string;
  inventoryClass: string;
  nicheKey: string;
  normalizedState: string;
  commerceExcludedAt: null;
  originClientAccountId: null;
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
  nicheKey: string;
  phone: string;
  evaluatedAt: Date;
}): FakeItem {
  return {
    id: input.id,
    generatedAt: daysAgo(45, input.evaluatedAt),
    status: "available",
    inventoryClass: "aged",
    nicheKey: input.nicheKey,
    normalizedState: "NC",
    commerceExcludedAt: null,
    originClientAccountId: null,
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
        lead_details: { consumer_age: 55 },
      },
      enrichmentMetadataJson: {},
    },
  };
}

function matchesNiche(where: Record<string, unknown>, nicheKey: string): boolean {
  const or = where.OR as Array<{ nicheKey?: { equals?: string } }> | undefined;
  if (Array.isArray(or) && or.some((clause) => clause.nicheKey?.equals)) {
    return or.some((clause) => clause.nicheKey?.equals?.toLowerCase() === nicheKey.toLowerCase());
  }
  const direct = where.nicheKey as { equals?: string } | undefined;
  if (direct?.equals) return direct.equals.toLowerCase() === nicheKey.toLowerCase();
  return true;
}

function buildFakeDb(allItems: FakeItem[], priorPhones: string[] = []) {
  const db = {
    buyerDeliveredIdentity: {
      findMany: async () =>
        priorPhones.map((phone) => ({
          phoneFingerprint: phone,
          emailFingerprint: null,
        })),
    },
    leadInventoryItem: {
      findMany: async (args: { where: Record<string, unknown>; take: number }) => {
        const rows = [...allItems]
          .filter((item) => matchesNiche(args.where, item.nicheKey))
          .sort((a, b) => a.id.localeCompare(b.id));
        return rows.slice(0, args.take);
      },
    },
  };
  return db as unknown as PrismaClient;
}

test("canonical commerce orders select legacy alias inventory and keep other exclusions", async () => {
  const evaluatedAt = new Date("2026-08-12T00:00:00.000Z");
  const priorPhone = "+15550000002";
  const duplicatePhone = "+15550000001";
  const items = [
    makeItem({ id: "vet-fex", nicheKey: "vet_fex", phone: duplicatePhone, evaluatedAt }),
    makeItem({ id: "vet-fex-dup", nicheKey: "VET", phone: duplicatePhone, evaluatedAt }),
    makeItem({ id: "vet-prior", nicheKey: "vet", phone: priorPhone, evaluatedAt }),
    makeItem({ id: "n-vet", nicheKey: "n_vet", phone: "+15550000008", evaluatedAt }),
    makeItem({ id: "nurse-life", nicheKey: "nurse_life", phone: "+15550000003", evaluatedAt }),
    makeItem({ id: "trucker-life", nicheKey: "trucker_life", phone: "+15550000004", evaluatedAt }),
    makeItem({ id: "unspecified", nicheKey: "unspecified", phone: "+15550000005", evaluatedAt }),
    makeItem({ id: "mortgage", nicheKey: "mortgage_protection", phone: "+15550000006", evaluatedAt }),
    makeItem({
      id: "probe",
      nicheKey: "vet_concurrency_probe",
      phone: "+15550000007",
      evaluatedAt,
    }),
  ];
  const priorFingerprint = fingerprintIdentityValue("phone", priorPhone);
  const db = buildFakeDb(items, [priorFingerprint]);

  const vet = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "vet",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 10,
    },
    db
  );
  assert.deepEqual(
    vet.candidates.map((candidate) => candidate.item.id).sort(),
    ["n-vet", "vet-fex"]
  );
  assert.equal(vet.exclusionCounts.sameBuyerPriorDelivery, 1);
  assert.equal(vet.exclusionCounts.currentBatchDuplicate, 1);
  assert.equal(
    vet.candidates.some((candidate) => candidate.item.nicheKey === "nurse_life"),
    false
  );

  const nurse = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "nurse",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 10,
    },
    db
  );
  assert.deepEqual(
    nurse.candidates.map((candidate) => candidate.item.id),
    ["nurse-life"]
  );

  const trucker = await queryEligibleInventoryCandidatesBounded(
    {
      nicheKey: "trucker",
      states: ["NC"],
      commerceAgeBucketKeys: ["COMMERCE_1_3_MO"],
      clientAccountId: "client_a",
      exclusions: [],
      evaluatedAt,
      targetEligible: 10,
    },
    db
  );
  assert.deepEqual(
    trucker.candidates.map((candidate) => candidate.item.id),
    ["trucker-life"]
  );
});

test("interest-only orders cannot be selected or exported as aged PPL", async () => {
  const previousSelection = process.env.SA360_PPL_SELECTION_ENABLED;
  const previousExport = process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
  try {
    const interestOrder = {
      id: "ord_interest",
      clientAccountId: "client_a",
      clientDisplayName: "Valley Vet",
      orderNumber: "LO-2001",
      requestedQuantity: 10,
      nicheKey: "vet",
      statesJson: ["NC"],
      campaignType: "availability_interest:fresh_leads",
      notes: null,
      status: "active",
    };
    let inventoryScanned = false;
    const selectionDb = {
      leadOrder: {
        findUnique: async () => interestOrder,
      },
      leadInventoryItem: {
        findMany: async () => {
          inventoryScanned = true;
          return [];
        },
      },
    };
    const preview = await previewPplInventorySelection(
      { orderId: "ord_interest", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 5 },
      selectionDb as unknown as PrismaClient
    );
    assert.equal(preview.ok, false);
    if (!preview.ok) assert.equal(preview.code, "availability_interest_only");
    assert.equal(inventoryScanned, false);

    const exportDb = {
      leadOrder: { findUnique: async () => interestOrder },
      leadAllocation: { findMany: async () => [] },
    };
    const csv = await previewBuyerCsvExport(
      { orderId: "ord_interest" },
      exportDb as unknown as PrismaClient
    );
    assert.equal(csv.ok, false);
    if (!csv.ok) assert.equal(csv.code, "availability_interest_only");
  } finally {
    if (previousSelection === undefined) delete process.env.SA360_PPL_SELECTION_ENABLED;
    else process.env.SA360_PPL_SELECTION_ENABLED = previousSelection;
    if (previousExport === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
    else process.env.SA360_PPL_CSV_EXPORT_ENABLED = previousExport;
  }
});

test("canonical vet export accepts vet_fex inventory as one niche", async () => {
  const previousExport = process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
  try {
    const db = {
      leadOrder: {
        findUnique: async () => ({
          id: "ord_vet",
          clientAccountId: "client_a",
          clientDisplayName: "Valley Vet",
          orderNumber: "LO-1044",
          requestedQuantity: 1,
          nicheKey: "vet",
          statesJson: ["NC"],
          campaignType: "Aged leads",
          notes: null,
        }),
      },
      leadAllocation: {
        findMany: async () => [
          {
            id: "alloc_1",
            status: "committed",
            sourceLeadEventId: "evt_1",
            leadInventoryItemId: "item_1",
            sourceLeadEvent: {
              normalizedPayloadJson: {
                contact: {
                  first_name: "Ada",
                  last_name: "Lovelace",
                  phone_e164: "+15551234567",
                  email: "ada@example.com",
                  state: "NC",
                },
                lead_details: { consumer_age: "62" },
              },
            },
            leadInventoryItem: {
              id: "item_1",
              generatedAt: new Date("2024-06-15T00:00:00.000Z"),
              nicheKey: "vet_fex",
              status: "reserved",
            },
          },
        ],
      },
    };
    const csv = await previewBuyerCsvExport({ orderId: "ord_vet" }, db as unknown as PrismaClient);
    assert.equal(csv.ok, true);
    if (csv.ok && "niche" in csv) {
      assert.equal(csv.niche, "vet");
      assert.equal(csv.fieldSchemaVersion, BUYER_CSV_V4_FIELD_SCHEMA_VERSION);
      assert.ok(csv.columns.includes("Branch of Service"));
    }

    const legacyDb = {
      leadOrder: {
        findUnique: async () => ({
          id: "ord_legacy",
          clientAccountId: "client_a",
          clientDisplayName: "Valley Vet",
          orderNumber: "LO-1001",
          requestedQuantity: 1,
          nicheKey: "vet_fex",
          statesJson: ["NC"],
          campaignType: "Aged leads",
          notes: null,
        }),
      },
      leadAllocation: {
        findMany: async () => [
          {
            id: "alloc_legacy",
            status: "committed",
            sourceLeadEventId: "evt_legacy",
            leadInventoryItemId: "item_legacy",
            sourceLeadEvent: {
              normalizedPayloadJson: {
                contact: {
                  first_name: "Ada",
                  last_name: "Lovelace",
                  phone_e164: "+15551234567",
                  email: "ada@example.com",
                  state: "NC",
                },
                lead_details: { consumer_age: "62" },
              },
            },
            leadInventoryItem: {
              id: "item_legacy",
              generatedAt: new Date("2024-06-15T00:00:00.000Z"),
              nicheKey: "vet_fex",
              status: "reserved",
            },
          },
        ],
      },
    };
    const legacy = await previewBuyerCsvExport(
      { orderId: "ord_legacy" },
      legacyDb as unknown as PrismaClient
    );
    assert.equal(legacy.ok, true);
    if (legacy.ok && "niche" in legacy) {
      assert.equal(legacy.niche, "vet_fex");
      assert.equal(legacy.fieldSchemaVersion, BUYER_CSV_V2_FIELD_SCHEMA_VERSION);
      assert.equal(legacy.columns.includes("branch_of_service"), false);
      assert.equal(legacy.columns.includes("Branch of Service"), false);
    }
  } finally {
    if (previousExport === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
    else process.env.SA360_PPL_CSV_EXPORT_ENABLED = previousExport;
  }
});
