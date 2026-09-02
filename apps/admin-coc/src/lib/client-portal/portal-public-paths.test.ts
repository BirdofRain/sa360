import test from "node:test";
import assert from "node:assert/strict";
import { isUnauthenticatedPortalPath } from "./portal-public-paths.ts";

test("login, forgot-password, and invite paths are reachable without a session", () => {
  assert.equal(isUnauthenticatedPortalPath("/portal/login"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/login/"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/forgot-password"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/forgot-password/"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/invite"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal/invite/abcTokenValue"), true);
  assert.equal(isUnauthenticatedPortalPath("/portal"), false);
  assert.equal(isUnauthenticatedPortalPath("/portal/orders"), false);
  assert.equal(isUnauthenticatedPortalPath("/api/client-portal/dashboard"), false);
});
