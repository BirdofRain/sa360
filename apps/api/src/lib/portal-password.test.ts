import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPortalPassword,
  isPortalPasswordBound,
  verifyPortalPassword,
} from "./portal-password.js";

test("hashPortalPassword stores a versioned scrypt string and verifies", async () => {
  const password = "customer-secret-2026";
  const stored = await hashPortalPassword(password);
  assert.match(stored, /^scrypt\$n=16384\$r=8\$p=1\$keylen=32\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
  assert.equal(await verifyPortalPassword(password, stored), true);
  assert.equal(await verifyPortalPassword("wrong-password", stored), false);
});

test("verifyPortalPassword fails closed on malformed hashes", async () => {
  const password = "customer-secret-2026";
  assert.equal(await verifyPortalPassword(password, ""), false);
  assert.equal(await verifyPortalPassword(password, null), false);
  assert.equal(await verifyPortalPassword(password, undefined), false);
  assert.equal(await verifyPortalPassword(password, "sha256$deadbeef"), false);
  assert.equal(await verifyPortalPassword(password, "scrypt$n=16384$r=8$p=1$keylen=32$not-b64$nope"), false);
  assert.equal(
    await verifyPortalPassword(
      password,
      "scrypt$n=999999999$r=8$p=1$keylen=32$YWFhYWFhYWFhYWFhYWFhYQ$YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE"
    ),
    false
  );
  assert.equal(await verifyPortalPassword("", "scrypt$n=16384$r=8$p=1$keylen=32$aa$bb"), false);
});

test("isPortalPasswordBound treats null as unbound and empty string as bound", () => {
  assert.equal(isPortalPasswordBound(null), false);
  assert.equal(isPortalPasswordBound(undefined), false);
  assert.equal(isPortalPasswordBound("scrypt$..."), true);
  assert.equal(isPortalPasswordBound(""), true);
});

test("hash and verify never return the plaintext password", async () => {
  const password = "never-log-this-password";
  const stored = await hashPortalPassword(password);
  assert.equal(stored.includes(password), false);
  const verified = await verifyPortalPassword(password, stored);
  assert.equal(verified, true);
  assert.equal(JSON.stringify({ stored, verified }).includes(password), false);
});

test("hashPortalPassword rejects empty input", async () => {
  await assert.rejects(() => hashPortalPassword(""), /portal_password_invalid/);
});
