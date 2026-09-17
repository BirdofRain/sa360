import assert from "node:assert/strict";
import test from "node:test";

import { parseGoogleSpreadsheetRef } from "./google-spreadsheet-ref.js";

const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";

test("F. raw spreadsheet IDs are accepted", () => {
  assert.deepEqual(parseGoogleSpreadsheetRef(ID), { ok: true, spreadsheetId: ID });
  assert.deepEqual(parseGoogleSpreadsheetRef(`  ${ID}  `), { ok: true, spreadsheetId: ID });
});

test("G. canonical Google Sheets URLs yield only the spreadsheet ID", () => {
  const cases = [
    `https://docs.google.com/spreadsheets/d/${ID}`,
    `https://docs.google.com/spreadsheets/d/${ID}/edit`,
    `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`,
    `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`,
    `https://docs.google.com/spreadsheets/u/0/d/${ID}/edit`,
  ];
  for (const value of cases) {
    assert.deepEqual(parseGoogleSpreadsheetRef(value), { ok: true, spreadsheetId: ID });
  }
});

test("H. evil, Drive, and non-Google references are rejected", () => {
  const rejected = [
    "",
    "   ",
    "short",
    "../etc/passwd",
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://docs.google.com/spreadsheets/d/" + ID,
    "https://evil.example/spreadsheets/d/" + ID,
    "https://docs.google.com.evil.example/spreadsheets/d/" + ID,
    "https://drive.google.com/file/d/" + ID + "/view",
    "https://drive.google.com/open?id=" + ID,
    "https://docs.google.com/spreadsheets/d/" + ID + "/../../evil",
    "https://docs.google.com/document/d/" + ID,
    "https://user:pass@docs.google.com/spreadsheets/d/" + ID,
    `https://docs.google.com/spreadsheets/d/${ID}%2f..%2fetc`,
    "//docs.google.com/spreadsheets/d/" + ID,
    `https://docs.google.com/open?id=${ID}`,
    ID + "/edit",
    "ftp://docs.google.com/spreadsheets/d/" + ID,
  ];
  for (const value of rejected) {
    const result = parseGoogleSpreadsheetRef(value);
    assert.equal(result.ok, false, `expected reject: ${value}`);
  }
  assert.deepEqual(parseGoogleSpreadsheetRef(null), { ok: false, reason: "empty" });
  assert.deepEqual(parseGoogleSpreadsheetRef(undefined), { ok: false, reason: "empty" });
});

test("I. parser never treats the input as a fetch target", () => {
  const result = parseGoogleSpreadsheetRef(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=evil`);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spreadsheetId.includes("http"), false);
    assert.equal(result.spreadsheetId.includes("usp"), false);
  }
});
