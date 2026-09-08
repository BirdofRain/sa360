import assert from "node:assert/strict";
import test from "node:test";

import {
  isPublicRegisterOriginAllowed,
  parsePublicRegisterAllowedHosts,
  requestHostFromRegisterHeaders,
} from "./public-register-origin.js";

test("allow-list does not invent a production domain", () => {
  assert.deepEqual(parsePublicRegisterAllowedHosts({}), []);
  assert.equal(
    isPublicRegisterOriginAllowed({ origin: "https://agedvetleads.com", env: {} }),
    false
  );
  assert.equal(
    isPublicRegisterOriginAllowed({ origin: "http://localhost:3000", env: {} }),
    true
  );
  assert.equal(
    isPublicRegisterOriginAllowed({ forwardedHost: "127.0.0.1:3000", env: {} }),
    true
  );
});

test("matches configured marketing and portal origins without hardcoding them", () => {
  const env = {
    SA360_PUBLIC_MARKETING_HOSTS: "preview.example,www.preview.example",
    ADMIN_COC_BASE_URL: "https://coc.example:443",
  };
  assert.deepEqual(parsePublicRegisterAllowedHosts(env), [
    "preview.example",
    "www.preview.example",
    "coc.example",
  ]);
  assert.equal(
    isPublicRegisterOriginAllowed({ origin: "https://preview.example", env }),
    true
  );
  assert.equal(
    isPublicRegisterOriginAllowed({ host: "evil.example", env }),
    false
  );
});

test("prefers Origin over forwarded host", () => {
  assert.equal(
    requestHostFromRegisterHeaders({
      origin: "https://preview.example",
      forwardedHost: "ignored.example",
    }),
    "preview.example"
  );
});
