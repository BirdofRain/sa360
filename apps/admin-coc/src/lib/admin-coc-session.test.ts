import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_COC_LEGACY_SESSION_MARKER,
  ADMIN_COC_SESSION_SECRET_MIN_LENGTH,
  isAdminCocPasswordConfigured,
  isAdminCocSessionIssuanceReady,
  isAdminCocSessionMisconfigured,
  isAdminCocSessionSecretConfigured,
} from "./admin-coc-auth.ts";
import {
  ADMIN_COC_SESSION_COOKIE,
  ADMIN_COC_SESSION_MAX_AGE_SECONDS,
  ADMIN_COC_SESSION_TYP,
  ADMIN_COC_SESSION_VERSION,
  adminCocSessionCookieClearOptions,
  adminCocSessionCookieOptions,
  createAdminCocSessionToken,
  isAdminCocSessionAuthorized,
  parseAdminCocSessionToken,
  verifyAdminCocSessionToken,
} from "./admin-coc-session.ts";
import { verifyAdminCocSessionTokenEdge } from "./admin-coc-session-edge.ts";
import { createPortalSessionToken } from "./client-portal/portal-session.ts";

const ADMIN_SECRET = "admin-coc-session-secret-32b";
const OTHER_SECRET = "rotated-admin-session-secret-32";
const PORTAL_SECRET = "client-portal-session-secret-32";

const ENV_KEYS = [
  "ADMIN_COC_PASSWORD",
  "ADMIN_COC_SESSION_SECRET",
  "CLIENT_PORTAL_SESSION_SECRET",
  "NODE_ENV",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const snap: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else process.env[key] = snap[key];
  }
}

function gateOn(secret = ADMIN_SECRET): void {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = secret;
}

test("ADMIN_COC_SESSION_SECRET is independent of the portal secret", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));

  process.env.ADMIN_COC_PASSWORD = "pw";
  process.env.CLIENT_PORTAL_SESSION_SECRET = PORTAL_SECRET;
  delete process.env.ADMIN_COC_SESSION_SECRET;
  assert.equal(isAdminCocSessionSecretConfigured(), false);
  assert.equal(isAdminCocSessionIssuanceReady(), false);
  assert.equal(isAdminCocSessionMisconfigured(), true);
});

test("short or empty session secrets are invalid", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));

  process.env.ADMIN_COC_PASSWORD = "pw";
  process.env.ADMIN_COC_SESSION_SECRET = "short";
  assert.equal(isAdminCocSessionSecretConfigured(), false);
  assert.ok(ADMIN_COC_SESSION_SECRET_MIN_LENGTH >= 16);

  process.env.ADMIN_COC_SESSION_SECRET = "   ";
  assert.equal(isAdminCocSessionSecretConfigured(), false);
});

test("signed session round-trips through Node and Edge verifiers", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  gateOn();

  const token = createAdminCocSessionToken();
  assert.ok(token);
  assert.equal(token.startsWith(`${ADMIN_COC_SESSION_VERSION}.`), true);
  const parsed = parseAdminCocSessionToken(token);
  assert.ok(parsed);
  assert.equal(parsed.typ, ADMIN_COC_SESSION_TYP);
  assert.equal(verifyAdminCocSessionToken(token), true);
  assert.equal(await verifyAdminCocSessionTokenEdge(token), true);
  assert.equal(isAdminCocSessionAuthorized(token), true);
});

test("rejects the forged literal ok marker", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  gateOn();

  assert.equal(ADMIN_COC_LEGACY_SESSION_MARKER, "ok");
  assert.equal(verifyAdminCocSessionToken("ok"), false);
  assert.equal(await verifyAdminCocSessionTokenEdge("ok"), false);
  assert.equal(isAdminCocSessionAuthorized("ok"), false);
  assert.equal(isAdminCocSessionAuthorized(undefined), false);
});

