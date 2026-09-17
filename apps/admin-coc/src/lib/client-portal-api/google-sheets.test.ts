import assert from "node:assert/strict";
import test from "node:test";

import { clientAccountIdRejectedResponse } from "./google-sheets-bff.ts";
import { buildGooglePortalApiRequestConfig } from "./google-oauth-request.ts";

const session = {
  clientAccountId: "session-tenant",
  clientDisplayName: "Tenant",
  portalDisplayName: null,
  portalLoginEmail: "user@example.com",
  portalSessionEpoch: 9,
  iat: 1,
  exp: 9_999_999_999,
};

test("Sheets BFF rejects browser-supplied clientAccountId", async () => {
  const fromQuery = clientAccountIdRejectedResponse(
    new URL("https://portal.test/api/client-portal/google/sheets/destination?clientAccountId=other").searchParams
  );
  assert.ok(fromQuery);
  assert.equal(fromQuery.status, 400);

  const fromBody = clientAccountIdRejectedResponse({ spreadsheet: "abc", clientAccountId: "other" });
  assert.ok(fromBody);
  assert.equal(fromBody.status, 400);

  assert.equal(clientAccountIdRejectedResponse({ spreadsheet: "abc" }), null);
});

test("Sheets BFF reuses the Google portal assertion builder and omits login email", () => {
  const request = buildGooglePortalApiRequestConfig({
    baseUrl: "https://api.test/",
    apiKey: "server-only-api-key",
    session,
  });
  assert.equal(request.baseUrl, "https://api.test");
  assert.equal(JSON.stringify(request).includes("portalLoginEmail"), false);
  assert.equal(JSON.stringify(request).includes("clientAccountId=other"), false);
});
