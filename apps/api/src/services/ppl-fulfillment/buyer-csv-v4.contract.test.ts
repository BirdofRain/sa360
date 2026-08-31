import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  BUYER_CSV_V2_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V4_FIELD_SCHEMA_VERSION,
  activeBuyerCsvFieldSchemaVersionForNiche,
  commitBuyerCsvExport,
  extractBuyerCsvV3Fields,
  getBuyerCsvExportDownload,
  previewBuyerCsvExport,
  serializeBuyerCsvV3,
} from "./buyer-csv-export.service.js";
import { presentBuyerCsvCustomerPackage } from "./buyer-csv-customer-presentation.js";
import { buyerCsvV3ColumnsForNiche } from "./buyer-lead-fields.js";
import { getClientReleasedDeliveryDownload } from "../lead-order/lead-order-released-deliveries.service.js";

const originalFlag = process.env.SA360_PPL_CSV_EXPORT_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  else process.env.SA360_PPL_CSV_EXPORT_ENABLED = originalFlag;
});

function payload(input: {
  first: string;
  zip?: string;
  coverage?: string;
}) {
  return {
    contact: {
      first_name: input.first,
      last_name: "Lovelace",
      phone_e164: "+15551234567",
      email: `${input.first.toLowerCase()}@example.com`,
      state: "NC",
      ...(input.zip ? { zip: input.zip } : {}),
    },
    lead_details: {
      consumer_age: 62,
      beneficiary: "Spouse",
      ...(input.coverage ? { coverage_amount: input.coverage } : {}),
      niche: {
        branch_of_service: "Army",
        disability_rating: "40%",
        primary_concern: "Income protection",
      },
    },
  };
}

function allocation(input: {
  id: string;
  generatedAt: string;
  first: string;
  zip?: string;
  coverage?: string;
  proposedAt?: string;
}) {
  return {
    id: input.id,
    status: "reserved" as const,
    sourceLeadEventId: `evt_${input.id}`,
    leadInventoryItemId: `item_${input.id}`,
    sourceLeadEvent: { normalizedPayloadJson: payload(input) },
    leadInventoryItem: {
      id: `item_${input.id}`,
      generatedAt: new Date(input.generatedAt),
      nicheKey: "vet",
      status: "reserved",
    },
    proposedAt: input.proposedAt ? new Date(input.proposedAt) : new Date("2026-01-01T00:00:00.000Z"),
  };
}

function previewDb(allocations: ReturnType<typeof allocation>[], nicheKey = "vet") {
  return {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_1",
        clientAccountId: "acct_a",
        clientDisplayName: "Valley Vet",
        orderNumber: "1001",
        requestedQuantity: allocations.length,
        nicheKey,
        statesJson: ["NC"],
      }),
    },
    leadAllocation: {
      findMany: async () => allocations,
    },
  };
}

