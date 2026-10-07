/**
 * Named regression fixtures for the aged-Veteran orders that exposed the
 * consumer-age and buyer-enrichment gaps (LO-1055, LO-1057).
 *
 * Every fixture is PII-free synthetic data. No production identifier, name,
 * phone, email, allocation id, or export package id appears here, and nothing
 * in this file reads or writes a delivered package.
 *
 * A. A Veteran lead whose age exists only outside the canonical destination.
 * B. Age 87 is never reservable and classifies as "Dead — Age over 86".
 * C. A missing age blocks reservation and export but is never permanently dead.
 * D. A missing beneficiary exports as "Other" without mutating the payload.
 * E. `primary_reason` exports under Primary Reason, never Primary Concern.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  BUYER_EXPORT_AGE_REQUIRED,
  commitBuyerCsvExport,
  previewBuyerCsvExport,
} from "../ppl-fulfillment/buyer-csv-export.service.js";
import { evaluatePplBuyerReadyEligibility } from "../ppl-fulfillment/ppl-buyer-ready-eligibility.js";
import { previewPplInventorySelection } from "../ppl-fulfillment/inventory-selection.service.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "../source-intake/leadcapture-io-normalizer.js";
import {
  CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
  commitConsumerAgeOverMaximumClassification,
} from "./consumer-age-inventory-maintenance.service.js";
import {
  CONSUMER_AGE_OVER_MAXIMUM_CATEGORY,
  CONSUMER_AGE_REQUIRED_CATEGORY,
  consumerAgePolicyCategory,
  resolveConsumerAgeForFulfillment,
} from "./consumer-age-policy.js";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:5432/sa360_test";
const EVALUATED_AT = new Date("2026-06-15T00:00:00.000Z");

/* ------------------------------------------------------------------ */
/* Selection fixtures                                                  */
/* ------------------------------------------------------------------ */

type SelectionSpec = {
  id: string;
  canonicalAge?: string | number;
  rawAge?: string;
  enrichmentAge?: string;
  ageDays?: number;
};

function selectionItem(spec: SelectionSpec) {
  const payload: Record<string, unknown> = {
    contact: {
      first_name: "Ada",
      last_name: "Stone",
      phone_e164: `+1555060${spec.id.length}${spec.id.charCodeAt(0)}`,
      email: `${spec.id}@example.test`,
      state: "GA",
    },
  };
  if (spec.canonicalAge != null) payload.lead_details = { consumer_age: spec.canonicalAge };
  return {
    id: spec.id,
    generatedAt: new Date(Date.now() - (spec.ageDays ?? 45) * 86400000),
    status: "available",
    inventoryClass: "aged",
    nicheKey: "vet",
    normalizedState: "GA",
    originClientAccountId: null,
    inventoryLot: { supplierAccountId: "supplier_ok", status: "active" },
    sourceLeadEvent: {
      id: `evt-${spec.id}`,
      normalizedPayloadJson: payload,
      rawPayloadJson: spec.rawAge ? { master: { dob_age_raw: spec.rawAge } } : {},
      enrichmentMetadataJson: spec.enrichmentAge
        ? { sourceAttributes: { consumer_age: spec.enrichmentAge } }
        : {},
    },
  };
}

type SelectionItem = ReturnType<typeof selectionItem>;

function selectionDb(items: SelectionItem[], requestedQuantity: number) {
  const sorted = [...items].sort(
    (a, b) => a.generatedAt.getTime() - b.generatedAt.getTime() || a.id.localeCompare(b.id)
  );
  const db = {
    buyerDeliveredIdentity: { findMany: async () => [] },
    protectedAgentExclusion: { findMany: async () => [] },
    leadOrderLine: { findMany: async () => [] },
    leadOrder: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        status: "active",
        canceledAt: null,
        completedAt: null,
        pausedAt: null,
        orderKind: "pay_per_lead",
        nicheKey: "vet",
        statesJson: ["GA"],
        clientAccountId: "client_regression",
        requestedQuantity,
        leadVolume: requestedQuantity,
      }),
    },
    leadAllocation: { findMany: async () => [], findFirst: async () => null },
    leadInventoryItem: {
      findMany: async (args: { take: number }) => sorted.slice(0, args.take),
    },
    $transaction: async () => {
      throw new Error("transaction_should_not_run_in_preview");
    },
  };
  return db as unknown as PrismaClient;
}

