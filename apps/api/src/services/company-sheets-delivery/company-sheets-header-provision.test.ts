import assert from "node:assert/strict";
import test from "node:test";

import { provisionBlankSheetHeader } from "./company-sheets-header-provision.js";

const header = ["Date", "Client Name", "delivery_row_id"];

test("a populated sheet is not rewritten", async () => {
  let appends = 0;
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => ({ ok: true, values: [["Already", "Here"]] }),
    appendValues: async () => {
      appends += 1;
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: false, code: "header_conflict" });
  assert.equal(appends, 0);
});

test("an empty sheet gets one append and no values update", async () => {
  const calls: string[] = [];
  let rows: string[][] = [];
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => ({ ok: true, values: rows }),
    appendValues: async (input) => {
      calls.push("append");
      assert.equal(input.values[0]?.[1], "Client Name");
      rows = input.values;
      return { ok: true };
    },
    formatHeader: async () => {
      calls.push("format");
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: true, headerWritten: true, formattingApplied: true });
  assert.deepEqual(calls, ["append", "format"]);
});

test("an ambiguous append is not repeated", async () => {
  let appends = 0;
  let rows: string[][] = [];
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => ({ ok: true, values: rows }),
    appendValues: async (input) => {
      appends += 1;
      rows = input.values;
      return { ok: false, reason: "network_error" };
    },
    formatHeader: async () => ({ ok: true }),
  });
  assert.equal(result.ok, true);
  assert.equal(appends, 1);
});

test("a confirmed append does not depend on a second read", async () => {
  let reads = 0;
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => {
      reads += 1;
      return { ok: true, values: [] };
    },
    appendValues: async () => ({ ok: true }),
    formatHeader: async () => ({ ok: true }),
  });
  assert.deepEqual(result, { ok: true, headerWritten: true, formattingApplied: true });
  assert.equal(reads, 1);
});

test("an ambiguous append that did not land stays unresolved", async () => {
  let appends = 0;
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => ({ ok: true, values: [] }),
    appendValues: async () => {
      appends += 1;
      return { ok: false, reason: "server_error" };
    },
  });
  assert.deepEqual(result, { ok: false, code: "create_outcome_unknown" });
  assert.equal(appends, 1);
});
