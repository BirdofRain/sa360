import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_SHEETS_API_ORIGIN,
  GOOGLE_SHEETS_DEFAULT_SPREADSHEET_TITLE,
  GOOGLE_SHEETS_DEFAULT_WORKSHEET_TITLE,
  GOOGLE_SHEETS_SPREADSHEETS_URL,
} from "../../lib/google-sheets-env.js";
import {
  createSpreadsheet,
  getSpreadsheetMetadata,
} from "./google-sheets-http-client.js";

const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const ACCESS = "ya29.sheets-access";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const metadataBody = {
  spreadsheetId: ID,
  properties: { title: "Customer Sheet" },
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit`,
  sheets: [
    { properties: { sheetId: 0, title: "Leads", index: 0, hidden: false, sheetType: "GRID" } },
    { properties: { sheetId: 1, title: "Notes", index: 1, hidden: false, sheetType: "GRID" } },
  ],
};

test("Q/X/AB. metadata GET uses sheets.googleapis.com only", async () => {
  let url = "";
  const result = await getSpreadsheetMetadata(
    { spreadsheetId: ID, accessToken: ACCESS },
    async (input, init) => {
      url = String(input);
      assert.equal(init?.method, "GET");
      assert.equal((init?.headers as Record<string, string>).Authorization, `Bearer ${ACCESS}`);
      assert.equal(url.startsWith(GOOGLE_SHEETS_SPREADSHEETS_URL), true);
      assert.equal(url.includes("drive.googleapis.com"), false);
      assert.equal(GOOGLE_SHEETS_API_ORIGIN, "https://sheets.googleapis.com");
      return jsonResponse(metadataBody);
    }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.metadata.spreadsheetId, ID);
    assert.equal(result.metadata.title, "Customer Sheet");
    assert.equal(result.metadata.worksheets.length, 2);
    assert.equal(JSON.stringify(result.metadata).includes(ACCESS), false);
  }
});

test("S-W. metadata classifies 403, 404, 429, 5xx, and timeout", async () => {
  const cases: Array<[typeof fetch, string]> = [
    [async () => jsonResponse({ error: { status: "PERMISSION_DENIED" } }, 403), "access_denied"],
    [async () => jsonResponse({ error: { status: "NOT_FOUND" } }, 404), "not_found"],
    [async () => jsonResponse({ error: { status: "RESOURCE_EXHAUSTED" } }, 429), "rate_limited"],
    [async () => jsonResponse({ error: { status: "UNAVAILABLE" } }, 503), "server_error"],
    [async () => { throw new Error("timeout"); }, "network_error"],
  ];
  for (const [fetchImpl, expected] of cases) {
    const result = await getSpreadsheetMetadata(
      { spreadsheetId: ID, accessToken: ACCESS },
      fetchImpl
    );
    assert.deepEqual(result, { ok: false, reason: expected });
  }
});

test("X/Y/Z/AA. create posts once to Sheets with Leads tab and no lead rows", async () => {
  let calls = 0;
  const result = await createSpreadsheet(
    {
      title: GOOGLE_SHEETS_DEFAULT_SPREADSHEET_TITLE,
      worksheetTitle: GOOGLE_SHEETS_DEFAULT_WORKSHEET_TITLE,
      accessToken: ACCESS,
    },
    async (input, init) => {
      calls += 1;
      assert.equal(String(input), GOOGLE_SHEETS_SPREADSHEETS_URL);
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(body, {
        properties: { title: "SA360 Leads" },
        sheets: [{ properties: { title: "Leads" } }],
      });
      assert.equal(JSON.stringify(body).includes("values"), false);
      assert.equal(JSON.stringify(body).toLowerCase().includes("lead row"), false);
      assert.equal(String(input).includes("drive.googleapis.com"), false);
      return jsonResponse({
        spreadsheetId: ID,
        properties: { title: "SA360 Leads" },
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}`,
        sheets: [
          { properties: { sheetId: 42, title: "Leads", index: 0, hidden: false, sheetType: "GRID" } },
        ],
      });
    }
  );
  assert.equal(calls, 1);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.metadata.worksheets[0]?.title, "Leads");
    assert.equal(result.metadata.worksheets[0]?.sheetId, 42);
  }
});

test("Z. create does not retry after unknown/network outcome", async () => {
  let calls = 0;
  const result = await createSpreadsheet(
    { title: "SA360 Leads", worksheetTitle: "Leads", accessToken: ACCESS },
    async () => {
      calls += 1;
      throw new Error("socket hang up");
    }
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, reason: "network_error" });
});
