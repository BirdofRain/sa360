import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicMarketingHost,
  normalizeRequestHost,
  parsePublicMarketingHosts,
  PUBLIC_MARKETING_HOSTS_ENV,
  shouldRewriteRootToPublicLanding,
} from "./marketing-hosts.ts";

test("env key is documented and has no default public domain", () => {
  assert.equal(PUBLIC_MARKETING_HOSTS_ENV, "SA360_PUBLIC_MARKETING_HOSTS");
  assert.deepEqual(parsePublicMarketingHosts(undefined), []);
  assert.deepEqual(parsePublicMarketingHosts(""), []);
  assert.deepEqual(parsePublicMarketingHosts("  "), []);
});

test("parses comma-separated hosts without inventing a production domain", () => {
  assert.deepEqual(parsePublicMarketingHosts("Preview.Example:443, www.preview.example"), [
    "preview.example",
    "www.preview.example",
  ]);
});

test("unset hosts never match, including localhost", () => {
  assert.equal(isPublicMarketingHost("localhost", undefined), false);
  assert.equal(isPublicMarketingHost("localhost", ""), false);
  assert.equal(isPublicMarketingHost("agedvetleads.com", undefined), false);
});

test("matches configured host from forwarded-host, ignoring port", () => {
  const env = "preview.example,www.preview.example";
  const host = normalizeRequestHost("Preview.Example:8443", "ignored.example");
  assert.equal(host, "preview.example");
  assert.equal(isPublicMarketingHost(host, env), true);
  assert.equal(isPublicMarketingHost("other.example", env), false);
});

test("rewrites only `/` when the host is in the allow-list", () => {
  const env = "preview.example";
  assert.equal(
    shouldRewriteRootToPublicLanding({
      pathname: "/",
      forwardedHost: "preview.example",
      envRaw: env,
    }),
    true
  );
  assert.equal(
    shouldRewriteRootToPublicLanding({
      pathname: "/get-started",
      forwardedHost: "preview.example",
      envRaw: env,
    }),
    false
  );
  assert.equal(
    shouldRewriteRootToPublicLanding({
      pathname: "/",
      host: "admin.example",
      envRaw: env,
    }),
    false
  );
  assert.equal(
    shouldRewriteRootToPublicLanding({
      pathname: "/",
      host: "preview.example",
      envRaw: "",
    }),
    false
  );
});
