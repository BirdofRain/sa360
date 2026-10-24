import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPANY_SHEETS_UNMAPPED_SAMPLE_LABELS,
  COMPANY_SHEETS_V3_COLUMNS,
  COMPANY_SHEETS_V3_HEADER,
  companySheetsTemplateNiche,
  companySheetsV3HeaderMatches,
} from "./company-sheets-column-template.ts";

test("v3 keeps identity columns first and niche questions after them", () => {
  const groups = COMPANY_SHEETS_V3_COLUMNS.map((column) => column.group);
  const nicheAt = groups.indexOf("niche");
  const enrichedAt = groups.indexOf("enriched");
  const technicalAt = groups.indexOf("technical");
  assert.ok(nicheAt > 0);
  assert.ok(groups.slice(0, nicheAt).every((group) => group === "identity"));
  assert.ok(enrichedAt > nicheAt);
  assert.ok(technicalAt > enrichedAt);
  assert.deepEqual(COMPANY_SHEETS_V3_HEADER.slice(0, 5), ["Date", "Client Name", "Phone", "Email", "State"]);
  assert.equal(COMPANY_SHEETS_V3_COLUMNS[0]?.sourceField, "submitted_at");
  assert.equal(COMPANY_SHEETS_V3_COLUMNS[1]?.sourceField, "full_name");
  assert.match(COMPANY_SHEETS_V3_COLUMNS[1]?.help ?? "", /not the purchasing agent/);
  assert.match(COMPANY_SHEETS_V3_COLUMNS[0]?.help ?? "", /not the delivery time/);
});

test("v3 does not invent unmapped sample columns", () => {
  const headers = new Set(COMPANY_SHEETS_V3_HEADER);
  for (const sample of COMPANY_SHEETS_UNMAPPED_SAMPLE_LABELS) {
    assert.equal(headers.has(sample.label), false);
  }
  assert.equal(
    COMPANY_SHEETS_V3_COLUMNS.some((column) => column.sourceField === "date_of_birth"),
    false
  );
  assert.equal(new Set(COMPANY_SHEETS_V3_COLUMNS.map((column) => column.sourceField)).size, COMPANY_SHEETS_V3_COLUMNS.length);
});

test("only stored veteran niche keys count as the veteran template", () => {
  assert.equal(companySheetsTemplateNiche("vet"), "vet");
  assert.equal(companySheetsTemplateNiche("VET_FEX"), "vet");
  assert.equal(companySheetsTemplateNiche("nurse"), "unsupported");
  assert.equal(companySheetsTemplateNiche("trucker"), "unsupported");
  assert.equal(companySheetsTemplateNiche(""), "unsupported");
  assert.equal(companySheetsV3HeaderMatches([...COMPANY_SHEETS_V3_HEADER, "extra"]), true);
  assert.equal(companySheetsV3HeaderMatches(["Date"]), false);
});
