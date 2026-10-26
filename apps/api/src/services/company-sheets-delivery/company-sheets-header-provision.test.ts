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

test("a successful append is confirmed at row 1 before it counts as written", async () => {
  let reads = 0;
  let appends = 0;
  const rows: string[][] = [];
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => {
      reads += 1;
      return { ok: true, values: rows.map((row) => [...row]) };
    },
    appendValues: async (input) => {
      appends += 1;
      rows.push(...input.values);
      return { ok: true };
    },
    formatHeader: async () => ({ ok: true }),
  });
  assert.deepEqual(result, { ok: true, headerWritten: true, formattingApplied: true });
  assert.equal(appends, 1);
  assert.equal(reads, 2);
});

test("cells that appear before the header append are not overwritten", async () => {
  let appends = 0;
  let reads = 0;
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => {
      reads += 1;
      return { ok: true, values: reads === 1 ? [] : [["Existing", "Lead"]] };
    },
    appendValues: async () => {
      appends += 1;
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: false, code: "create_outcome_unknown" });
  assert.equal(appends, 1);
});

test("a timeout after the header is appended does not append again", async () => {
  let appends = 0;
  let reads = 0;
  const result = await provisionBlankSheetHeader({
    spreadsheetId: "sheet",
    worksheetTitle: "Campaign Leads",
    worksheetId: 3,
    header,
    accessToken: "token",
    getValues: async () => {
      reads += 1;
      if (reads === 1) return { ok: true, values: [] };
      return { ok: false, reason: "network_error" as const };
    },
    appendValues: async () => {
      appends += 1;
      return { ok: true };
    },
  });
  assert.deepEqual(result, { ok: false, code: "create_outcome_unknown" });
  assert.equal(appends, 1);
  assert.equal(reads, 2);
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
