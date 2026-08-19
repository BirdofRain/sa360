import assert from "node:assert/strict";
import test from "node:test";

import { parseMasterGeneratedAt } from "./aged-inventory-bulk-date.js";

const EVAL = new Date("2026-08-18T12:00:00.000Z");

function assertOk(
  raw: string | null | undefined,
  expected: { isoDate: string; generatedAt: string; format?: string }
) {
  const parsed = parseMasterGeneratedAt(raw, EVAL);
  assert.equal(parsed.ok, true, `expected ok for ${JSON.stringify(raw)}`);
  if (!parsed.ok) return;
  assert.equal(parsed.isoDate, expected.isoDate);
  assert.equal(parsed.value.toISOString(), expected.generatedAt);
  if (expected.format) assert.equal(parsed.format, expected.format);
}

test("existing ISO date string still maps to UTC noon", () => {
  assertOk("2025-07-15", {
    isoDate: "2025-07-15",
    generatedAt: "2025-07-15T12:00:00.000Z",
    format: "iso_date",
  });
});

test("existing ISO timestamp still noon-coerces (time discarded)", () => {
  assertOk("2025-07-15T15:45:00.000Z", {
    isoDate: "2025-07-15",
    generatedAt: "2025-07-15T12:00:00.000Z",
    format: "iso_datetime",
  });
});

test("existing MDY datetime string still maps to UTC noon", () => {
  assertOk("7/15/2025 3:45:00 PM", {
    isoDate: "2025-07-15",
    generatedAt: "2025-07-15T12:00:00.000Z",
    format: "mdy_datetime_ampm",
  });
});

test("Excel integer serial 46224 is 2026-07-21 UTC noon", () => {
  assertOk("46224", {
    isoDate: "2026-07-21",
    generatedAt: "2026-07-21T12:00:00.000Z",
    format: "excel_serial",
  });
});

test("Excel integer serial 46232 is 2026-07-29 UTC noon", () => {
  assertOk("46232", {
    isoDate: "2026-07-29",
    generatedAt: "2026-07-29T12:00:00.000Z",
    format: "excel_serial",
  });
});

test("Excel fractional serial 46235.5 is 2026-08-01 12:00 UTC", () => {
  assertOk("46235.5", {
    isoDate: "2026-08-01",
    generatedAt: "2026-08-01T12:00:00.000Z",
    format: "excel_serial_fractional",
  });
});

test("Excel fractional serial preserves time-of-day", () => {
  assertOk("46235.25", {
    isoDate: "2026-08-01",
    generatedAt: "2026-08-01T06:00:00.000Z",
    format: "excel_serial_fractional",
  });
  assertOk("46235.75", {
    isoDate: "2026-08-01",
    generatedAt: "2026-08-01T18:00:00.000Z",
    format: "excel_serial_fractional",
  });
});

test("invalid numeric serials and NaN-like text are rejected", () => {
  const invalid = parseMasterGeneratedAt("1", EVAL);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.code, "generated_at_invalid");

  const outOfRange = parseMasterGeneratedAt("90000", EVAL);
  assert.equal(outOfRange.ok, false);
  if (!outOfRange.ok) assert.equal(outOfRange.code, "generated_at_invalid");

  const nanLike = parseMasterGeneratedAt("NaN", EVAL);
  assert.equal(nanLike.ok, false);
  if (!nanLike.ok) assert.equal(nanLike.code, "generated_at_invalid");

  const junk = parseMasterGeneratedAt("46224abc", EVAL);
  assert.equal(junk.ok, false);
  if (!junk.ok) assert.equal(junk.code, "generated_at_invalid");
});

test("blank generated date is missing, not invalid", () => {
  for (const raw of ["", "  ", null, undefined]) {
    const parsed = parseMasterGeneratedAt(raw, EVAL);
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.code, "generated_at_missing");
  }
});

test("lead-date year bounds still reject consumer-age Excel serials", () => {
  const dobSerial = parseMasterGeneratedAt("28988", EVAL);
  assert.equal(dobSerial.ok, false);
  if (!dobSerial.ok) assert.equal(dobSerial.code, "generated_at_invalid");
});

test("future Excel serials still hit future_generated_at", () => {
  const future = parseMasterGeneratedAt("50000", EVAL);
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.code, "future_generated_at");
});
