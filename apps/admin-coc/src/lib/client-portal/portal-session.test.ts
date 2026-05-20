import test from "node:test";
import assert from "node:assert/strict";
import {
  CLIENT_PORTAL_SESSION_COOKIE,
  createPortalSessionToken,
  portalSessionCookieOptions,
  verifyPortalSessionToken,
} from "./portal-session.ts";
import { verifyPortalSessionTokenEdge } from "./portal-session-edge.ts";

test("edge verifier accepts tokens signed on the server", async () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "test-session-secret-32chars-min";
  const token = createPortalSessionToken();
  assert.ok(token);
  assert.equal(await verifyPortalSessionTokenEdge(token), true);
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("signed session round-trip with secret", () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "test-session-secret-32chars-min";
  const token = createPortalSessionToken();
  assert.ok(token);
  assert.equal(verifyPortalSessionToken(token), true);
  assert.equal(verifyPortalSessionToken("tampered.v1.token"), false);
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});

test("portal session cookie uses httpOnly sa360_client_portal_session name", () => {
  const opts = portalSessionCookieOptions("v1.999.sig");
  assert.equal(opts.name, CLIENT_PORTAL_SESSION_COOKIE);
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, "lax");
});

test("expired session token is rejected", () => {
  const prev = process.env.CLIENT_PORTAL_SESSION_SECRET;
  process.env.CLIENT_PORTAL_SESSION_SECRET = "test-session-secret-32chars-min";
  const now = Math.floor(Date.now() / 1000);
  const token = createPortalSessionToken(now - 60 * 60 * 24 * 31);
  assert.equal(verifyPortalSessionToken(token), false);
  if (prev !== undefined) process.env.CLIENT_PORTAL_SESSION_SECRET = prev;
  else delete process.env.CLIENT_PORTAL_SESSION_SECRET;
});