describe("buyer_csv_v4 customer presentation contract", () => {
  it("activates v4 for vet/trucker new exports and leaves other niches on v2", () => {
    assert.equal(BUYER_CSV_V4_FIELD_SCHEMA_VERSION, "buyer_csv_v4");
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("vet"), BUYER_CSV_V4_FIELD_SCHEMA_VERSION);
    assert.equal(
      activeBuyerCsvFieldSchemaVersionForNiche("trucker"),
      BUYER_CSV_V4_FIELD_SCHEMA_VERSION
    );
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("nurse"), BUYER_CSV_V2_FIELD_SCHEMA_VERSION);
    assert.notEqual(
      activeBuyerCsvFieldSchemaVersionForNiche("vet"),
      BUYER_CSV_V3_FIELD_SCHEMA_VERSION
    );
  });

  it("sorts newest generatedAt first and ignores proposedAt order", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const allocations = [
      allocation({
        id: "alloc_old",
        first: "Oldest",
        generatedAt: "2023-01-01T00:00:00.000Z",
        proposedAt: "2026-08-01T12:00:00.000Z",
        zip: "27513",
      }),
      allocation({
        id: "alloc_mid",
        first: "Middle",
        generatedAt: "2024-06-15T00:00:00.000Z",
        proposedAt: "2026-08-02T12:00:00.000Z",
        zip: "27513",
      }),
      allocation({
        id: "alloc_new",
        first: "Newest",
        generatedAt: "2025-12-31T23:59:59.000Z",
        proposedAt: "2026-07-01T12:00:00.000Z",
        zip: "27513",
      }),
    ];
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      previewDb(allocations) as never
    );
    assert.equal(preview.ok, true);
    if (!preview.ok || !("allocationIds" in preview)) return;
    assert.deepEqual(preview.allocationIds, ["alloc_new", "alloc_mid", "alloc_old"]);
    assert.equal(preview.rowCount, 3);

    const created: Array<{ csvContent: string; fieldSchemaVersion: string; rowCount: number }> = [];
    const commitDb = {
      ...previewDb(allocations),
      leadDeliveryExportPackage: {
        findUnique: async () => null,
        create: async (args: { data: (typeof created)[number] }) => {
          created.push(args.data);
          return { id: "pkg_new", ...args.data };
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(commitDb),
    };
    const priced = {
      commerceAgeBucketKey: "COMMERCE_3_6_MO",
      pricingVersion: "ppl_aged_beta_2026_08_v1",
      unitPriceCents: 400,
      requestedQuantity: 3,
    };
    const commit = await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-sort" },
      {
        ...commitDb,
        leadOrderLine: { findFirst: async () => ({ metadataJson: priced }) },
      } as never
    );
    assert.equal(commit.ok, true);
    if (!commit.ok) return;
    const csv = created[0]!.csvContent;
    const dataRows = csv.trimEnd().split("\n").slice(1);
    assert.equal(dataRows[0]!.split(",")[0], "2025-12-31");
    assert.equal(dataRows[0]!.split(",")[2], "Newest");
    assert.equal(dataRows[1]!.split(",")[2], "Middle");
    assert.equal(dataRows[2]!.split(",")[2], "Oldest");
    assert.equal(dataRows[0]!.split(",")[1], "Veteran");
    assert.equal(created[0]!.fieldSchemaVersion, BUYER_CSV_V4_FIELD_SCHEMA_VERSION);
    assert.equal(created[0]!.rowCount, 3);
  });

  it("keeps input allocation count equal to CSV row count for 50 allocations", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const allocations = Array.from({ length: 50 }, (_, index) =>
      allocation({
        id: `alloc_${String(index).padStart(2, "0")}`,
        first: `Lead${index + 1}`,
        generatedAt: new Date(Date.UTC(2024, 0, 1 + index)).toISOString(),
        zip: index === 3 ? "27513" : undefined,
      })
    );
    const preview = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      previewDb(allocations) as never
    );
    assert.equal(preview.ok, true);
    if (!preview.ok || !("columns" in preview)) return;
    assert.equal(preview.rowCount, 50);
    assert.equal(preview.allocationIds.length, 50);
    assert.equal(preview.columns[0], "Date Generated");
    assert.equal(preview.columns[1], "Lead Type");
    assert.equal(preview.columns.includes("ZIP"), true);
    assert.equal(preview.columns.includes("Coverage Amount"), false);
  });

  it("does not treat generated packages as released (K) and leaves customer download 404 (L)", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const allocations = [
      allocation({ id: "alloc_1", first: "Ada", generatedAt: "2024-06-15T00:00:00.000Z", zip: "27513" }),
    ];
    type StoredPackage = {
      id: string;
      leadOrderId: string;
      clientAccountId: string;
      csvContent: string;
      spreadsheetDeliveredAt: Date | null;
      fieldSchemaVersion: string;
      rowCount: number;
      contentSha256: string;
      allocationIdsJson: string[];
      leadOrder: {
        orderNumber: string;
        clientDisplayName: string;
        nicheKey: string;
        statesJson: string[];
      };
    };
    const box: { stored: StoredPackage | null } = { stored: null };

    const db = {
      ...previewDb(allocations),
      leadDeliveryExportPackage: {
        findUnique: async ({ where }: { where: { id?: string; idempotencyKey?: string } }) => {
          if (where.idempotencyKey) return box.stored;
          if (where.id && box.stored?.id === where.id) return box.stored;
          return null;
        },
        create: async (args: { data: Record<string, unknown> }) => {
          box.stored = {
            id: "pkg_generated",
            leadOrderId: "ord_1",
            clientAccountId: "acct_a",
            csvContent: String(args.data.csvContent),
            spreadsheetDeliveredAt: null,
            fieldSchemaVersion: String(args.data.fieldSchemaVersion),
            rowCount: Number(args.data.rowCount),
            contentSha256: String(args.data.contentSha256),
            allocationIdsJson: args.data.allocationIdsJson as string[],
            leadOrder: {
              orderNumber: "1001",
              clientDisplayName: "Valley Vet",
              nicheKey: "vet",
              statesJson: ["NC"],
            },
          };
          return box.stored;
        },
      },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
      leadOrderLine: { findFirst: async () => null },
    };

    const commit = await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "k-gen" },
      db as never
    );
    assert.equal(commit.ok, true);
    if (!commit.ok) return;
    assert.ok(box.stored);
    assert.equal(box.stored.spreadsheetDeliveredAt, null);
    assert.equal(commit.fieldSchemaVersion, BUYER_CSV_V4_FIELD_SCHEMA_VERSION);

    const adminDownload = await getBuyerCsvExportDownload("pkg_generated", db as never);
    assert.equal(adminDownload.ok, true);
    if (!adminDownload.ok) return;
    assert.equal(adminDownload.spreadsheetDelivered, false);
    assert.equal(adminDownload.csv, box.stored.csvContent);

    const customer = await getClientReleasedDeliveryDownload(
      { orderId: "ord_1", exportId: "pkg_generated", clientAccountId: "acct_a" },
      {
        findLeadOrderByIdImpl: async () =>
          ({ id: "ord_1", clientAccountId: "acct_a", orderNumber: "1001" }) as never,
        findReleasedLeadDeliveryExportPackageForClientImpl: async () => null,
      }
    );
    assert.equal(customer, null);
  });

  it("serves the same stored bytes after release and 404s cross-tenant (M)", async () => {
    const csv = presentBuyerCsvCustomerPackage(
      [
        extractBuyerCsvV3Fields({
          normalizedPayloadJson: payload({ first: "Ada", zip: "27513", coverage: "15000" }),
          generatedAt: new Date("2024-06-15T00:00:00.000Z"),
          nicheKey: "vet",
        }),
      ],
      "vet"
    ).csv;

    const released = {
      id: "pkg_released",
      leadOrderId: "ord_1",
      clientAccountId: "acct_a",
      rowCount: 1,
      csvContent: csv,
      spreadsheetDeliveredAt: new Date("2026-08-20T15:00:00.000Z"),
      createdAt: new Date("2026-08-19T12:00:00.000Z"),
      metadataJson: { niche: "vet", fieldSchemaVersion: BUYER_CSV_V4_FIELD_SCHEMA_VERSION },
      leadOrder: {
        orderNumber: "1001",
        clientDisplayName: "Valley Vet",
        nicheKey: "vet",
        statesJson: ["NC"],
      },
    };

    const owner = await getClientReleasedDeliveryDownload(
      { orderId: "ord_1", exportId: "pkg_released", clientAccountId: "acct_a" },
      {
        findLeadOrderByIdImpl: async () =>
          ({ id: "ord_1", clientAccountId: "acct_a", orderNumber: "1001" }) as never,
        findReleasedLeadDeliveryExportPackageForClientImpl: async () => released,
      }
    );
    assert.ok(owner);
    assert.equal(owner.csv, csv);
    assert.equal(owner.csv.split("\n")[0]!.split(",")[0], "Date Generated");
    assert.equal(owner.csv.split("\n")[1]!.split(",")[1], "Veteran");

    const foreign = await getClientReleasedDeliveryDownload(
      { orderId: "ord_1", exportId: "pkg_released", clientAccountId: "acct_b" },
      {
        findLeadOrderByIdImpl: async () =>
          ({ id: "ord_1", clientAccountId: "acct_a", orderNumber: "1001" }) as never,
        findReleasedLeadDeliveryExportPackageForClientImpl: async () => {
          throw new Error("must not load package for a foreign tenant");
        },
      }
    );
    assert.equal(foreign, null);
  });

  it("keeps historical released v2/v3 packages readable without rewriting bytes (N)", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const historicalV3Row = extractBuyerCsvV3Fields({
      normalizedPayloadJson: payload({ first: "Ada", zip: "27513" }),
      generatedAt: new Date("2024-06-15T00:00:00.000Z"),
      nicheKey: "vet",
    });
    const historicalCsv = serializeBuyerCsvV3([historicalV3Row], "vet");
    assert.equal(historicalCsv.split("\n")[0]!.split(",")[0], "first_name");
    assert.match(historicalCsv, /,vet,/);

    const existing = {
      id: "pkg_historical_v3",
      leadOrderId: "ord_1",
      clientAccountId: "acct_a",
      rowCount: 1,
      allocationIdsJson: ["alloc_1"],
      fieldSchemaVersion: BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
      contentSha256: "historical-sha-v3",
      csvContent: historicalCsv,
      spreadsheetDeliveredAt: new Date("2026-08-01T00:00:00.000Z"),
      metadataJson: {
        schema: "buyer_csv_export_metadata_v1",
        fieldSchemaVersion: BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
        niche: "vet",
        columns: buyerCsvV3ColumnsForNiche("vet"),
      },
      leadOrder: {
        orderNumber: "1001",
        clientDisplayName: "Valley Vet",
        nicheKey: "vet",
        statesJson: ["NC"],
      },
    };

    const replay = await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "historical-v3" },
      {
        leadDeliveryExportPackage: { findUnique: async () => existing },
        leadOrder: {
          findUnique: async () => ({
            orderNumber: "1001",
            clientDisplayName: "Valley Vet",
            nicheKey: "vet",
            statesJson: ["NC"],
          }),
        },
      } as never
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.idempotentReplay, true);
    assert.equal(replay.fieldSchemaVersion, BUYER_CSV_V3_FIELD_SCHEMA_VERSION);
    assert.equal(replay.contentSha256, "historical-sha-v3");

    const adminDownload = await getBuyerCsvExportDownload("pkg_historical_v3", {
      leadDeliveryExportPackage: {
        findUnique: async () => existing,
      },
    } as never);
    assert.equal(adminDownload.ok, true);
    if (!adminDownload.ok) return;
    assert.equal(adminDownload.csv, historicalCsv);
    assert.equal(adminDownload.fieldSchemaVersion, BUYER_CSV_V3_FIELD_SCHEMA_VERSION);

    const customer = await getClientReleasedDeliveryDownload(
      { orderId: "ord_1", exportId: "pkg_historical_v3", clientAccountId: "acct_a" },
      {
        findLeadOrderByIdImpl: async () =>
          ({ id: "ord_1", clientAccountId: "acct_a", orderNumber: "1001" }) as never,
        findReleasedLeadDeliveryExportPackageForClientImpl: async () => ({
          id: existing.id,
          leadOrderId: existing.leadOrderId,
          clientAccountId: existing.clientAccountId,
          rowCount: existing.rowCount,
          csvContent: existing.csvContent,
          spreadsheetDeliveredAt: existing.spreadsheetDeliveredAt,
          createdAt: existing.spreadsheetDeliveredAt,
          metadataJson: existing.metadataJson,
          leadOrder: existing.leadOrder,
        }),
      }
    );
    assert.ok(customer);
    assert.equal(customer.csv, historicalCsv);
    assert.equal(customer.csv.split("\n")[0], serializeBuyerCsvV3([historicalV3Row], "vet").split("\n")[0]);
  });
});
