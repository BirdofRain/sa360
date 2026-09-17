import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_SHEETS_API_ORIGIN,
  buildSafeSpreadsheetUrl,
  isGoogleSheetsDestinationEnabled,
  isSafeGoogleSpreadsheetUrl,
} from "./google-sheets-env.js";

test("A. Sheets destination flag defaults off and only case-insensitive true enables it", () => {
  assert.equal(isGoogleSheetsDestinationEnabled({}), false);
  assert.equal(isGoogleSheetsDestinationEnabled({ SA360_GOOGLE_SHEETS_DESTINATION_ENABLED: "false" }), false);
  assert.equal(isGoogleSheetsDestinationEnabled({ SA360_GOOGLE_SHEETS_DESTINATION_ENABLED: "1" }), false);
  assert.equal(isGoogleSheetsDestinationEnabled({ SA360_GOOGLE_SHEETS_DESTINATION_ENABLED: "yes" }), false);
  assert.equal(
    isGoogleSheetsDestinationEnabled({ SA360_GOOGLE_SHEETS_DESTINATION_ENABLED: " TRUE " }),
    true
  );
});

test("Sheets destination flag is independent of the Google OAuth flag", () => {
  assert.equal(
    isGoogleSheetsDestinationEnabled({
      SA360_GOOGLE_OAUTH_ENABLED: "true",
      SA360_GOOGLE_SHEETS_DESTINATION_ENABLED: "false",
    }),
    false
  );
});

test("safe spreadsheet URLs are constructed only on docs.google.com", () => {
  const id = "1abcdefghijklmnopqrstuvwxyzABCDEFG-123";
  const url = buildSafeSpreadsheetUrl(id);
  assert.equal(url, `https://docs.google.com/spreadsheets/d/${id}`);
  assert.equal(isSafeGoogleSpreadsheetUrl(url, id), true);
  assert.equal(isSafeGoogleSpreadsheetUrl(`https://docs.google.com/spreadsheets/d/${id}/edit`, id), true);
  assert.equal(isSafeGoogleSpreadsheetUrl("https://drive.google.com/file/d/abc/view", id), false);
  assert.equal(GOOGLE_SHEETS_API_ORIGIN, "https://sheets.googleapis.com");
});