test("rejects malformed, tampered, and portal tokens", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  gateOn();
  process.env.CLIENT_PORTAL_SESSION_SECRET = PORTAL_SECRET;

  const token = createAdminCocSessionToken();
  assert.ok(token);
  const parts = token.split(".");
  const tamperedSig = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -2)}aa`;
  const tamperedBody = `${parts[0]}.${parts[1]!.slice(0, -2)}aa.${parts[2]}`;

  assert.equal(verifyAdminCocSessionToken("ac1.not-json.sig"), false);
  assert.equal(verifyAdminCocSessionToken("v2.body.sig"), false);
  assert.equal(verifyAdminCocSessionToken("ac1.onlytwo"), false);
  assert.equal(verifyAdminCocSessionToken(tamperedSig), false);
  assert.equal(verifyAdminCocSessionToken(tamperedBody), false);
  assert.equal(await verifyAdminCocSessionTokenEdge(tamperedSig), false);
  assert.equal(await verifyAdminCocSessionTokenEdge(tamperedBody), false);

  const portal = createPortalSessionToken({
    clientAccountId: "acct_test",
    clientDisplayName: "Test",
    portalDisplayName: null,
    portalLoginEmail: "c@example.com",
  });
  assert.ok(portal);
  assert.equal(verifyAdminCocSessionToken(portal), false);
  assert.equal(await verifyAdminCocSessionTokenEdge(portal), false);
});

test("rejects expired tokens", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  gateOn();

  const now = Math.floor(Date.now() / 1000);
  const token = createAdminCocSessionToken(now - ADMIN_COC_SESSION_MAX_AGE_SECONDS - 5);
  assert.ok(token);
  assert.equal(verifyAdminCocSessionToken(token, now), false);
  assert.equal(await verifyAdminCocSessionTokenEdge(token, now), false);
});

test("missing secret cannot issue or verify sessions", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.ADMIN_COC_PASSWORD = "pw";
  delete process.env.ADMIN_COC_SESSION_SECRET;

  assert.equal(createAdminCocSessionToken(), null);
  assert.equal(verifyAdminCocSessionToken("ac1.body.sig"), false);
  assert.equal(await verifyAdminCocSessionTokenEdge("ok"), false);
  assert.equal(isAdminCocSessionAuthorized("ok"), false);
  assert.equal(isAdminCocSessionMisconfigured(), true);
});

test("wrong secret and secret rotation invalidate existing sessions", async (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  gateOn(ADMIN_SECRET);
  const token = createAdminCocSessionToken();
  assert.ok(token);
  assert.equal(verifyAdminCocSessionToken(token, undefined, OTHER_SECRET), false);

  process.env.ADMIN_COC_SESSION_SECRET = OTHER_SECRET;
  assert.equal(verifyAdminCocSessionToken(token), false);
  assert.equal(await verifyAdminCocSessionTokenEdge(token), false);
  const rotated = createAdminCocSessionToken();
  assert.ok(rotated);
  assert.equal(verifyAdminCocSessionToken(token, undefined, ADMIN_SECRET), true);
  assert.equal(verifyAdminCocSessionToken(rotated), true);
});

test("production with password and missing secret fails closed", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.NODE_ENV = "production";
  process.env.ADMIN_COC_PASSWORD = "prod-password";
  delete process.env.ADMIN_COC_SESSION_SECRET;

  assert.equal(isAdminCocPasswordConfigured(), true);
  assert.equal(isAdminCocSessionIssuanceReady(), false);
  assert.equal(isAdminCocSessionMisconfigured(), true);
  assert.equal(isAdminCocSessionAuthorized("ok"), false);
  assert.equal(isAdminCocSessionAuthorized(undefined), false);
  assert.equal(createAdminCocSessionToken(), null);
});

test("local development without ADMIN_COC_PASSWORD remains fail-open", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  delete process.env.ADMIN_COC_PASSWORD;
  delete process.env.ADMIN_COC_SESSION_SECRET;

  assert.equal(isAdminCocPasswordConfigured(), false);
  assert.equal(isAdminCocSessionAuthorized(undefined), true);
  assert.equal(isAdminCocSessionAuthorized("ok"), true);
  assert.equal(isAdminCocSessionMisconfigured(), false);
});

test("logout cookie options clear the httpOnly session cookie", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  process.env.NODE_ENV = "production";
  const issued = adminCocSessionCookieOptions("ac1.body.sig");
  assert.equal(issued.name, ADMIN_COC_SESSION_COOKIE);
  assert.equal(issued.httpOnly, true);
  assert.equal(issued.sameSite, "lax");
  assert.equal(issued.secure, true);
  assert.equal(issued.path, "/");
  assert.equal(issued.maxAge, ADMIN_COC_SESSION_MAX_AGE_SECONDS);

  const cleared = adminCocSessionCookieClearOptions();
  assert.equal(cleared.name, ADMIN_COC_SESSION_COOKIE);
  assert.equal(cleared.value, "");
  assert.equal(cleared.maxAge, 0);
  assert.equal(cleared.httpOnly, true);
  assert.equal(cleared.sameSite, "lax");
  assert.equal(cleared.path, "/");
});

test("handler authorization ignores request pathname (login Server Action bypass)", (t) => {
  const snap = snapshotEnv();
  t.after(() => restoreEnv(snap));
  gateOn();

  const token = createAdminCocSessionToken();
  assert.ok(token);
  // Pathname is not an argument — posting through /login cannot skip this check.
  assert.equal(isAdminCocSessionAuthorized("ok"), false);
  assert.equal(isAdminCocSessionAuthorized(token), true);
});
