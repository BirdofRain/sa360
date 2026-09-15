import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_PORTAL_ASSERTION_HEADER,
  verifyClientPortalAssertion,
} from "@sa360/shared/client-portal-assertion";

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

test("portal Google BFF signs the session-derived tenant in a server-only assertion", () => {
  const request = buildGooglePortalApiRequestConfig({
    baseUrl: "https://api.test/",
    apiKey: "server-only-api-key",
    session,
  });
  assert.equal(request.baseUrl, "https://api.test");
  const assertion = verifyClientPortalAssertion(
    request.headers[CLIENT_PORTAL_ASSERTION_HEADER],
    "server-only-api-key"
  );
  assert.equal(assertion?.clientAccountId, "session-tenant");
  assert.equal(assertion?.portalSessionEpoch, 9);
  assert.equal(JSON.stringify(request).includes("portalLoginEmail"), false);
});
