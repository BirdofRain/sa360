import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafePortalReturnTo,
  parseSafePortalReturnTo,
  SAFE_PORTAL_RETURN_TO_DEFAULT,
} from "./safe-portal-return-to.js";

test("N. parseSafePortalReturnTo allows internal relative portal paths", () => {
  assert.equal(parseSafePortalReturnTo("/portal/account"), "/portal/account");
  assert.equal(parseSafePortalReturnTo("/portal/orders"), "/portal/orders");
  assert.equal(
    parseSafePortalReturnTo("/portal/account?google_oauth=connected"),
    "/portal/account?google_oauth=connected"
  );
  assert.equal(parseSafePortalReturnTo("/portal"), "/portal");
  assert.equal(parseSafePortalReturnTo(null), SAFE_PORTAL_RETURN_TO_DEFAULT);
  assert.equal(parseSafePortalReturnTo("  "), SAFE_PORTAL_RETURN_TO_DEFAULT);
  assert.equal(parseSafePortalReturnTo("  /portal/account  "), "/portal/account");
});

test("N. parseSafePortalReturnTo rejects malicious returnTo values", () => {
  assert.equal(parseSafePortalReturnTo("https://evil.example"), null);
  assert.equal(parseSafePortalReturnTo("http://evil.example"), null);
  assert.equal(parseSafePortalReturnTo("//evil.example"), null);
  assert.equal(parseSafePortalReturnTo("javascript:alert(1)"), null);
  assert.equal(parseSafePortalReturnTo("data:text/html,hi"), null);
  assert.equal(parseSafePortalReturnTo("vbscript:msgbox(1)"), null);
  assert.equal(parseSafePortalReturnTo("/admin"), null);
  assert.equal(parseSafePortalReturnTo("/portal\\login"), null);
  assert.equal(parseSafePortalReturnTo("/\\evil"), null);
  assert.equal(parseSafePortalReturnTo("https://evil.example/portal/account"), null);
  assert.equal(parseSafePortalReturnTo("/ghl-connections"), null);
  assert.equal(parseSafePortalReturnTo("/portal2"), null);
  assert.equal(parseSafePortalReturnTo("/portal/../admin"), null);
  assert.equal(parseSafePortalReturnTo("/portal/foo/../../admin"), null);
  assert.equal(parseSafePortalReturnTo("/portal/%2e%2e/admin"), null);
  assert.equal(parseSafePortalReturnTo("/portal/..%2fadmin"), null);
  assert.equal(parseSafePortalReturnTo("/portal/%2e%2e%2fadmin"), null);
  assert.equal(parseSafePortalReturnTo("/portal/%2f%2fevil.example"), null);
  assert.equal(parseSafePortalReturnTo("/portal/%5cadmin"), null);
  assert.equal(parseSafePortalReturnTo("/portal/account%00"), null);
  assert.equal(parseSafePortalReturnTo("/portal//evil"), null);
  assert.equal(parseSafePortalReturnTo("/portal/account?next=https://evil"), null);
  assert.equal(parseSafePortalReturnTo("/portal/account?x=%2f%2fevil"), null);
  assert.equal(parseSafePortalReturnTo("/portal/\naccount"), null);
  assert.equal(parseSafePortalReturnTo("/portal/\taccount"), null);
});

test("assertSafePortalReturnTo throws on open redirects", () => {
  assert.equal(assertSafePortalReturnTo("/portal/leads"), "/portal/leads");
  assert.throws(() => assertSafePortalReturnTo("https://evil.example"), /internal relative \/portal path/);
  assert.throws(() => assertSafePortalReturnTo("/portal/../admin"), /internal relative \/portal path/);
});