/* ------------------------------------------------------------------ */
/* Export fixtures                                                     */
/* ------------------------------------------------------------------ */

type ExportSpec = {
  id: string;
  canonicalAge?: string | number;
  rawAge?: string;
  beneficiary?: string;
  primaryConcern?: string;
  primaryReason?: string;
};

function exportAllocation(spec: ExportSpec) {
  const leadDetails: Record<string, unknown> = {
    ...(spec.canonicalAge == null ? {} : { consumer_age: spec.canonicalAge }),
    ...(spec.beneficiary ? { beneficiary: spec.beneficiary } : {}),
    niche: {
      branch_of_service: "Army",
      ...(spec.primaryConcern ? { primary_concern: spec.primaryConcern } : {}),
      ...(spec.primaryReason ? { primary_reason: spec.primaryReason } : {}),
    },
  };
  return {
    id: spec.id,
    status: "reserved" as const,
    sourceLeadEventId: `evt_${spec.id}`,
    leadInventoryItemId: `item_${spec.id}`,
    sourceLeadEvent: {
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Stone",
          phone_e164: "+15550601234",
          email: `${spec.id}@example.test`,
          state: "Georgia",
        },
        lead_details: leadDetails,
      },
      rawPayloadJson: spec.rawAge ? { master: { dob_age_raw: spec.rawAge } } : {},
      enrichmentMetadataJson: {},
    },
    leadInventoryItem: {
      id: `item_${spec.id}`,
      generatedAt: new Date("2026-03-15T00:00:00.000Z"),
      nicheKey: "vet",
      status: "reserved",
      normalizedState: "GA",
      metadataJson: {},
    },
    proposedAt: new Date("2026-04-01T00:00:00.000Z"),
  };
}

type ExportAllocation = ReturnType<typeof exportAllocation>;

function exportDb(allocations: ExportAllocation[]) {
  const created: Array<Record<string, unknown>> = [];
  const db: Record<string, unknown> = {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_regression",
        clientAccountId: "client_regression",
        clientDisplayName: "Regression Vet Buyer",
        orderNumber: "9001",
        requestedQuantity: allocations.length,
        nicheKey: "vet",
        statesJson: ["GA"],
      }),
    },
    leadAllocation: { findMany: async () => allocations },
    leadOrderLine: { findFirst: async () => null },
    leadDeliveryExportPackage: {
      findUnique: async () => null,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { id: "pkg_regression", ...args.data };
      },
    },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db: db as unknown as PrismaClient, created };
}

/** Commit against a fake database and return the immutable CSV bytes. */
async function exportedCsv(
  allocations: ExportAllocation[],
  idempotencyKey: string
): Promise<string> {
  const { db, created } = exportDb(allocations);
  const commit = await commitBuyerCsvExport({ orderId: "ord_regression", idempotencyKey }, db);
  assert.equal(commit.ok, true, `commit failed: ${commit.ok ? "" : commit.code}`);
  return created[0]!.csvContent as string;
}

function headerOf(csv: string): string[] {
  return csv.split("\n")[0]!.split(",");
}

function cell(csv: string, column: string, rowIndex = 1): string {
  const cells = csv.split("\n")[rowIndex]!.split(",");
  return cells[headerOf(csv).indexOf(column)] ?? "";
}

/* ------------------------------------------------------------------ */
/* Dead-classification fixture                                         */
/* ------------------------------------------------------------------ */

