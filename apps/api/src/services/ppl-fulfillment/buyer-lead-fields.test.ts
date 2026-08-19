import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BUYER_CSV_V3_COVERAGE_COLUMNS,
  BUYER_FIELD_ALIASES,
  buyerCsvColumnsForNiche,
  buyerCsvV3ColumnsForNiche,
  readBuyerCsvV3ZipAndAge,
  readOptionalBuyerSalesContextFields,
  resolveBuyerFieldAlias,
  summarizeOptionalFieldCoverage,
} from "./buyer-lead-fields.js";

describe("buyer lead field alias registry", () => {
  it("resolves seed aliases for all optional sales-context fields", () => {
    for (const [field, aliases] of Object.entries(BUYER_FIELD_ALIASES)) {
      for (const alias of aliases) {
        assert.equal(
          resolveBuyerFieldAlias(alias),
          field,
          `alias ${alias} should resolve to ${field}`
        );
      }
    }
  });

  it("uses deterministic precedence and does not overwrite earlier values", () => {
    const fields = readOptionalBuyerSalesContextFields({
      lead_details: {
        beneficiary: "Spouse",
        coverage_amount: "$15k",
        niche: { branch_of_service: "Army" },
      },
      beneficiary: "Child",
      Beneficiary: "Parent",
      branch_of_service: "Navy",
      desired_coverage: "$99k",
    });
    assert.equal(fields.beneficiary, "Spouse");
    assert.equal(fields.coverage_amount, "$15k");
    assert.equal(fields.branch_of_service, "Army");
  });

  it("reads historical flat / sourceAttributes payloads via alias fallback", () => {
    const fields = readOptionalBuyerSalesContextFields({
      firstName: "Ada",
      Disability_Rating: "70%",
      "VA Rating": "ignored-after-first",
      sourceAttributes: {
        desired_coverage: "10000",
        military_branch: "Marines",
      },
    });
    assert.equal(fields.coverage_amount, "10000");
    assert.equal(fields.disability_rating, "70%");
    assert.equal(fields.branch_of_service, "Marines");
  });

  it("builds niche allowlists and unknown niche base-only", () => {
    assert.deepEqual(buyerCsvColumnsForNiche("vet").slice(-2), [
      "branch_of_service",
      "disability_rating",
    ]);
    assert.deepEqual(buyerCsvColumnsForNiche("trucker").slice(-2), [
      "rig_type",
      "company_or_independent",
    ]);
    assert.deepEqual(buyerCsvColumnsForNiche("nurse").slice(-2), [
      "healthcare_profession",
      "primary_concern",
    ]);
    assert.deepEqual(buyerCsvColumnsForNiche("mortgage").slice(-2), [
      "homeowner",
      "house_type",
    ]);
    assert.deepEqual(buyerCsvColumnsForNiche("unknown_niche"), [
      "first_name",
      "last_name",
      "phone",
      "email",
      "state",
      "lead_date",
      "niche",
      "beneficiary",
      "coverage_amount",
    ]);
  });

  it("builds buyer_csv_v3 allowlists without changing v2 column order", () => {
    assert.deepEqual(buyerCsvV3ColumnsForNiche("vet"), [
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
    ]);
    assert.deepEqual(buyerCsvV3ColumnsForNiche("trucker"), [
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
    ]);
    assert.deepEqual(buyerCsvColumnsForNiche("vet"), [
      "first_name",
      "last_name",
      "phone",
      "email",
      "state",
      "lead_date",
      "niche",
      "beneficiary",
      "coverage_amount",
      "branch_of_service",
      "disability_rating",
    ]);
  });

  it("reads contact.zip and lead_details.consumer_age without using date_of_birth", () => {
    const fields = readBuyerCsvV3ZipAndAge({
      zip: "00000",
      consumer_age: "99",
      date_of_birth: "1955-03-12",
      generated_at: "2020-01-01T00:00:00.000Z",
      contact: { zip: "27513" },
      lead_details: { consumer_age: 62, date_of_birth: "1963-05-01" },
    });
    assert.equal(fields.zip, "27513");
    assert.equal(fields.age, "62");
  });

  it("summarizes optional coverage without exposing values", () => {
    const summary = summarizeOptionalFieldCoverage(
      [
        { branch_of_service: "Army", disability_rating: "" },
        { branch_of_service: "Navy", disability_rating: "30%" },
      ],
      ["branch_of_service", "disability_rating"]
    );
    assert.deepEqual(summary.branch_of_service, { populated: 2, total: 2 });
    assert.deepEqual(summary.disability_rating, { populated: 1, total: 2 });
  });

  it("summarizes v3 coverage for zip and age without failing on blanks", () => {
    const summary = summarizeOptionalFieldCoverage(
      [
        { zip: "27513", age: "62", beneficiary: "Spouse" },
        { zip: "", age: "", beneficiary: "" },
      ],
      ["zip", "age", "beneficiary", "first_name"],
      BUYER_CSV_V3_COVERAGE_COLUMNS
    );
    assert.deepEqual(summary.zip, { populated: 1, total: 2 });
    assert.deepEqual(summary.age, { populated: 1, total: 2 });
    assert.deepEqual(summary.beneficiary, { populated: 1, total: 2 });
    assert.equal(summary.first_name, undefined);
  });
});
