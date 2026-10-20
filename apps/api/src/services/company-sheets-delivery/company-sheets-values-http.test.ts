import assert from "node:assert/strict";
import test from "node:test";

import {
  appendSheetValues,
  getSheetValues,
  quoteSheetTitle,
  updateSheetValues,
} from "./company-sheets-values-http.js";

test("quoteSheetTitle escapes single quotes", () => {
  assert.equal(quoteSheetTitle("Leads"), "'Leads'");
  assert.equal(quoteSheetTitle("Ada's Leads"), "'Ada''s Leads'");
});

test("values client writes RAW and refuses formula interpretation", async () => {
  const calls: Array<{ url: string; method: string; body: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (url.includes("valueInputOption=USER_ENTERED")) {
      throw new Error("formula interpretation was requested");
    }
    if (init?.method === "GET") {
      return new Response("not-json", { status: 200 });
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };

  const updated = await updateSheetValues(
    { spreadsheetId: "sheet", range: "'Leads'!A1", values: [["=1+1"]], accessToken: "token" },
    fetchImpl
  );
  assert.equal(updated.ok, true);
  assert.match(calls[0]?.url ?? "", /valueInputOption=RAW/);
  assert.equal(calls[0]?.url.includes("USER_ENTERED"), false);
  assert.match(calls[0]?.body ?? "", /=1\+1/);

  const appended = await appendSheetValues(
    { spreadsheetId: "sheet", range: "'Leads'!A1", values: [["+SUM(A1)"]], accessToken: "token" },
    fetchImpl
  );
  assert.equal(appended.ok, true);
  assert.match(calls[1]?.url ?? "", /:append/);
  assert.match(calls[1]?.url ?? "", /valueInputOption=RAW/);
  assert.match(calls[1]?.url ?? "", /insertDataOption=INSERT_ROWS/);
  assert.equal(calls[1]?.url.includes("drive.googleapis.com"), false);

  const malformed = await getSheetValues(
    { spreadsheetId: "sheet", range: "'Leads'!A1:A2", accessToken: "token" },
    fetchImpl
  );
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.reason, "malformed_response");
});

test("values client classifies timeout and server errors as ambiguous outcomes", async () => {
  const thrown = await appendSheetValues(
    { spreadsheetId: "sheet", range: "A1", values: [["x"]], accessToken: "token" },
    async () => {
      throw new Error("timeout");
    }
  );
  assert.equal(thrown.ok, false);
  if (!thrown.ok) assert.equal(thrown.reason, "network_error");

  const server = await getSheetValues(
    { spreadsheetId: "sheet", range: "A1:A2", accessToken: "token" },
    async () => new Response("unavailable", { status: 503 })
  );
  assert.equal(server.ok, false);
  if (!server.ok) assert.equal(server.reason, "server_error");
});
