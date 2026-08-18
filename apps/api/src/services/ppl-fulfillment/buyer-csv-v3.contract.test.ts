import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ACTIVE_BUYER_CSV_FIELD_SCHEMA_VERSION,
  BUYER_CSV_COLUMNS,
  BUYER_CSV_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V2_FIELD_SCHEMA_VERSION,
  BUYER_CSV_V3_FIELD_SCHEMA_VERSION,
  assertBuyerCsvV3Columns,
  commitBuyerCsvExport,
  extractBuyerCsvFields,
  extractBuyerCsvV2Fields,
  extractBuyerCsvV3Fields,
  serializeBuyerCsv,
  serializeBuyerCsvV2,
  serializeBuyerCsvV3,
} from "./buyer-csv-export.service.js";
import {
  BUYER_CSV_V3_COVERAGE_COLUMNS,
  buyerCsvColumnsForNiche,
  buyerCsvV3ColumnsForNiche,
  summarizeOptionalFieldCoverage,
} from "./buyer-lead-fields.js";

const VET_V3_COLUMNS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "state",
  "zip",
  "age",
  "lead_date",
  "niche",
  "beneficiary",
  "coverage_amount",
  "branch_of_service",
  "disability_rating",
  "primary_concern",
] as const;

const TRUCKER_V3_COLUMNS = [
  "first_name",
  "last_name",
  "phone",
  "email",
  "state",
  "zip",
  "age",
  "lead_date",
  "niche",
  "beneficiary",
  "coverage_amount",
  "rig_type",
  "company_or_independent",
] as const;

const FORBIDDEN_BUYER_CSV_NAMES = [
  "date_of_birth",
  "DOB/AGE",
  "Used By",
  "Date Used Last",
  "STATUS",
  "Synced",
  "source row number",
  "import request id",
  "rawPayloadJson",
  "enrichmentMetadataJson",
  "sourceCampaignName",
  "campaign_name",
  "previous agent",
  "previous client",
  "allocation IDs",
  "inventory IDs",
];

const __dirname = dirname(fileURLToPath(import.meta.url));

const originalFlag = process.env.SA360_PPL_CSV_EXPORT_ENABLED;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.SA360_PPL_CSV_EXPORT_ENABLED;
  else process.env.SA360_PPL_CSV_EXPORT_ENABLED = originalFlag;
});

const contactPayload = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone_e164: "+15551234567",
  email: "ada@example.com",
  state: "NC",
  campaign_name: "SECRET_CAMPAIGN_NAME",
  sourceCampaignName: "SECRET_SOURCE_CAMPAIGN",
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
    date_of_birth: "1963-05-01",
    beneficiary: "Spouse",
    niche: {
      branch_of_service: "Army",
      disability_rating: "40%",
      primary_concern: "Income protection",
      company_or_independent: "Independent",
      rig_type: "Day Cab",
    },
  },
  "Used By": "SECRET_USED_BY",
  "Date Used Last": "SECRET_DATE_USED_LAST",
  STATUS: "SECRET_STATUS",
  Synced: "SECRET_SYNCED",
  rawPayloadJson: "SECRET_RAW_PAYLOAD",
};