function maintenanceDb(
  rows: Array<{ id: string; canonicalAge?: string; rawAge?: string }>
) {
  const built = rows.map((row, index) => ({
    id: row.id,
    generatedAt: new Date(Date.UTC(2026, 3, index + 1)),
    status: "available",
    nicheKey: "vet",
    sourceProvider: "manual_import",
    sourceLane: "aged_inventory_csv",
    commerceExcludedAt: null as Date | null,
    metadataJson: {},
    inventoryLot: { lotKey: "lot-regression" },
    sourceLeadEvent: {
      id: `evt-${row.id}`,
      sourceSystem: "csv_import",
      normalizedPayloadJson: row.canonicalAge
        ? { lead_details: { consumer_age: row.canonicalAge } }
        : {},
      rawPayloadJson: row.rawAge ? { consumer_age: row.rawAge } : {},
      enrichmentMetadataJson: {},
    },
    _count: { leadAllocations: 0 },
  }));
  const writes: Array<{ id: string; data: Record<string, unknown> }> = [];
  const db: Record<string, unknown> = {
    leadInventoryItem: {
      count: async (args: { where?: Record<string, unknown> }) =>
        args.where?.commerceExcludedReason != null ? 0 : built.length,
      findMany: async (args: { take?: number }) => built.slice(0, args.take ?? built.length),
      updateMany: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        writes.push({ id: args.where.id, data: args.data });
        return { count: 1 };
      },
    },
    leadAllocation: { count: async () => 0 },
    $queryRaw: async (_strings: unknown, itemId: string) => {
      const row = built.find((candidate) => candidate.id === itemId);
      if (!row) return [];
      return [
        {
          id: row.id,
          status: row.status,
          commerceExcludedAt: row.commerceExcludedAt,
          metadataJson: row.metadataJson,
          normalizedPayloadJson: row.sourceLeadEvent.normalizedPayloadJson,
          rawPayloadJson: row.sourceLeadEvent.rawPayloadJson,
          enrichmentMetadataJson: row.sourceLeadEvent.enrichmentMetadataJson,
        },
      ];
    },
  };
  db.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(db);
  return { db: db as unknown as PrismaClient, writes };
}

function deadGuard() {
  return {
    expectedDbHost: "127.0.0.1:5432",
    databaseUrl: LOCAL_DB_URL,
    operator: "regression_test",
    confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
    limit: 50,
  };
}

/* ------------------------------------------------------------------ */

let previousSelectionFlag: string | undefined;
let previousExportFlag: string | undefined;

before(() => {
  previousSelectionFlag = process.env.SA360_PPL_SELECTION_ENABLED;
  previousExportFlag = process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  process.env.SA360_PPL_SELECTION_ENABLED = "true";
  process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
});

