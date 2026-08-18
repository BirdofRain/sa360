import assert from "node:assert/strict";
import test from "node:test";

import {
  completedWholeYearsAsOf,
  parseHistoricalConsumerAge,
} from "./aged-inventory-bulk-consumer-age.js";
import { parseMasterGeneratedAt } from "./aged-inventory-bulk-date.js";

const EVAL = new Date("2026-08-18T12:00:00.000Z");

test("plain integer ages 70 and 77 become consumer_age without inventing DOB", () => {
  const age70 = parseHistoricalConsumerAge("70", EVAL);
  assert.equal(age70.status, "age_integer");
  assert.equal(age70.consumerAge, 70);
  assert.equal(age70.dateOfBirth, null);

  const age77 = parseHistoricalConsumerAge("77", EVAL);
  assert.equal(age77.status, "age_integer");
  assert.equal(age77.consumerAge, 77);
  assert.equal(age77.dateOfBirth, null);
});

test("recognized US DOB 05/13/1979 normalizes to ISO and completed years", () => {
  const parsed = parseHistoricalConsumerAge("05/13/1979", EVAL);
  assert.equal(parsed.status, "dob_recognized");
  assert.equal(parsed.dateOfBirth, "1979-05-13");
  assert.equal(parsed.consumerAge, completedWholeYearsAsOf("1979-05-13", EVAL));
});

test("recognized ISO DOB 1979-05-13 keeps ISO and completed years", () => {
  const parsed = parseHistoricalConsumerAge("1979-05-13", EVAL);
  assert.equal(parsed.status, "dob_recognized");
  assert.equal(parsed.dateOfBirth, "1979-05-13");
  assert.equal(parsed.consumerAge, 47);
});

test("Excel 1900 serial 28988 resolves to 1979-05-13", () => {
  const parsed = parseHistoricalConsumerAge("28988", EVAL);
  assert.equal(parsed.status, "excel_serial");
  assert.equal(parsed.dateOfBirth, "1979-05-13");
  assert.equal(parsed.consumerAge, 47);
});

test("completed whole years before / on / after birthday", () => {
  const dob = "1979-05-13";
  assert.equal(completedWholeYearsAsOf(dob, new Date("2026-05-12T23:59:59.000Z")), 46);
  assert.equal(completedWholeYearsAsOf(dob, new Date("2026-05-13T00:00:00.000Z")), 47);
  assert.equal(completedWholeYearsAsOf(dob, new Date("2026-05-14T00:00:00.000Z")), 47);
});

test("invalid and ambiguous DOB/AGE invent nothing", () => {
  const empty = parseHistoricalConsumerAge("", EVAL);
  assert.equal(empty.status, "empty");
  assert.equal(empty.consumerAge, null);
  assert.equal(empty.dateOfBirth, null);

  const bad = parseHistoricalConsumerAge("not-a-date", EVAL);
  assert.equal(bad.status, "invalid");
  assert.equal(bad.consumerAge, null);
  assert.equal(bad.dateOfBirth, null);
  assert.equal(bad.raw, "not-a-date");

  const yearOnly = parseHistoricalConsumerAge("1979", EVAL);
  assert.ok(yearOnly.status === "ambiguous" || yearOnly.status === "invalid");
  assert.equal(yearOnly.consumerAge, null);
  assert.equal(yearOnly.dateOfBirth, null);
});

test("consumer DOB parser is not parseMasterGeneratedAt and never uses lead-date year bounds", () => {
  const leadDate = parseMasterGeneratedAt("1979-05-13", EVAL);
  assert.equal(leadDate.ok, false);

  const consumer = parseHistoricalConsumerAge("1979-05-13", EVAL);
  assert.equal(consumer.status, "dob_recognized");
  assert.equal(consumer.dateOfBirth, "1979-05-13");
});
