/**
 * Integration correction (separate from frozen B/C):
 * buyer_csv_v3 is activated only for Vet and Trucker new exports.
 * Nurse / Mortgage / Solar / unknown niches remain on buyer_csv_v2
 * until they receive an explicit v3 contract.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  BUYER_CSV_V2_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
  activeBuyerCsvFieldSchemaVersionForNiche,
  extractBuyerCsvV2Fields,
  extractBuyerCsvV3Fields,
  isBuyerCsvV3ActiveNiche,
  previewBuyerCsvExport,
  serializeBuyerCsvV2,
  serializeBuyerCsvV3,
} from "./buyer-csv-export.service.js";
import {
  buyerCsvColumnsForNiche,
  buyerCsvV3ColumnsForNiche,
} from "./buyer-lead-fields.js";

const originalFlag = process.env.SA360_PPL_CSV_EXPORT_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  else process.env.SA360_PPL_CSV_EXPORT_ENABLED = originalFlag;
});

const payload = {
  contact: {
    first_name: "Ada",
    last_name: "Lovelace",
    phone_e164: "+15551234567",
    email: "ada@example.com",
    state: "NC",
    zip: "27513",
  },
  lead_details: {
    consumer_age: 62,
    beneficiary: "Spouse",
    niche: {
      healthcare_profession: "RN",
      primary_concern: "Income",
      homeowner: "Yes",
      house_type: "Single",
    },
  },
};

function fakePreviewDb(nicheKey: string) {
  return {
    leadOrder: {
      findUnique: async () => ({
        id: "ord_1",
        clientAccountId: "client_1",
        clientDisplayName: "Preview Client",
        orderNumber: "1001",
        requestedQuantity: 1,
        nicheKey,
        statesJson: ["NC"],
      }),
    },
    leadAllocation: {
      findMany: async () => [
        {
          id: "alloc_1",
          status: "reserved",
          sourceLeadEventId: "evt_1",
          leadInventoryItemId: "item_1",
          sourceLeadEvent: { normalizedPayloadJson: payload },
          leadInventoryItem: {
            id: "item_1",
            generatedAt: new Date("2024-06-15T00:00:00.000Z"),
            nicheKey,
            status: "reserved",
          },
        },
      ],
    },
  };
}

describe("buyer_csv_v3 niche-scoped activation", () => {
  it("activates v3 only for vet and trucker", () => {
    assert.equal(isBuyerCsvV3ActiveNiche("vet"), true);
    assert.equal(isBuyerCsvV3ActiveNiche("VET"), true);
    assert.equal(isBuyerCsvV3ActiveNiche("trucker"), true);
    assert.equal(activeBuyerCsvFieldSchemaVersionForNiche("vet"), BUYER_CSV_V3_FIELD_SCHEMA_VERSION);
    assert.equal(
      activeBuyerCsvFieldSchemaVersionForNiche("trucker"),
      BUYER_CSV_V3_FIELD_SCHEMA_VERSION
    );
  });

  it("keeps nurse, mortgage, solar, and unknown niches on v2", () => {
    for (const niche of ["nurse", "mortgage", "solar", "unknown_niche"] as const) {
      assert.equal(isBuyerCsvV3ActiveNiche(niche), false);
      assert.equal(
        activeBuyerCsvFieldSchemaVersionForNiche(niche),
        BUYER_CSV_V2_FIELD_SCHEMA_VERSION
      );
      const row = extractBuyerCsvV2Fields({
        normalizedPayloadJson: payload,
        generatedAt: new Date("2024-06-15T00:00:00.000Z"),
        nicheKey: niche,
      });
      const header = serializeBuyerCsvV2([row], niche).split("\n")[0]!.split(",");
      assert.deepEqual(header, buyerCsvColumnsForNiche(niche));
      assert.equal(header.includes("zip"), false);
      assert.equal(header.includes("age"), false);
    }
  });

  it("documents that a global v3 activation would add zip/age to nurse/mortgage", () => {
    for (const niche of ["nurse", "mortgage"] as const) {
      const v3 = extractBuyerCsvV3Fields({
        normalizedPayloadJson: payload,
        generatedAt: new Date("2024-06-15T00:00:00.000Z"),
        nicheKey: niche,
      });
      const header = serializeBuyerCsvV3([v3], niche).split("\n")[0]!.split(",");
      assert.deepEqual(header, buyerCsvV3ColumnsForNiche(niche));
      assert.equal(header[5], "zip");
      assert.equal(header[6], "age");
    }
  });

  it("preview writes v3 for vet and v2 for nurse", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";

    const vet = await previewBuyerCsvExport({ orderId: "ord_1" }, fakePreviewDb("vet") as never);
    assert.equal(vet.ok, true);
    if (!vet.ok || !("columns" in vet)) return;
    assert.equal(vet.fieldSchemaVersion, BUYER_CSV_V3_FIELD_SCHEMA_VERSION);
    assert.deepEqual([...vet.columns], buyerCsvV3ColumnsForNiche("vet"));

    const nurse = await previewBuyerCsvExport(
      { orderId: "ord_1" },
      fakePreviewDb("nurse") as never
    );
    assert.equal(nurse.ok, true);
    if (!nurse.ok || !("columns" in nurse)) return;
    assert.equal(nurse.fieldSchemaVersion, BUYER_CSV_V2_FIELD_SCHEMA_VERSION);
    assert.deepEqual([...nurse.columns], buyerCsvColumnsForNiche("nurse"));
    assert.equal(nurse.columns.includes("zip"), false);
    assert.equal(nurse.columns.includes("age"), false);
  });
});
