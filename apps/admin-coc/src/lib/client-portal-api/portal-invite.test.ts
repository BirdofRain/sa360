import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectPortalInviteToken,
  postPortalInviteAccept,
} from "./portal-context.ts";

test("postPortalInviteAccept never sends clientAccountId and does not echo secrets", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_API_KEY = "portal-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://portal-api.test";

  const rawToken = "a".repeat(43);
  const password = "new-customer-pass";
  let capturedBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const result = await postPortalInviteAccept(rawToken, password);
  assert.equal(result.ok, true);
  const parsed = JSON.parse(capturedBody) as Record<string, unknown>;
  assert.equal(parsed.token, rawToken);
  assert.equal(parsed.password, password);
  assert.equal("clientAccountId" in parsed, false);
  assert.equal(JSON.stringify(result).includes(rawToken), false);
  assert.equal(JSON.stringify(result).includes(password), false);

  globalThis.fetch = originalFetch;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});

test("inspectPortalInviteToken maps API failures to generic invalid without leaking the token", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  process.env.CLIENT_PORTAL_API_KEY = "portal-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "http://portal-api.test";
  const rawToken = "b".repeat(43);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: "This invite link is invalid or has expired. Request a new invite from your SA360 team.",
        code: "INVITE_INVALID",
      }),
      { status: 400, headers: { "content-type": "application/json" } }
    )) as typeof fetch;

  const result = await inspectPortalInviteToken(rawToken);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.includes(rawToken), false);
    assert.equal(result.error.toLowerCase().includes("acct_"), false);
  }

  globalThis.fetch = originalFetch;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
  else delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
});
