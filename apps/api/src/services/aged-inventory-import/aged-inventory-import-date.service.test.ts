import assert from "node:assert/strict";
import test from "node:test";

import { parseGeneratedAt } from "./aged-inventory-import-date.service.js";

test("parseGeneratedAt accepts ISO date", () => {
  const result = parseGeneratedAt("2026-03-15");
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.toISOString(), "2026-03-15T12:00:00.000Z");
});

test("parseGeneratedAt accepts ISO datetime", () => {
  const result = parseGeneratedAt("2026-03-15T08:30:00Z");
  assert.equal(result.ok, true);
});

test("parseGeneratedAt blocks ambiguous slash date without format", () => {
  const result = parseGeneratedAt("03/15/2026");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "generated_at_ambiguous");
});

test("parseGeneratedAt accepts mdy_slash when confirmed", () => {
  const result = parseGeneratedAt("03/15/2026", "mdy_slash");
  assert.equal(result.ok, true);
});

test("parseGeneratedAt rejects invalid date", () => {
  const result = parseGeneratedAt("not-a-date");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "generated_at_invalid");
});

test("parseGeneratedAt rejects missing date", () => {
  const result = parseGeneratedAt("");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "generated_at_missing");
});
