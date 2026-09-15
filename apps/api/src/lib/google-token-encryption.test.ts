import assert from "node:assert/strict";
import test from "node:test";
import { createCipheriv, createHash, randomBytes } from "node:crypto";

import {
  decryptAes256GcmToken,
  encryptAes256GcmToken,
  loadNamedEncryptionKey,
} from "./token-encryption.js";
import { decryptGhlToken, encryptGhlToken } from "./ghl-token-encryption.js";
import {
  decryptGoogleToken,
  encryptGoogleToken,
  isGoogleTokenEncryptionConfigured,
} from "./google-token-encryption.js";

const GHL_TEST_KEY = "test-encryption-key-for-unit-tests-only";
const GOOGLE_TEST_KEY = "test-google-encryption-key-for-unit-tests-only";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
  }
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("A. Google tokens encrypt/decrypt correctly", () => {
  withEnv(
    {
      GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_TEST_KEY,
      GHL_TOKEN_ENCRYPTION_KEY: GHL_TEST_KEY,
    },
    () => {
      const plaintext = "ya29.google-access-token-value";
      const enc = encryptGoogleToken(plaintext);
      assert.notEqual(enc, plaintext);
      assert.match(enc, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      assert.equal(decryptGoogleToken(enc), plaintext);
    }
  );
});

test("B. Google crypto requires GOOGLE_TOKEN_ENCRYPTION_KEY", () => {
  withEnv(
    {
      GOOGLE_TOKEN_ENCRYPTION_KEY: undefined,
      GHL_TOKEN_ENCRYPTION_KEY: GHL_TEST_KEY,
    },
    () => {
      assert.equal(isGoogleTokenEncryptionConfigured(), false);
      assert.throws(() => encryptGoogleToken("ya29.secret"), /GOOGLE_TOKEN_ENCRYPTION_KEY is not configured/);
      assert.throws(() => decryptGoogleToken("a.b.c"), /GOOGLE_TOKEN_ENCRYPTION_KEY is not configured/);
    }
  );
});

test("C. GHL key cannot decrypt Google token data", () => {
  withEnv(
    {
      GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_TEST_KEY,
      GHL_TOKEN_ENCRYPTION_KEY: GHL_TEST_KEY,
    },
    () => {
      const enc = encryptGoogleToken("ya29.google-only");
      const ghlKey = loadNamedEncryptionKey("GHL_TOKEN_ENCRYPTION_KEY");
      assert.throws(() => decryptAes256GcmToken(enc, ghlKey), /Unsupported state|unable to authenticate|auth/i);
      assert.throws(() => decryptGhlToken(enc), /Unsupported state|unable to authenticate|auth/i);
    }
  );
});

test("D. Google key is not silently replaced by GHL key", () => {
  withEnv(
    {
      GOOGLE_TOKEN_ENCRYPTION_KEY: undefined,
      GHL_TOKEN_ENCRYPTION_KEY: GHL_TEST_KEY,
    },
    () => {
      assert.throws(() => encryptGoogleToken("ya29.secret"), /GOOGLE_TOKEN_ENCRYPTION_KEY is not configured/);
      const ghlEnc = encryptGhlToken("ghl-only-token");
      assert.equal(decryptGhlToken(ghlEnc), "ghl-only-token");
    }
  );
});

test("GHL encrypt/decrypt is unchanged and ignores GOOGLE_TOKEN_ENCRYPTION_KEY", () => {
  withEnv(
    {
      GHL_TOKEN_ENCRYPTION_KEY: GHL_TEST_KEY,
      GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_TEST_KEY,
    },
    () => {
      const enc = encryptGhlToken("secret-access-token-value");
      assert.notEqual(enc, "secret-access-token-value");
      assert.equal(decryptGhlToken(enc), "secret-access-token-value");
      assert.throws(() => decryptGoogleToken(enc), /Unsupported state|unable to authenticate|auth/i);
    }
  );
});

test("Google encrypt refuses empty plaintext", () => {
  withEnv({ GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_TEST_KEY }, () => {
    assert.throws(() => encryptGoogleToken(""), /non-empty/);
  });
});

test("shared AES helper round-trips with an explicit key buffer", () => {
  withEnv({ GOOGLE_TOKEN_ENCRYPTION_KEY: GOOGLE_TEST_KEY }, () => {
    const keyBuf = loadNamedEncryptionKey("GOOGLE_TOKEN_ENCRYPTION_KEY");
    const enc = encryptAes256GcmToken("pkce-verifier-secret", keyBuf);
    assert.equal(decryptAes256GcmToken(enc, keyBuf), "pkce-verifier-secret");
  });
});

test("GHL key derivation still accepts 64-char hex as a raw AES key", () => {
  const hexKey = "ab".repeat(32);
  withEnv({ GHL_TOKEN_ENCRYPTION_KEY: hexKey }, () => {
    const enc = encryptGhlToken("hex-key-plaintext");
    assert.equal(decryptGhlToken(enc), "hex-key-plaintext");
  });
});

test("legacy GHL AES-256-GCM replica ciphertext decrypts with the shared helper", () => {
  withEnv({ GHL_TOKEN_ENCRYPTION_KEY: GHL_TEST_KEY }, () => {
    const raw = GHL_TEST_KEY;
    const key =
      raw.length === 64 && /^[0-9a-f]+$/i.test(raw)
        ? Buffer.from(raw, "hex")
        : createHash("sha256").update(raw).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const enc = Buffer.concat([cipher.update("pre-pr-ghl-ciphertext", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacy = `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
    assert.equal(decryptGhlToken(legacy), "pre-pr-ghl-ciphertext");
  });
});
