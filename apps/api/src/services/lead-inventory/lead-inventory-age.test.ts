import { test } from "node:test";
import assert from "node:assert/strict";

import {
  calculateInventoryAgeDays,
  resolveAgeBandKey,
  ageDaysInBand,
} from "./lead-inventory-age.js";
import { DEFAULT_AGE_BANDS_V1 } from "./lead-inventory.constants.js";

test("calculateInventoryAgeDays uses elapsed whole UTC days", () => {
  const generatedAt = new Date("2026-01-01T12:00:00.000Z");
  const evaluatedAt = new Date("2026-01-08T11:59:59.000Z");
  assert.equal(calculateInventoryAgeDays(generatedAt, evaluatedAt), 6);
  assert.equal(
    calculateInventoryAgeDays(generatedAt, new Date("2026-01-08T12:00:00.000Z")),
    7
  );
});

test("age band boundaries resolve expected keys", () => {
  const bands = DEFAULT_AGE_BANDS_V1;
  assert.equal(resolveAgeBandKey(0, bands), "FRESH_0_7");
  assert.equal(resolveAgeBandKey(7, bands), "FRESH_0_7");
  assert.equal(resolveAgeBandKey(8, bands), "RECENT_8_30");
  assert.equal(resolveAgeBandKey(30, bands), "RECENT_8_30");
  assert.equal(resolveAgeBandKey(31, bands), "AGED_31_60");
  assert.equal(resolveAgeBandKey(366, bands), "AGED_366_PLUS");
  assert.equal(ageDaysInBand(365, bands[5]!), true);
  assert.equal(ageDaysInBand(366, bands[6]!), true);
});

test("leap year elapsed days remain deterministic", () => {
  const generatedAt = new Date("2024-02-28T00:00:00.000Z");
  const evaluatedAt = new Date("2024-03-01T00:00:00.000Z");
  assert.equal(calculateInventoryAgeDays(generatedAt, evaluatedAt), 2);
});
