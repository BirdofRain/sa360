import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseAndValidateAggregateInventoryCsv,
  parseLeadProcessorDate,
} from "./inventory-report-parser";
import {
  getInventoryExplorerFixture,
  loadInventoryReportCsvText,
} from "./inventory-fixtures";
import { US_STATE_AND_DC_CODES } from "./us-state-codes";

function leadProcessorShell(input: {
  sourceSheet: string;
  one: number;
  three: number;
  six: number;
  body: string;
  stateHeader?: string;
}): string {
  const header =
    input.stateHeader ??
    "State,1-3 months,3-6 months,6+ months,Total Available";
  return `Fast Lead Export Inventory Report,,,,
Version,5.0.0,,,
Source Sheet,${input.sourceSheet},,,
Started At,7/20/2026,,,
Completed At,7/20/2026,,,
Source Rows Available,100,,,
Rows Scanned,100,,,
,,,,
Skipped / Excluded Summary,,,,
,,,,
Bucket Totals,,,,
Lead Age Bucket,Available Leads,,,
1-3 months,${input.one},,,
3-6 months,${input.three},,,
6+ months,${input.six},,,
,,,,
State Breakdown,,,,
${header}
${input.body}`;
}

describe("Lead Processor inventory report parser", () => {
  it("parses Lead Processor dates as ISO", () => {
    assert.equal(
      parseLeadProcessorDate("7/20/2026", false),
      "2026-07-20T00:00:00.000Z"
    );
    assert.equal(
      parseLeadProcessorDate("7/20/2026", true),
      "2026-07-20T23:59:59.000Z"
    );
  });

  it("supports display State Breakdown header format", () => {
    const csv = leadProcessorShell({
      sourceSheet: "Truckers",
      one: 48,
      three: 67,
      six: 559,
      body: `NC,32,27,181,240
VA,13,40,378,431
ZZ,3,0,0,3
`,
    });
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.equal(v.stateBreakdownFound, true);
    assert.equal(v.stateTableHeaderFound, true);
    assert.equal(v.mappedGeographyCount, 2);
    assert.equal(v.unmappedGeographyCount, 1);
    assert.equal(v.mappedTotals.combined + v.unmappedTotals.combined, 674);
  });

  it("supports snake_case State Breakdown header format", () => {
    const csv = leadProcessorShell({
      sourceSheet: "Vet FEX",
      one: 48,
      three: 67,
      six: 559,
      stateHeader:
        "state,one_to_three_months,three_to_six_months,six_plus_months,total_available",
      body: `NC,32,27,181,240
VA,13,40,378,431
ZZ,3,0,0,3
`,
    });
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.equal(v.stateTableHeaderFound, true);
    assert.equal(v.mappedRows.find((r) => r.code === "NC")!.totalAvailable, 240);
  });

  it("rejects duplicate geography codes as INVALID", () => {
    const csv = leadProcessorShell({
      sourceSheet: "Truckers",
      one: 64,
      three: 54,
      six: 362,
      body: `NC,32,27,181,240
NC,32,27,181,240
`,
    });
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.equal(v.completeness, "INVALID");
    assert.equal(v.mappedGeographyCount, 0);
  });

  it("rejects row totals that do not equal bucket sums", () => {
    const csv = leadProcessorShell({
      sourceSheet: "Truckers",
      one: 32,
      three: 27,
      six: 181,
      body: `NC,32,27,181,999
`,
    });
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.ok(v.errors.some((e) => /NC.*!=/.test(e)));
    assert.equal(v.mappedGeographyCount, 0);
  });

  it("stops parsing at a subsequent recognized section", () => {
    const csv = `${leadProcessorShell({
      sourceSheet: "Truckers",
      one: 32,
      three: 27,
      six: 181,
      body: `NC,32,27,181,240
`,
    })}
Bucket Totals,,,,
TX,40,234,1856,2130
`;
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.ok(!v.mappedRows.some((r) => r.code === "TX"));
    assert.ok(!v.unmappedRows.some((r) => r.code === "TX"));
  });

  it("classifies non-US/DC codes as UNMAPPED_GEOGRAPHY without INVALID", () => {
    const mappedBody = US_STATE_AND_DC_CODES.map((code, i) => {
      const a = i === 0 ? 10 : 0;
      const b = i === 0 ? 20 : 0;
      const c = i === 0 ? 30 : 0;
      return `${code},${a},${b},${c},${a + b + c}`;
    }).join("\n");
    const csv = leadProcessorShell({
      sourceSheet: "Truckers",
      one: 13,
      three: 20,
      six: 33,
      body: `${mappedBody}
ZZ,3,0,0,3
QC,0,0,3,3
`,
    });
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.equal(v.completeness, "COMPLETE_WITH_WARNINGS");
    assert.equal(v.mappedGeographyCount, 51);
    assert.equal(v.unmappedGeographyCount, 2);
    assert.ok(v.unmappedRows.every((r) => r.classification === "UNMAPPED_GEOGRAPHY"));
    assert.ok(!v.mappedRows.some((r) => r.code === "ZZ" || r.code === "QC"));
  });

  it("parses authoritative Trucker 7/20 report metadata and reconciliation", () => {
    const csv = loadInventoryReportCsvText("TRUCKER");
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.equal(v.metadata.reportVersion, "5.0.0");
    assert.equal(v.metadata.sourceSheet, "Truckers");
    assert.equal(v.metadata.generatedAt, "2026-07-20T00:00:00.000Z");
    assert.equal(v.metadata.completedAt, "2026-07-20T23:59:59.000Z");
    assert.deepEqual(v.publishedTotals, {
      "1_3": 775,
      "3_6": 3117,
      "6_plus": 14815,
      combined: 18707,
    });
    assert.deepEqual(v.mappedTotals, {
      "1_3": 772,
      "3_6": 3107,
      "6_plus": 14782,
      combined: 18661,
    });
    assert.deepEqual(v.unmappedTotals, {
      "1_3": 3,
      "3_6": 10,
      "6_plus": 33,
      combined: 46,
    });
    assert.equal(
      v.mappedTotals.combined + v.unmappedTotals.combined,
      v.publishedTotals.combined
    );
    assert.equal(v.mappedGeographyCount, 51);
    assert.equal(v.unmappedGeographyCount, 31);
    assert.equal(v.completeness, "COMPLETE_WITH_WARNINGS");
    assert.notEqual(v.completeness, "INVALID");

    const nc = v.mappedRows.find((r) => r.code === "NC")!;
    const va = v.mappedRows.find((r) => r.code === "VA")!;
    const tx = v.mappedRows.find((r) => r.code === "TX")!;
    assert.deepEqual(
      [nc.oneToThreeMonths, nc.threeToSixMonths, nc.sixPlusMonths, nc.totalAvailable],
      [32, 27, 181, 240]
    );
    assert.deepEqual(
      [va.oneToThreeMonths, va.threeToSixMonths, va.sixPlusMonths, va.totalAvailable],
      [13, 40, 378, 431]
    );
    assert.deepEqual(
      [tx.oneToThreeMonths, tx.threeToSixMonths, tx.sixPlusMonths, tx.totalAvailable],
      [40, 234, 1856, 2130]
    );
  });

  it("parses authoritative VET 7/20 report metadata and reconciliation", () => {
    const csv = loadInventoryReportCsvText("VET");
    const v = parseAndValidateAggregateInventoryCsv(csv);
    assert.equal(v.metadata.reportVersion, "5.0.0");
    assert.equal(v.metadata.sourceSheet, "Vet FEX");
    assert.equal(v.metadata.generatedAt, "2026-07-20T00:00:00.000Z");
    assert.deepEqual(v.publishedTotals, {
      "1_3": 21104,
      "3_6": 37709,
      "6_plus": 88536,
      combined: 147349,
    });
    assert.deepEqual(v.mappedTotals, {
      "1_3": 21079,
      "3_6": 37643,
      "6_plus": 88372,
      combined: 147094,
    });
    assert.deepEqual(v.unmappedTotals, {
      "1_3": 25,
      "3_6": 66,
      "6_plus": 164,
      combined: 255,
    });
    assert.equal(
      v.mappedTotals.combined + v.unmappedTotals.combined,
      v.publishedTotals.combined
    );
    assert.equal(v.mappedGeographyCount, 51);
    assert.equal(v.unmappedGeographyCount, 85);
    assert.equal(v.completeness, "COMPLETE_WITH_WARNINGS");

    const nc = v.mappedRows.find((r) => r.code === "NC")!;
    const va = v.mappedRows.find((r) => r.code === "VA")!;
    const tx = v.mappedRows.find((r) => r.code === "TX")!;
    assert.deepEqual(
      [nc.oneToThreeMonths, nc.threeToSixMonths, nc.sixPlusMonths, nc.totalAvailable],
      [1095, 1649, 3762, 6506]
    );
    assert.deepEqual(
      [va.oneToThreeMonths, va.threeToSixMonths, va.sixPlusMonths, va.totalAvailable],
      [794, 1338, 3310, 5442]
    );
    assert.deepEqual(
      [tx.oneToThreeMonths, tx.threeToSixMonths, tx.sixPlusMonths, tx.totalAvailable],
      [2328, 3960, 9423, 15711]
    );
  });

  it("contains aggregate counts only with no PII columns in State Breakdown", () => {
    for (const niche of ["TRUCKER", "VET"] as const) {
      const csv = loadInventoryReportCsvText(niche);
      assert.ok(!/email|phone|first.?name|last.?name|lead_id/i.test(csv));
      const v = parseAndValidateAggregateInventoryCsv(csv);
      assert.ok(v.stateTableHeaderFound);
      assert.equal(v.errors.filter((e) => /sensitive/i.test(e)).length, 0);
    }
  });

  it("fixture capabilities remain read-only", () => {
    const model = getInventoryExplorerFixture();
    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    assert.equal(model.capabilities.canRequestQuote, false);
  });
});