describe("buyer_csv_v3 contract", () => {
  it("keeps buyer_csv_v1 seven-column historical meaning", () => {
    assert.equal(BUYER_CSV_FIELD_SCHEMA_VERSION, "buyer_csv_v1");
    assert.deepEqual([...BUYER_CSV_COLUMNS], [
      "first_name",
      "last_name",
      "phone",
      "email",
      "state",
      "lead_date",
      "niche",
    ]);
    const row = extractBuyerCsvFields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-06-15T22:45:11.123Z"),
      nicheKey: "vet",
    });
    const csv = serializeBuyerCsv([row]);
    assert.equal(csv.split("\n")[0], "first_name,last_name,phone,email,state,lead_date,niche");
    assert.equal(row.lead_date, "2024-06-15");
    assert.equal(row.phone, "+15551234567");
  });

  it("keeps buyer_csv_v2 columns and meaning unchanged", () => {
    assert.equal(BUYER_CSV_V2_FIELD_SCHEMA_VERSION, "buyer_csv_v2");
    const vet = extractBuyerCsvV2Fields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-06-15T00:00:00.000Z"),
      nicheKey: "vet",
    });
    assert.deepEqual(serializeBuyerCsvV2([vet], "vet").split("\n")[0]!.split(","), [
      ...buyerCsvColumnsForNiche("vet"),
    ]);
    assert.equal("zip" in vet && Boolean(vet.zip), false);
    assert.equal("age" in vet && Boolean(vet.age), false);
    assert.equal(vet.primary_concern, undefined);
    assert.equal(vet.beneficiary, "Spouse");
    assert.equal(vet.branch_of_service, "Army");
  });

  it("exports exact VET v3 columns and order", () => {
    assert.equal(BUYER_CSV_V3_FIELD_SCHEMA_VERSION, "buyer_csv_v3");
    assert.equal(ACTIVE_BUYER_CSV_FIELD_SCHEMA_VERSION, "buyer_csv_v3");
    assert.deepEqual(buyerCsvV3ColumnsForNiche("vet"), [...VET_V3_COLUMNS]);
    const row = extractBuyerCsvV3Fields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-06-15T22:45:11.123Z"),
      nicheKey: "vet",
    });
    const header = serializeBuyerCsvV3([row], "vet").split("\n")[0]!.split(",");
    assert.deepEqual(header, [...VET_V3_COLUMNS]);
    assert.equal(row.zip, "27513");
    assert.equal(row.age, "62");
    assert.equal(row.lead_date, "2024-06-15");
    assert.equal(row.niche, "vet");
    assert.equal(row.beneficiary, "Spouse");
    assert.equal(row.branch_of_service, "Army");
    assert.equal(row.disability_rating, "40%");
    assert.equal(row.primary_concern, "Income protection");
    assert.equal(row.first_name, "Ada");
    assert.equal(row.phone, "+15551234567");
  });

  it("exports exact Trucker v3 columns and order", () => {
    assert.deepEqual(buyerCsvV3ColumnsForNiche("trucker"), [...TRUCKER_V3_COLUMNS]);
    const row = extractBuyerCsvV3Fields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-01-01T00:00:00.000Z"),
      nicheKey: "trucker",
    });
    const header = serializeBuyerCsvV3([row], "trucker").split("\n")[0]!.split(",");
    assert.deepEqual(header, [...TRUCKER_V3_COLUMNS]);
    assert.equal(row.rig_type, "Day Cab");
    assert.equal(row.company_or_independent, "Independent");
    assert.equal(row.zip, "27513");
    assert.equal(row.age, "62");
    assert.equal(row.beneficiary, "Spouse");
  });

  it("serializes missing optional v3 fields as blank without failing", () => {
    const row = extractBuyerCsvV3Fields({
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          phone_e164: "+15551234567",
          email: "ada@example.com",
          state: "NC",
        },
      },
      generatedAt: new Date("2020-01-01T00:00:00.000Z"),
      nicheKey: "vet",
    });
    assert.equal(row.zip, "");
    assert.equal(row.age, "");
    assert.equal(row.beneficiary, "");
    assert.equal(row.coverage_amount, "");
    assert.equal(row.branch_of_service, "");
    assert.equal(row.disability_rating, "");
    assert.equal(row.primary_concern, "");
    assert.equal(row.lead_date, "2020-01-01");
    const csv = serializeBuyerCsvV3([row], "vet");
    assert.equal(
      csv.split("\n")[1],
      "Ada,Lovelace,+15551234567,ada@example.com,NC,,,2020-01-01,vet,,,,,"
    );
  });

  it("never derives consumer age from lead_date or date_of_birth", () => {
    const row = extractBuyerCsvV3Fields({
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          phone_e164: "+15551234567",
          email: "ada@example.com",
          state: "NC",
        },
        lead_details: { date_of_birth: "1963-05-01" },
        generated_at: "2018-04-01T00:00:00.000Z",
      },
      generatedAt: new Date("2018-04-01T12:00:00.000Z"),
      nicheKey: "vet",
    });
    assert.equal(row.lead_date, "2018-04-01");
    assert.equal(row.age, "");
    assert.doesNotMatch(serializeBuyerCsvV3([row], "vet"), /1963-05-01/);
  });

  it("keeps existing identity serialization and lead_date from generatedAt", () => {
    const generatedAt = new Date("2024-06-15T22:45:11.123Z");
    const input = { normalizedPayloadJson: contactPayload, generatedAt, nicheKey: "vet" };
    const v1 = extractBuyerCsvFields(input);
    const v3 = extractBuyerCsvV3Fields(input);
    assert.equal(v3.first_name, v1.first_name);
    assert.equal(v3.last_name, v1.last_name);
    assert.equal(v3.phone, v1.phone);
    assert.equal(v3.email, v1.email);
    assert.equal(v3.state, v1.state);
    assert.equal(v3.lead_date, v1.lead_date);
    assert.equal(v3.niche, v1.niche);
  });

  it("never exports forbidden privacy columns or their secret values", () => {
    const row = extractBuyerCsvV3Fields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-06-15T00:00:00.000Z"),
      nicheKey: "vet",
    });
    const csv = serializeBuyerCsvV3([row], "vet");
    const header = csv.split("\n")[0]!;
    for (const name of FORBIDDEN_BUYER_CSV_NAMES) {
      assert.equal(header.split(",").includes(name), false, `column ${name} must not appear`);
    }
    assert.doesNotMatch(csv, /date_of_birth/i);
    assert.doesNotMatch(csv, /campaign_name/);
    assert.doesNotMatch(csv, /sourceCampaignName/);
    assert.doesNotMatch(csv, /Used By/);
    assert.doesNotMatch(csv, /Date Used Last/);
    assert.doesNotMatch(csv, /\bSTATUS\b/);
    assert.doesNotMatch(csv, /\bSynced\b/);
    assert.doesNotMatch(csv, /rawPayloadJson/);
    assert.doesNotMatch(csv, /SECRET_CAMPAIGN_NAME|SECRET_SOURCE_CAMPAIGN|SECRET_USED_BY|SECRET_DATE_USED_LAST|SECRET_STATUS|SECRET_SYNCED|SECRET_RAW_PAYLOAD|1963-05-01/);
    assert.throws(() => assertBuyerCsvV3Columns(["date_of_birth"], "vet"), /forbidden_column/);
    assert.throws(() => assertBuyerCsvV3Columns(["campaign_name"], "vet"), /forbidden_column/);
  });

  it("previews v3 optional coverage including zip and age without failing export", () => {
    const populated = extractBuyerCsvV3Fields({
      normalizedPayloadJson: contactPayload,
      generatedAt: new Date("2024-06-15T00:00:00.000Z"),
      nicheKey: "vet",
    });
    const blank = extractBuyerCsvV3Fields({
      normalizedPayloadJson: {
        contact: {
          first_name: "Ada",
          last_name: "Lovelace",
          phone_e164: "+15551234567",
          email: "ada@example.com",
          state: "NC",
        },
      },
      generatedAt: new Date("2024-06-15T00:00:00.000Z"),
      nicheKey: "vet",
    });
    const rows = [populated, ...Array.from({ length: 99 }, () => blank)];
    const coverage = summarizeOptionalFieldCoverage(
      rows,
      buyerCsvV3ColumnsForNiche("vet"),
      BUYER_CSV_V3_COVERAGE_COLUMNS
    );
    assert.deepEqual(coverage.zip, { populated: 1, total: 100 });
    assert.deepEqual(coverage.age, { populated: 1, total: 100 });
    assert.deepEqual(coverage.beneficiary, { populated: 1, total: 100 });
    assert.deepEqual(coverage.branch_of_service, { populated: 1, total: 100 });
    assert.deepEqual(coverage.disability_rating, { populated: 1, total: 100 });
    assert.deepEqual(coverage.primary_concern, { populated: 1, total: 100 });
  });

  it("replays an existing export package without rewriting schema or hash", async () => {
    process.env.SA360_PPL_CSV_EXPORT_ENABLED = "true";
    const existingCsv = "first_name,last_name,phone,email,state,lead_date,niche,beneficiary,coverage_amount,branch_of_service,disability_rating\n";
    const existing = {
      id: "pkg_historical_v2",
      leadOrderId: "ord_1",
      clientAccountId: "client_1",
      rowCount: 1,
      allocationIdsJson: ["alloc_1"],
      fieldSchemaVersion: "buyer_csv_v2",
      contentSha256: "historical-sha-v2",
      csvContent: existingCsv,
      metadataJson: {
        schema: "buyer_csv_export_metadata_v1",
        fieldSchemaVersion: "buyer_csv_v2",
        niche: "vet",
        commerceAgeBucketKey: "COMMERCE_3_6_MO",
        pricingVersion: "ppl_aged_beta_2026_08_v1",
        unitPriceCents: 400,
        requestedQuantity: 1,
        selectedRowCount: 1,
        columns: buyerCsvColumnsForNiche("vet"),
      },
    };
    const db = {
      leadDeliveryExportPackage: {
        findUnique: async () => existing,
      },
      leadOrder: {
        findUnique: async () => ({
          orderNumber: "1001",
          clientDisplayName: "Replay Client",
          nicheKey: "vet",
          statesJson: ["NC"],
        }),
      },
    };
    const result = await commitBuyerCsvExport(
      { orderId: "ord_1", idempotencyKey: "replay-key" },
      db as never
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.idempotentReplay, true);
    assert.equal(result.fieldSchemaVersion, "buyer_csv_v2");
    assert.equal(result.contentSha256, "historical-sha-v2");
    assert.notEqual(result.fieldSchemaVersion, BUYER_CSV_V3_FIELD_SCHEMA_VERSION);
  });

  it("does not let zip or consumer_age enter inventory selection", () => {
    const selectionSource = readFileSync(join(__dirname, "inventory-selection.service.ts"), "utf8");
    assert.equal(selectionSource.includes("buyer-lead-fields"), false);
    assert.equal(selectionSource.includes("consumer_age"), false);
    assert.equal(selectionSource.includes("contact.zip"), false);
  });
});
