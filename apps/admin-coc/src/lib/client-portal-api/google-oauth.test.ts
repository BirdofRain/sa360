import assert from "node:assert/strict";
import test from "node:test";

import {
  CLIENT_PORTAL_ASSERTION_HEADER,
  verifyClientPortalAssertion,
} from "@sa360/shared/client-portal-assertion";

import {
  disconnectGoogleFromPortal,
  getGoogleStatusFromPortal,
  startGoogleOAuthFromPortal,
} from "./google-oauth.ts";

const session = {
  clientAccountId: "session-tenant",
  clientDisplayName: "Tenant",
  portalDisplayName: null,
  portalLoginEmail: "user@example.com",
  portalSessionEpoch: 9,
  iat: 1,
  exp: 9_999_999_999,
};

test("portal Google BFF signs session-derived tenant and never puts tenant in URL", async () => {
  const previousBase = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  const previousKey = process.env.CLIENT_PORTAL_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.test";
  process.env.CLIENT_PORTAL_API_KEY = "server-only-api-key";
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), init });
    if (String(input).endsWith("/oauth/start?returnTo=%2Fportal%2Faccount")) {
      return new Response(null, {
        status: 302,
        headers: { location: "https://accounts.google.test/authorize" },
      });
    }
    return new Response(JSON.stringify({ ok: true, connection: { connected: false } }), {
      status: 200,
    });
  }) as typeof fetch;
  try {
    assert.equal((await startGoogleOAuthFromPortal(session, "/portal/account")).ok, true);
    assert.equal((await getGoogleStatusFromPortal(session)).ok, true);
    assert.equal((await disconnectGoogleFromPortal(session)).ok, true);
    assert.equal(requests.length, 3);
    for (const request of requests) {
      assert.equal(request.url.includes("clientAccountId"), false);
      const headers = request.init?.headers as Record<string, string>;
      const assertion = verifyClientPortalAssertion(
        headers[CLIENT_PORTAL_ASSERTION_HEADER],
        "server-only-api-key"
      );
      assert.equal(assertion?.clientAccountId, "session-tenant");
      assert.equal(assertion?.portalSessionEpoch, 9);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousBase === undefined) delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
    else process.env.NEXT_PUBLIC_SA360_API_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = previousKey;
  }
});
