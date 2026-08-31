import test from "node:test";
import assert from "node:assert/strict";
import { buildAbsoluteOrRelativePortalUrl, resolvePortalPublicBaseUrl } from "./portal-public-url.js";

test("resolvePortalPublicBaseUrl uses existing env keys and does not invent a host", () => {
  const empty = resolvePortalPublicBaseUrl({});
  assert.equal(empty, null);

  const fromPortal = resolvePortalPublicBaseUrl({
    SA360_PORTAL_PUBLIC_BASE_URL: "https://portal.test.example/",
    ADMIN_COC_BASE_URL: "https://admin.test.example",
  });
  assert.equal(fromPortal, "https://portal.test.example");

  const fromAdmin = resolvePortalPublicBaseUrl({
    ADMIN_COC_BASE_URL: "https://admin.test.example/",
  });
  assert.equal(fromAdmin, "https://admin.test.example");
});

test("buildAbsoluteOrRelativePortalUrl stays relative when no public base is configured", () => {
  const prevP = process.env.SA360_PORTAL_PUBLIC_BASE_URL;
  const prevA = process.env.ADMIN_COC_BASE_URL;
  delete process.env.SA360_PORTAL_PUBLIC_BASE_URL;
  delete process.env.ADMIN_COC_BASE_URL;
  assert.equal(buildAbsoluteOrRelativePortalUrl("/portal/invite/abc"), "/portal/invite/abc");
  if (prevP !== undefined) process.env.SA360_PORTAL_PUBLIC_BASE_URL = prevP;
  if (prevA !== undefined) process.env.ADMIN_COC_BASE_URL = prevA;
});