after(() => {
  if (previousSelectionFlag === undefined) delete process.env.SA360_PPL_SELECTION_ENABLED;
  else process.env.SA360_PPL_SELECTION_ENABLED = previousSelectionFlag;
  if (previousExportFlag === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  else process.env.SA360_PPL_CSV_EXPORT_ENABLED = previousExportFlag;
});

describe("A: Veteran lead whose age exists only outside the canonical destination", () => {
  it("new LeadCapture intake writes the canonical age so the gap cannot recur", () => {
    const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload({
      first_name: "Ada",
      last_name: "Stone",
      phone: "+15550601234",
      email: "a@example.test",
      state: "Georgia",
      niche: "veteran",
      age: "85",
    } as never) as unknown as Record<string, unknown>;
    const leadDetails = normalized.lead_details as Record<string, unknown>;
    assert.equal(leadDetails.consumer_age, "85");
  });

  it("an already-imported row with a raw-only age resolves, reserves, and exports", async () => {
    const sources = {
      normalizedPayloadJson: { contact: { first_name: "Ada", last_name: "Stone" } },
      rawPayloadJson: { master: { dob_age_raw: "84" } },
      evaluatedAt: EVALUATED_AT,
    };
    const resolved = resolveConsumerAgeForFulfillment(sources);
    assert.equal(resolved.age, 84);
    assert.equal(resolved.source, "raw_consumer_age");
    assert.equal(resolved.status, "eligible");
    assert.equal(consumerAgePolicyCategory(resolved), null);

    const eligibility = evaluatePplBuyerReadyEligibility(sources.normalizedPayloadJson, {
      rawPayloadJson: sources.rawPayloadJson,
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(eligibility.ok, true);

    const preview = await previewPplInventorySelection(
      { orderId: "ord_a", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
      selectionDb([selectionItem({ id: "a-raw-84", rawAge: "84" })], 1)
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.deepEqual(preview.selectedItemIds, ["a-raw-84"]);
    assert.equal(preview.exclusionCounts?.consumerAgeMissing, 0);

    const csv = await exportedCsv([exportAllocation({ id: "a", rawAge: "84" })], "regression-a");
    assert.equal(cell(csv, "Age"), "84");
    // Normalized state wins over the raw "Georgia" the source submitted.
    assert.equal(cell(csv, "State"), "GA");
    assert.equal(csv.includes("Georgia"), false);
  });
});

describe("B: age 87 is never reservable and classifies as dead", () => {
  it("resolves as over the maximum sellable age", () => {
    const resolved = resolveConsumerAgeForFulfillment({
      normalizedPayloadJson: { lead_details: { consumer_age: "87" } },
      evaluatedAt: EVALUATED_AT,
    });
    assert.equal(resolved.age, 87);
    assert.equal(resolved.status, "over_maximum_age");
    assert.equal(consumerAgePolicyCategory(resolved), CONSUMER_AGE_OVER_MAXIMUM_CATEGORY);
    assert.equal(CONSUMER_AGE_OVER_MAXIMUM_CATEGORY, "Dead — Age over 86");
  });

  it("is excluded from selection while an 86-year-old is still selected", async () => {
    const preview = await previewPplInventorySelection(
      { orderId: "ord_b", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 2 },
      selectionDb(
        [
          selectionItem({ id: "b-87", canonicalAge: "87", ageDays: 40 }),
          selectionItem({ id: "b-86", canonicalAge: "86", ageDays: 41 }),
        ],
        2
      )
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.deepEqual(preview.selectedItemIds, ["b-86"]);
    assert.equal(preview.exclusionCounts?.consumerAgeOverMaximum, 1);
  });

  it("blocks the buyer export and persists no package", async () => {
    const { db, created } = exportDb([exportAllocation({ id: "b", canonicalAge: "87" })]);
    const result = await commitBuyerCsvExport(
      { orderId: "ord_regression", idempotencyKey: "regression-b" },
      db
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, BUYER_EXPORT_AGE_REQUIRED);
    assert.deepEqual(created, [], "no immutable package may be written");
  });

  it("classifies unallocated inventory as expired with the consumer-age kill switch", async () => {
    const { db, writes } = maintenanceDb([
      { id: "b-87", canonicalAge: "87" },
      { id: "b-86", canonicalAge: "86" },
    ]);
    const result = await commitConsumerAgeOverMaximumClassification(
      { ...deadGuard(), scope: { evaluatedAt: EVALUATED_AT } },
      db
    );
    assert.equal(result.outcome, "CLASSIFIED");
    assert.deepEqual(result.classifiedIds, ["b-87"]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0]?.id, "b-87");
    assert.equal(writes[0]?.data.status, "expired");
    assert.equal(writes[0]?.data.commerceExcludedReason, "consumer_age_over_86");
    assert.equal(writes[0]?.data.commerceExcludedBy, "consumer_age_policy_v1");
  });
});

describe("C: a missing age blocks fulfillment but is never permanently dead", () => {
  const noAge = {
    normalizedPayloadJson: { contact: { first_name: "Ada", last_name: "Stone" } },
    rawPayloadJson: {},
    evaluatedAt: EVALUATED_AT,
  };

  it("resolves as missing and reads as age-required, not dead", () => {
    const resolved = resolveConsumerAgeForFulfillment(noAge);
    assert.equal(resolved.age, null);
    assert.equal(resolved.status, "missing");
    assert.equal(consumerAgePolicyCategory(resolved), CONSUMER_AGE_REQUIRED_CATEGORY);
    assert.equal(CONSUMER_AGE_REQUIRED_CATEGORY, "Ineligible — Age required");
    assert.notEqual(CONSUMER_AGE_REQUIRED_CATEGORY, CONSUMER_AGE_OVER_MAXIMUM_CATEGORY);
  });

  it("cannot be reserved", async () => {
    const preview = await previewPplInventorySelection(
      { orderId: "ord_c", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
      selectionDb([selectionItem({ id: "c-no-age" })], 1)
    );
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, "no_inventory");
  });

  it("cannot be exported", async () => {
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_regression" },
      exportDb([exportAllocation({ id: "c" })]).db
    );
    assert.equal(preview.ok, false);
    if (preview.ok) return;
    assert.equal(preview.code, BUYER_EXPORT_AGE_REQUIRED);
    assert.deepEqual(preview.details, {
      rowCount: 1,
      ageMissing: 1,
      ageInvalid: 0,
      ageOverMaximum: 0,
    });
  });

  it("is not commerce-excluded by the dead-lead policy", async () => {
    const { db, writes } = maintenanceDb([{ id: "c-no-age" }]);
    const result = await commitConsumerAgeOverMaximumClassification(
      { ...deadGuard(), scope: { evaluatedAt: EVALUATED_AT } },
      db
    );
    assert.equal(result.outcome, "NOOP");
    assert.deepEqual(result.classifiedIds, []);
    assert.deepEqual(writes, []);
    assert.equal(result.totals?.noAgeSource, 1);
  });

  it("becomes reservable once enrichment supplies an age", async () => {
    const enriched = resolveConsumerAgeForFulfillment({
      ...noAge,
      enrichmentMetadataJson: { sourceAttributes: { consumer_age: "72" } },
    });
    assert.equal(enriched.age, 72);
    assert.equal(enriched.source, "enrichment");
    assert.equal(enriched.status, "eligible");

    const preview = await previewPplInventorySelection(
      { orderId: "ord_c2", commerceAgeBucketKeys: ["COMMERCE_1_3_MO"], requestedQuantity: 1 },
      selectionDb([selectionItem({ id: "c-enriched", enrichmentAge: "72" })], 1)
    );
    assert.equal(preview.ok, true);
    if (!preview.ok) return;
    assert.deepEqual(preview.selectedItemIds, ["c-enriched"]);
  });
});

describe("D: a missing beneficiary exports as Other without mutating the payload", () => {
  it("presents Other for a blank beneficiary and keeps a real value intact", async () => {
    const allocations = [
      exportAllocation({ id: "d-blank", canonicalAge: "62" }),
      exportAllocation({ id: "d-spouse", canonicalAge: "63", beneficiary: "Spouse" }),
    ];
    const payloadBefore = JSON.stringify(allocations[0]!.sourceLeadEvent.normalizedPayloadJson);
    const csv = await exportedCsv(allocations, "regression-d");
    assert.equal(cell(csv, "Beneficiary", 1), "Other");
    assert.equal(cell(csv, "Beneficiary", 2), "Spouse");

    assert.equal(
      JSON.stringify(allocations[0]!.sourceLeadEvent.normalizedPayloadJson),
      payloadBefore,
      "presentation must not write Other into normalizedPayloadJson"
    );
    const leadDetails = allocations[0]!.sourceLeadEvent.normalizedPayloadJson.lead_details as
      Record<string, unknown>;
    assert.equal("beneficiary" in leadDetails, false);
    assert.equal(
      JSON.stringify(allocations[0]!.sourceLeadEvent.normalizedPayloadJson).includes("Other"),
      false
    );
  });
});

describe("E: primary_reason exports under Primary Reason, never Primary Concern", () => {
  it("keeps final_expense out of the Primary Concern column", async () => {
    const csv = await exportedCsv(
      [exportAllocation({ id: "e", canonicalAge: "62", primaryReason: "final_expense" })],
      "regression-e"
    );
    assert.equal(headerOf(csv).includes("Primary Reason"), true);
    assert.equal(cell(csv, "Primary Reason"), "final_expense");
    assert.equal(cell(csv, "Primary Concern"), "");
  });

  it("keeps the two columns independent when both answers exist", async () => {
    const csv = await exportedCsv(
      [
        exportAllocation({
          id: "e2",
          canonicalAge: "62",
          primaryConcern: "burial_costs",
          primaryReason: "final_expense",
        }),
      ],
      "regression-e2"
    );
    assert.equal(cell(csv, "Primary Concern"), "burial_costs");
    assert.equal(cell(csv, "Primary Reason"), "final_expense");
  });
});
