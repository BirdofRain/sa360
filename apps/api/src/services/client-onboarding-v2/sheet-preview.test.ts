import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import { companySheetsCampaignHeader } from "../../lib/company-google-sheets-env.js";
import { COMPANY_SHEETS_RECONCILE_ROW_CAP } from "../../lib/company-google-sheets-env.js";
import { classifyOnboardingWorksheet, isStatsWorksheetTitle } from "./sheet-preview.js";

const legacyHeader = [
  "Age/ DOB",
  "Primary Reason",
  "Fixture Legacy 03",
  "Fixture Legacy 04",
  "Fixture Legacy 05",
  "Fixture Legacy 06",
  "Fixture Legacy 07",
  "Fixture Legacy 08",
  "Fixture Legacy 09",
  "Fixture Legacy 10",
  "Fixture Legacy 11",
  "Fixture Legacy 12",
  "Fixture Legacy 13",
  "Fixture Legacy 14",
  "Fixture Legacy 15",
];

function classify(title: string, header: string[], columnA: string[][], sheetType = "GRID") {
  return classifyOnboardingWorksheet({ worksheetId: 1, title, sheetType, header, columnA });
}

test("v3 header length stays 35 and matches the campaign header source", () => {
  assert.equal(COMPANY_SHEETS_V3_HEADER.length, 35);
  assert.deepEqual(companySheetsCampaignHeader("company_sheets_campaign_v3"), COMPANY_SHEETS_V3_HEADER);
});

test("Campaign Leads with an empty exact v3 header is the fast path and still requires selection", () => {
  const sheet = classify("Campaign Leads", [...COMPANY_SHEETS_V3_HEADER], [[COMPANY_SHEETS_V3_HEADER[0]!]]);
  assert.equal(sheet.classification, "v3_exact_header");
  assert.equal(sheet.fastPath, true);
  assert.equal(sheet.historicalDataRows, "empty");
  assert.equal(sheet.historicalDataRowCount, 0);
  assert.equal(sheet.headerColumnCount, 35);
  assert.equal(sheet.deliveryEligible, true);
  assert.equal(sheet.requiresExplicitSelection, true);
});

test("a longer v3 prefix is not the fast path", () => {
  const sheet = classify("Campaign Leads", [...COMPANY_SHEETS_V3_HEADER, "Extra"], [[COMPANY_SHEETS_V3_HEADER[0]!]]);
  assert.equal(sheet.classification, "v3_prefix_with_extra_columns");
  assert.equal(sheet.fastPath, false);
  assert.equal(sheet.deliveryEligible, false);
});

test("header drift and ambiguous age labels are not an exact v3 header", () => {
  const drifted = [...COMPANY_SHEETS_V3_HEADER];
  drifted[0] = "date";
  assert.equal(classify("Campaign Leads", drifted, [["date"]]).classification, "legacy_custom_required");
  const spaced = [...COMPANY_SHEETS_V3_HEADER];
  spaced[1] = `${COMPANY_SHEETS_V3_HEADER[1]} `;
  assert.equal(classify("Campaign Leads", spaced, [["Date"]]).classification, "legacy_custom_required");
  const ambiguous = classify("VET Web Form", ["Age/DOB", "Age / DOB", "Age", "DOB", "Primary Reason"], [["Age/DOB"]]);
  assert.equal(ambiguous.classification, "legacy_custom_required");
  assert.equal(ambiguous.fastPath, false);
});

test("VET Web Form with five historical rows is legacy and not delivery eligible", () => {
  const columnA = [[legacyHeader[0]!], ["row-1"], ["row-2"], ["row-3"], ["row-4"], ["row-5"]];
  const sheet = classify("VET Web Form", legacyHeader, columnA);
  assert.equal(legacyHeader.length, 15);
  assert.equal(sheet.classification, "legacy_custom_required");
  assert.equal(sheet.historicalDataRows, "has_rows");
  assert.equal(sheet.historicalDataRowCount, 5);
  assert.equal(sheet.deliveryEligible, false);
  assert.equal(sheet.fastPath, false);
});

test("Daily Stats and Weekly Stats are excluded even when row 1 is the v3 header", () => {
  for (const title of ["Daily Stats", " Weekly Stats ", "daily stats"]) {
    const sheet = classify(title, [...COMPANY_SHEETS_V3_HEADER], [[COMPANY_SHEETS_V3_HEADER[0]!], ["stat"]]);
    assert.equal(sheet.classification, "stats_excluded", title);
    assert.equal(sheet.deliveryEligible, false);
    assert.equal(sheet.fastPath, false);
  }
  assert.equal(isStatsWorksheetTitle("Weekly Statistics"), false);
  assert.equal(classify("Weekly Statistics", ["Notes"], [["Notes"]]).classification, "legacy_custom_required");
});

test("a probe past the reconcile cap is truncated and not a fast path", () => {
  const columnA = Array.from({ length: COMPANY_SHEETS_RECONCILE_ROW_CAP + 1 }, (_, index) => [
    index === 0 ? COMPANY_SHEETS_V3_HEADER[0]! : `row-${index}`,
  ]);
  const sheet = classify("Campaign Leads", [...COMPANY_SHEETS_V3_HEADER], columnA);
  assert.equal(sheet.historicalDataRows, "truncated");
  assert.equal(sheet.historicalDataRowCount, undefined);
  assert.equal(sheet.fastPath, false);
  assert.equal(sheet.deliveryEligible, false);
  assert.equal(sheet.reasons.includes("reconcile_incomplete"), true);
});

test("a blank grid is compatible_empty and a non-grid is not a legacy map", () => {
  const blank = classify("Sheet1", [], []);
  assert.equal(blank.classification, "compatible_empty");
  assert.equal(blank.deliveryEligible, true);
  assert.equal(blank.fastPath, false);
  const chart = classify("Chart", ["Date"], [["Date"]], "CHART");
  assert.equal(chart.classification, "not_grid");
  assert.equal(chart.deliveryEligible, false);
});

test("preview module does not call sheet writes and sameHeader stays a prefix comparator", () => {
  const preview = readFileSync(new URL("./sheet-preview.ts", import.meta.url), "utf8");
  assert.equal(preview.includes("appendSheetValues"), false);
  assert.equal(preview.includes("updateSheetValues"), false);
  assert.equal(preview.includes("createCompanyDriveFile"), false);
  assert.equal(preview.includes("permissions.create"), false);
  assert.equal(preview.includes("spreadsheets.batchUpdate"), false);
  assert.equal(preview.includes("values.append"), false);
  assert.equal(preview.includes("values.update"), false);
  const tabContract = readFileSync(
    new URL("../company-sheets-delivery/company-sheets-tab-contract.service.ts", import.meta.url),
    "utf8"
  );
  assert.match(tabContract, /function sameHeader\(actual: string\[\], expected: string\[\]\): boolean \{\n  if \(actual.length < expected.length\) return false;/);
});
