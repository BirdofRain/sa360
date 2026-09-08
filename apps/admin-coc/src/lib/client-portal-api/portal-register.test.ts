import assert from "node:assert/strict";
import test from "node:test";

import { PORTAL_REGISTER_GENERIC_ERROR } from "../client-portal/portal-register.ts";
import { postPortalRegister, registerForwardHeadersFromRequest } from "./portal-register.ts";

test("postPortalRegister sends only agency, email, password and forwards origin host", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_API_KEY = "portal-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://portal-api.test";

  let capturedBody = "";
  let capturedHeaders: Headers | undefined;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    capturedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        ok: true,
        portalSessionEpoch: 0,
        status: "onboarding",
        context: {
          clientAccountId: "avl01010101010101010101",
          clientDisplayName: "Hebda",
          portalDisplayName: "Hebda",
          portalLoginEmail: "agent@example.com",
          portalEnabled: true,
          locationName: null,
          subaccountIdGhl: null,
          primaryNicheKeys: ["vet"],
          primaryProductTypes: [],
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;

  const result = await postPortalRegister(
    { agencyName: "Hebda", email: "Agent@Example.com", password: "secure-pass-word" },
    {
      origin: "http://localhost:3000",
      forwardedHost: "localhost:3000",
      forwardedFor: "127.0.0.1",
    }
  );
  assert.equal(result.ok, true);
  const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed).sort(), ["agencyName", "email", "password"]);
  assert.equal("clientAccountId" in parsed, false);
  assert.equal("status" in parsed, false);
  assert.equal(capturedHeaders?.get("origin"), "http://localhost:3000");
  assert.equal(capturedHeaders?.get("x-forwarded-host"), "localhost:3000");
  if (result.ok) {
    assert.equal(result.data.context.clientAccountId, "avl01010101010101010101");
    assert.equal(result.data.status, "onboarding");
  }

  globalThis.fetch = originalFetch;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});

test("postPortalRegister maps duplicate failures to generic copy", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_API_KEY = "portal-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://portal-api.test";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: PORTAL_REGISTER_GENERIC_ERROR,
        code: "FAILED",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  const result = await postPortalRegister({
    agencyName: "Hebda",
    email: "agent@example.com",
    password: "secure-pass-word",
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, PORTAL_REGISTER_GENERIC_ERROR);
    assert.equal(result.error.toLowerCase().includes("email"), false);
    assert.equal(result.status, 400);
  }

  globalThis.fetch = originalFetch;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});

test("registerForwardHeadersFromRequest prefers Origin and public host, not API host", () => {
  const headers = new Headers({
    origin: "https://preview.example",
    host: "localhost:3000",
    "x-forwarded-host": "preview.example",
    "x-forwarded-for": "203.0.113.9",
  });
  const forwarded = registerForwardHeadersFromRequest(headers);
  assert.equal(forwarded.origin, "https://preview.example");
  assert.equal(forwarded.forwardedHost, "preview.example");
  assert.equal(forwarded.forwardedFor, "203.0.113.9");
});
