import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_AGE_BANDS_V1 } from "./lead-inventory.constants.js";
import {
  buildDemandOverlayFromLines,
  classifyOrderLineDemand,
  computeCellCoverage,
} from "./lead-inventory-demand.logic.js";

test("10 leads for NC + SC remains total flexible demand 10, not 20", () => {
  const assignment = classifyOrderLineDemand(
    {
      id: "line_1",
      normalizedStatesJson: ["NC", "SC"],
      ageBandKeysJson: ["FRESH_0_7"],
      minAgeDays: null,
      maxAgeDays: null,
      requestedQuantity: 10,
      reservedQuantity: 0,
      nicheKey: "VET",
      productType: null,
      fulfillmentPriority: 100,
    },
    DEFAULT_AGE_BANDS_V1
  );
  assert.equal(assignment?.kind, "flexible");
  const overlay = buildDemandOverlayFromLines(
    [
      {
        id: "line_1",
        normalizedStatesJson: ["NC", "SC"],
        ageBandKeysJson: ["FRESH_0_7"],
        minAgeDays: null,
        maxAgeDays: null,
        requestedQuantity: 10,
        reservedQuantity: 0,
        nicheKey: "VET",
        productType: null,
        fulfillmentPriority: 100,
      },
    ],
    DEFAULT_AGE_BANDS_V1
  );
  assert.equal(overlay.flexibleDemandTotal, 10);
  assert.equal(overlay.exactCellDemand.size, 0);
});

test("10 leads for two states and two bands remains 10, not 40", () => {
  const overlay = buildDemandOverlayFromLines(
    [
      {
        id: "line_2",
        normalizedStatesJson: ["NC", "SC"],
        ageBandKeysJson: ["FRESH_0_7", "RECENT_8_30"],
        minAgeDays: null,
        maxAgeDays: null,
        requestedQuantity: 10,
        reservedQuantity: 0,
        nicheKey: "VET",
        productType: null,
        fulfillmentPriority: 100,
      },
    ],
    DEFAULT_AGE_BANDS_V1
  );
  assert.equal(overlay.flexibleDemandTotal, 10);
  assert.equal([...overlay.exactCellDemand.values()].reduce((sum, n) => sum + n, 0), 0);
});

test("one state and one band maps exactly to one cell", () => {
  const assignment = classifyOrderLineDemand(
    {
      id: "line_3",
      normalizedStatesJson: ["NC"],
      ageBandKeysJson: ["FRESH_0_7"],
      minAgeDays: null,
      maxAgeDays: null,
      requestedQuantity: 10,
      reservedQuantity: 2,
      nicheKey: "VET",
      productType: null,
      fulfillmentPriority: 100,
    },
    DEFAULT_AGE_BANDS_V1
  );
  assert.equal(assignment?.kind, "exact");
  if (assignment?.kind === "exact") {
    assert.equal(assignment.state, "NC");
    assert.equal(assignment.ageBandKey, "FRESH_0_7");
    assert.equal(assignment.remainingQuantity, 8);
  }
});

test("coverage uses displayed supply against exact cell demand", () => {
  const coverage = computeCellCoverage({ exactCellDemand: 10, supply: 6 });
  assert.equal(coverage.unmet, 4);
  assert.equal(coverage.oversupply, 0);
  assert.equal(coverage.coverageRatio, 0.6);
});
