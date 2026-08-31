import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lookupNicheDisplayName, NICHE_DISPLAY_NAMES } from "@sa360/shared";

import {
  BUYER_CSV_CUSTOMER_HEADER_LABELS,
  BUYER_CSV_V4_FIELD_SCHEMA_VERSION,
  buyerCsvCustomerColumnKeysForPackage,
  buyerCsvCustomerHeaderLabel,
  buyerCsvNicheDisplayName,
  presentBuyerCsvCustomerPackage,
  serializeBuyerCsvCustomerPresentation,
} from "./buyer-csv-customer-presentation.js";
import { extractBuyerCsvV3Fields } from "./buyer-csv-export.service.js";

function vetRow(overrides: {
  generatedAt: string;
  zip?: string;
  coverage?: string;
  first?: string;
  payloadExtras?: Record<string, unknown>;
}) {
  return extractBuyerCsvV3Fields({
    normalizedPayloadJson: {
      contact: {
        first_name: overrides.first ?? "Ada",
        last_name: "Lovelace",
        phone_e164: "+15551234567",
        email: "ada@example.com",
        state: "NC",
        ...(overrides.zip ? { zip: overrides.zip } : {}),
      },
      lead_details: {
        consumer_age: 62,
        beneficiary: "Spouse",
        ...(overrides.coverage ? { coverage_amount: overrides.coverage } : {}),
        niche: {
          branch_of_service: "Army",
          disability_rating: "40%",
          primary_concern: "Income protection",
        },
      },
      ...overrides.payloadExtras,
    },
    generatedAt: new Date(overrides.generatedAt),
    nicheKey: "vet",
  });
}

