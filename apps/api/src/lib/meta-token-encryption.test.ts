import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptMetaToken,
  encryptMetaToken,
  metaTokenFingerprint,
  redactMetaSecretText,
} from "./meta-token-encryption.js";

const KEY = "test-meta-token-key-not-a-real-secret";

test("Meta token encryption round-trips and does not reuse another provider key", () => {
  const saved = {
    META_TOKEN_ENCRYPTION_KEY: process.env.META_TOKEN_ENCRYPTION_KEY,
    GHL_TOKEN_ENCRYPTION_KEY: process.env.GHL_TOKEN_ENCRYPTION_KEY,
    GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  };
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "ghl-key-should-not-decrypt-meta";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "google-key-should-not-decrypt-meta";
  delete process.env.META_TOKEN_ENCRYPTION_KEY;
  const plaintext = "EAABmeta-page-token-value-not-real";
  assert.throws(() => encryptMetaToken(plaintext), /META_TOKEN_ENCRYPTION_KEY/);
  process.env.META_TOKEN_ENCRYPTION_KEY = KEY;
  const ciphertext = encryptMetaToken(plaintext);
  assert.equal(ciphertext.includes(plaintext), false);
  assert.equal(decryptMetaToken(ciphertext), plaintext);
  assert.equal(metaTokenFingerprint(plaintext), metaTokenFingerprint(plaintext));
  assert.notEqual(metaTokenFingerprint(plaintext), metaTokenFingerprint(`${plaintext}-2`));
  const redacted = redactMetaSecretText(`failed with ${plaintext} and access_token=abc`, [plaintext]);
  assert.equal(redacted.includes(plaintext), false);
  assert.equal(redacted.includes("access_token=abc"), false);
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
