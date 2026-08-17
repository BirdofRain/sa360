import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUYER_CSV_COLUMNS,
  BUYER_CSV_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V2_FIELD_SCHEMA_VERSION,
  extractBuyerCsvFields,
  extractBuyerCsvV2Fields,
  serializeBuyerCsv,
  serializeBuyerCsvV2,
} from "./buyer-csv-export.service.js";
import { buyerCsvColumnsForNiche } from "./buyer-lead-fields.js";
import { buildPplOrderLineCreateData } from "./ppl-order-pricing.js";

const contactPayload = {
  contact: {
    first_name: "Ada",
    last_name: "Lovelace",
    phone_e164: "+15551234567",
    email: "ada@example.com",
    state: "NC",
  },
};

describe("buyer_csv_v2 contract", () => {
  it("keeps buyer_csv_v1 seven-column historical meaning", () => {
    assert.equal(BUYER_CSV_FIELD_SCHEMA_VERSION, "buyer_csv_v1");
    assert.equal(BUYER_CSV_COLUMNS.length, 7);
    const row = extractBuyerCsvFields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-06-15T22:45:11.123Z"),
      nicheKey: "vet",
    });
    const csv = serializeBuyerCsv([row]);
    assert.equal(
      csv.split("\n")[0],
      "first_name,last_name,phone,email,state,lead_date,niche"
    );
  });

  it("exports niche-specific v2 columns and blanks optional fields", () => {
    assert.equal(BUYER_CSV_V2_FIELD_SCHEMA_VERSION, "buyer_csv_v2");

    const vet = extractBuyerCsvV2Fields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-06-15T00:00:00.000Z"),
      nicheKey: "vet",
    });
    assert.equal(vet.beneficiary, "");
    assert.equal(vet.coverage_amount, "");
    assert.equal(vet.branch_of_service, "");
    assert.equal(vet.disability_rating, "");
    assert.deepEqual(serializeBuyerCsvV2([vet], "vet").split("\n")[0]!.split(","), [
      ...buyerCsvColumnsForNiche("vet"),
    ]);

    for (const niche of ["trucker", "nurse", "mortgage", "solar"] as const) {
      const row = extractBuyerCsvV2Fields({
        normalizedPayloadJson: contactPayload,
        generatedAt: new Date("2024-06-15T00:00:00.000Z"),
        nicheKey: niche,
      });
      const header = serializeBuyerCsvV2([row], niche).split("\n")[0]!.split(",");
      assert.deepEqual(header, buyerCsvColumnsForNiche(niche));
    }
  });

  it("fills optional fields from lead_details and historical aliases", () => {
    const row = extractBuyerCsvV2Fields({
      normalizedPayloadJson: {
        ...contactPayload,
        lead_details: {
          beneficiary: "Spouse",
          coverage_amount: "15000",
          niche: { branch_of_service: "Army", disability_rating: "40%" },
        },
      },
      generatedAt: new Date("2024-01-01T00:00:00.000Z"),
      nicheKey: "vet",
    });
    assert.equal(row.beneficiary, "Spouse");
    assert.equal(row.coverage_amount, "15000");
    assert.equal(row.branch_of_service, "Army");
    assert.equal(row.disability_rating, "40%");

    const historical = extractBuyerCsvV2Fields({
      normalizedPayloadJson: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone_e164: "+15551234567",
        email: "ada@example.com",
        state: "NC",
        "Rig Type": "Day Cab",
        owner_operator_status: "Independent",
      },
      generatedAt: new Date("2024-01-01T00:00:00.000Z"),
      nicheKey: "trucker",
    });
    assert.equal(historical.rig_type, "Day Cab");
  });

  it("recovers optional campaign intake fields for buyer_csv_v2", () => {
    const row = extractBuyerCsvV2Fields({
      normalizedPayloadJson: {
        contact: {
          first_name: "Cam",
          last_name: "Paign",
          phone_e164: "+15550001111",
          email: "cam@example.test",
          state: "FL",
        },
        lead_details: {
          beneficiary: "Spouse",
          coverage_amount: "25000",
          niche: { branch_of_service: "Navy", disability_rating: "10%" },
        },
      },
      generatedAt: new Date("2026-01-15T00:00:00.000Z"),
      nicheKey: "vet",
    });
    assert.equal(row.first_name, "Cam");
    assert.equal(row.beneficiary, "Spouse");
    assert.equal(row.coverage_amount, "25000");
    assert.equal(row.branch_of_service, "Navy");
    assert.equal(row.disability_rating, "10%");
  });

  it("keeps historical alias recovery after campaign optional fields", () => {
    const historical = extractBuyerCsvV2Fields({
      normalizedPayloadJson: {
        firstName: "Ada",
        lastName: "Lovelace",
        phone_e164: "+15551234567",
        email: "ada@example.com",
        state: "NC",
        "Rig Type": "Day Cab",
        owner_operator_status: "Independent",
      },
      generatedAt: new Date("2024-01-01T00:00:00.000Z"),
      nicheKey: "trucker",
    });
    assert.equal(historical.rig_type, "Day Cab");
    assert.equal(historical.company_or_independent, "Independent");
  });

  it("snapshots order line pricing for one commerce bucket", () => {
    const built = buildPplOrderLineCreateData({
      nicheKey: "vet",
      states: ["NC"],
      requestedQuantity: 100,
      commerceAgeBucketKey: "COMMERCE_3_6_MO",
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.snapshot.unitPriceCents, 400);
    assert.equal(built.snapshot.lineTotalCents, 40_000);
    assert.equal(built.snapshot.commerceAgeBucketKey, "COMMERCE_3_6_MO");
    assert.equal(built.snapshot.pricingVersion, "ppl_aged_beta_2026_08_v1");

    const hold = buildPplOrderLineCreateData({
      nicheKey: "vet",
      states: ["NC"],
      requestedQuantity: 10,
      commerceAgeBucketKey: "FRESH",
    });
    assert.equal(hold.ok, false);
  });
});