describe("buyer CSV customer presentation", () => {
  it("keeps Date Generated first and Lead Type second", () => {
    const row = vetRow({ generatedAt: "2024-06-15T00:00:00.000Z", zip: "27513", coverage: "15000" });
    const presented = presentBuyerCsvCustomerPackage([row], "vet");
    assert.equal(presented.headers[0], "Date Generated");
    assert.equal(presented.headers[1], "Lead Type");
    assert.equal(presented.columnKeys[0], "lead_date");
    assert.equal(presented.columnKeys[1], "niche");
    assert.equal(presented.csv.split("\n")[0]!.split(",")[0], "Date Generated");
    assert.equal(presented.csv.split("\n")[0]!.split(",")[1], "Lead Type");
  });

  it("renders vet as Veteran via the shared niche display-name source", () => {
    assert.equal(NICHE_DISPLAY_NAMES.vet, "Veteran");
    assert.equal(lookupNicheDisplayName("vet"), "Veteran");
    assert.equal(buyerCsvNicheDisplayName("vet"), lookupNicheDisplayName("vet"));
    assert.equal(buyerCsvNicheDisplayName("VET"), "Veteran");
    assert.equal(buyerCsvNicheDisplayName("veteran"), "Veteran");
    assert.equal(buyerCsvNicheDisplayName("trucker"), "Trucker");
    assert.equal(buyerCsvNicheDisplayName("trucker"), lookupNicheDisplayName("trucker"));

    const row = vetRow({ generatedAt: "2024-06-15T00:00:00.000Z", zip: "27513" });
    assert.equal(row.niche, "vet");
    const csv = serializeBuyerCsvCustomerPresentation([row], "vet");
    const cells = csv.split("\n")[1]!.split(",");
    assert.equal(cells[1], "Veteran");
    assert.doesNotMatch(csv.split("\n")[1]!, /,vet,/);
  });

  it("uses customer-facing headers instead of snake_case", () => {
    assert.equal(buyerCsvCustomerHeaderLabel("lead_date"), "Date Generated");
    assert.equal(buyerCsvCustomerHeaderLabel("niche"), "Lead Type");
    assert.equal(buyerCsvCustomerHeaderLabel("first_name"), "First Name");
    assert.equal(buyerCsvCustomerHeaderLabel("last_name"), "Last Name");
    assert.equal(buyerCsvCustomerHeaderLabel("phone"), "Phone");
    assert.equal(buyerCsvCustomerHeaderLabel("email"), "Email");
    assert.equal(buyerCsvCustomerHeaderLabel("state"), "State");
    assert.equal(buyerCsvCustomerHeaderLabel("zip"), "ZIP");
    assert.equal(buyerCsvCustomerHeaderLabel("age"), "Age");
    assert.equal(buyerCsvCustomerHeaderLabel("coverage_amount"), "Coverage Amount");
    assert.equal(buyerCsvCustomerHeaderLabel("branch_of_service"), "Branch of Service");
    assert.equal(buyerCsvCustomerHeaderLabel("disability_rating"), "Disability Rating");
    assert.equal(buyerCsvCustomerHeaderLabel("primary_concern"), "Primary Concern");
    assert.equal(BUYER_CSV_CUSTOMER_HEADER_LABELS.beneficiary, "Beneficiary");
  });

  it("omits ZIP when the entire package is blank and retains it when populated", () => {
    const blankZip = vetRow({ generatedAt: "2024-06-15T00:00:00.000Z", coverage: "15000" });
    const blankPresented = presentBuyerCsvCustomerPackage([blankZip], "vet");
    assert.equal(blankPresented.headers.includes("ZIP"), false);
    assert.equal(blankPresented.columnKeys.includes("zip"), false);
    assert.doesNotMatch(blankPresented.csv.split("\n")[0]!, /\bZIP\b/);

    const withZip = vetRow({ generatedAt: "2024-06-15T00:00:00.000Z", zip: "27513" });
    const mixed = presentBuyerCsvCustomerPackage([blankZip, withZip], "vet");
    assert.equal(mixed.headers.includes("ZIP"), true);
    const zipIndex = mixed.headers.indexOf("ZIP");
    assert.ok(zipIndex > mixed.headers.indexOf("State"));
    assert.ok(zipIndex < mixed.headers.indexOf("Age"));
    assert.equal(mixed.csv.split("\n")[2]!.split(",")[zipIndex], "27513");
  });

  it("omits Coverage Amount when the entire package is blank and retains it when populated", () => {
    const blankCoverage = vetRow({ generatedAt: "2024-06-15T00:00:00.000Z", zip: "27513" });
    const blankPresented = presentBuyerCsvCustomerPackage([blankCoverage], "vet");
    assert.equal(blankPresented.headers.includes("Coverage Amount"), false);
    assert.equal(blankPresented.columnKeys.includes("coverage_amount"), false);

    const withCoverage = vetRow({
      generatedAt: "2024-06-15T00:00:00.000Z",
      zip: "27513",
      coverage: "25000",
    });
    const mixed = presentBuyerCsvCustomerPackage([blankCoverage, withCoverage], "vet");
    assert.equal(mixed.headers.includes("Coverage Amount"), true);
    const coverageIndex = mixed.headers.indexOf("Coverage Amount");
    assert.ok(coverageIndex > mixed.headers.indexOf("Beneficiary"));
    assert.equal(mixed.csv.split("\n")[2]!.split(",")[coverageIndex], "25000");
  });

  it("keeps populated niche-specific fields in a stable order", () => {
    const row = vetRow({ generatedAt: "2024-06-15T00:00:00.000Z", zip: "27513", coverage: "15000" });
    const presented = presentBuyerCsvCustomerPackage([row], "vet");
    assert.deepEqual(presented.headers, [
      "Date Generated",
      "Lead Type",
      "First Name",
      "Last Name",
      "Phone",
      "Email",
      "State",
      "ZIP",
      "Age",
      "Beneficiary",
      "Coverage Amount",
      "Branch of Service",
      "Disability Rating",
      "Primary Concern",
    ]);
    const cells = presented.csv.split("\n")[1]!.split(",");
    assert.equal(cells[presented.headers.indexOf("Beneficiary")], "Spouse");
    assert.equal(cells[presented.headers.indexOf("Branch of Service")], "Army");
    assert.equal(cells[presented.headers.indexOf("Disability Rating")], "40%");
    assert.equal(cells[presented.headers.indexOf("Primary Concern")], "Income protection");
    assert.equal(cells[presented.headers.indexOf("Age")], "62");
  });

  it("does not drop rows — allocation count equals CSV data row count", () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      vetRow({
        generatedAt: `2024-06-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        first: `Lead${index + 1}`,
        zip: index === 0 ? "27513" : "",
      })
    );
    const presented = presentBuyerCsvCustomerPackage(rows, "vet");
    const dataRows = presented.csv.trimEnd().split("\n").slice(1);
    assert.equal(rows.length, 50);
    assert.equal(dataRows.length, 50);
    assert.equal(
      buyerCsvCustomerColumnKeysForPackage(rows, "vet").includes("zip"),
      true
    );
    assert.equal(BUYER_CSV_V4_FIELD_SCHEMA_VERSION, "buyer_csv_v4");
  });
});
