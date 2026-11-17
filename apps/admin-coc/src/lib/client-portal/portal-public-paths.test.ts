import test from "node:test";
import assert from "node:assert/strict";
import { isSmsOptInPrivacyPath, isUnauthenticatedPortalPath, smsOptInPrivacyHeaders } from "./portal-public-paths.ts";

test("login, forgot-password, and invite paths are reachable without a session", () => {
  assert.equal(isUnauthenticatedPortalPath("/portal/login"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/login/"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/forgot-password"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/forgot-password/"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/invite"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/invite/abcTokenValue"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/sms-opt-in/abcTokenValue"), true);
  assert.equal(isSmsOptInPrivacyPath("/portal/sms-opt-in/abcTokenValue"), true);
  assert.equal(isSmsOptInPrivacyPath("/portal/sms-notifications"), false);
  assert.equal(smsOptInPrivacyHeaders()["Referrer-Policy"], "no-referrer");
  assert.match(smsOptInPrivacyHeaders()["Cache-Control"], /no-store/);
  assert.equal(isUnauthenticatedPortalPath("/portal/sms-notifications"), false);
  assert.equal(isUnauthenticatedPortalPath("/portal"), false);
  assert.equal(isUnauthenticatedPortalPath("/portal/orders"), false);
  assert.equal(isUnauthenticatedPortalPath("/api/client-portal/dashboard"), false);
});
