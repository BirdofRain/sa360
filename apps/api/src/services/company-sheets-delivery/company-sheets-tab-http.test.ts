import assert from "node:assert/strict";
import test from "node:test";

import { addSpreadsheetSheet } from "./company-sheets-tab-http.js";

test("addSpreadsheetSheet sends one addSheet request and does not treat a timeout as success", async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const created = await addSpreadsheetSheet(
    { spreadsheetId: "sheet-1", title: "Campaign Leads", accessToken: "token" },
    async (url, init) => {
      calls.push({ url: String(url), body: String(init?.body ?? "") });
      return new Response(
        JSON.stringify({
          replies: [{ addSheet: { properties: { sheetId: 9, title: "Campaign Leads", sheetType: "GRID" } } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
  );
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal(created.sheet.worksheetId, 9);
  assert.equal(calls.length, 1);
  assert.match(calls[0]?.url ?? "", /spreadsheets\/sheet-1:batchUpdate$/);
  assert.equal(calls[0]?.body.includes("Campaign Leads"), true);
  assert.equal(calls[0]?.body.includes("USER_ENTERED"), false);
  assert.equal(calls[0]?.body.includes("addSheet"), true);

  const timedOut = await addSpreadsheetSheet(
    { spreadsheetId: "sheet-1", title: "Campaign Leads", accessToken: "token" },
    async () => {
      throw new Error("timeout");
    }
  );
  assert.equal(timedOut.ok, false);
  if (timedOut.ok) return;
  assert.equal(timedOut.reason, "network_error");
});
