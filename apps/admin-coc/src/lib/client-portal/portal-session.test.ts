import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  createLegacyPortalSessionToken,
  createPortalSessionToken,
  parsePortalSessionToken,
  portalSessionCookieOptions,
  verifyPortalSessionToken,
} from "./portal-session.ts";
import { verifyPortalSessionTokenEdge } from "./portal-session-edge.ts";

const SESSION_INPUT = {
  clientAccountId: "acct_test",
  clientDisplayName: "Test Client",
  portalDisplayName: "Test Portal",
  portalLoginEmail: "client@example.com",
};

test("edge verifier accepts v2 tokens signed on the server", async () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "test-session-secret-32chars-min";
  const token = createPortalSessionToken(SESSION_INPUT);
  assert.ok(token);
  assert.equal(await verifyPortalSessionTokenEdge(token), true);
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("v2 signed session round-trip with tenant payload", () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "test-session-secret-32chars-min";
  const token = createPortalSessionToken(SESSION_INPUT);
  assert.ok(token);
  const parsed = parsePortalSessionToken(token);
  assert.ok(parsed);
  assert.equal(parsed.clientAccountId, "acct_test");
  assert.equal(parsed.portalLoginEmail, "client@example.com");
  assert.equal(verifyPortalSessionToken(token), true);
  assert.equal(verifyPortalSessionToken("tampered.v2.body.sig"), false);
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("legacy v1 session maps to env client account id", () => {
  const prevS = process.env.CLIENT_PORTAL_SESSION_SECRET;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "test-session-secret-32chars-min";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_legacy";
  const token = createLegacyPortalSessionToken();
  assert.ok(token);
  const parsed = parsePortalSessionToken(token);
  assert.ok(parsed);
  assert.equal(parsed.clientAccountId, "acct_legacy");
  if (prevS !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prevS;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("portal session cookie uses httpOnly sa360_client_portal_session name", () => {
  const opts = portalSessionCookieOptions("v2.body.sig");
  assert.equal(opts.name, CLIENT_PORTAL_SESSION_COOKIE);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
});

test("expired session token is rejected", () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "test-session-secret-32chars-min";
  const now = Math.floor(Date.now() / 1000);
  const token = createPortalSessionToken(SESSION_INPUT, now - 60 * 60 * 24 * 31);
  assert.equal(verifyPortalSessionToken(token), false);
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});
