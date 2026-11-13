import assert from "node:assert/strict";
import test from "node:test";

import { decryptAes256GcmToken, loadNamedEncryptionKey } from "./token-encryption.js";
import {
  CUSTOM_WEBHOOK_SECRET_KEY_ENV,
} from "./custom-webhook-secret.js";
import {
  EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV,
  decryptExternalWebhookSigningSecret,
  decryptExternalWebhookUrl,
  encryptExternalWebhookSigningSecret,
  sealExternalWebhookEndpoint,
  toExternalWebhookReadMetadata,
} from "./external-webhook-credentials.js";

const KEY = "test-external-webhook-credential-key-not-real";
const URL = "https://hooks.example.com/hook/path-token?x=1";

function withKey(fn: () => Promise<void>): Promise<void> {
  const saved = {
    [EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV]: process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV],
    [CUSTOM_WEBHOOK_SECRET_KEY_ENV]: process.env[CUSTOM_WEBHOOK_SECRET_KEY_ENV],
    META_TOKEN_ENCRYPTION_KEY: process.env.META_TOKEN_ENCRYPTION_KEY,
    GHL_TOKEN_ENCRYPTION_KEY: process.env.GHL_TOKEN_ENCRYPTION_KEY,
    GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  };
  process.env.META_TOKEN_ENCRYPTION_KEY = "meta-key-must-not-decrypt-external-webhook";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "ghl-key-must-not-decrypt-external-webhook";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "google-key-must-not-decrypt-external-webhook";
  process.env[CUSTOM_WEBHOOK_SECRET_KEY_ENV] = "legacy-custom-webhook-key-must-not-decrypt";
  process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = KEY;
  return fn().finally(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

test("external webhook URL and HMAC ciphertext use a dedicated key", async () => {
  const saved = process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
  const savedMeta = process.env.META_TOKEN_ENCRYPTION_KEY;
  delete process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
  process.env.META_TOKEN_ENCRYPTION_KEY = "meta-key-must-not-decrypt-external-webhook";
  try {
    await assert.rejects(
      () => sealExternalWebhookEndpoint(URL, async () => [{ address: "8.8.8.8", family: 4 }]),
      /SA360_EXTERNAL_WEBHOOK_CREDENTIAL_KEY/
    );
  } finally {
    if (saved === undefined) delete process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
    else process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = saved;
    if (savedMeta === undefined) delete process.env.META_TOKEN_ENCRYPTION_KEY;
    else process.env.META_TOKEN_ENCRYPTION_KEY = savedMeta;
  }

  await withKey(async () => {
    const sealed = await sealExternalWebhookEndpoint(URL, async () => [{ address: "8.8.8.8", family: 4 }]);
    assert.equal(sealed.ok, true);
    if (!sealed.ok) return;
    assert.equal(sealed.endpoint.ciphertext.includes("path-token"), false);
    assert.equal(decryptExternalWebhookUrl(sealed.endpoint.ciphertext), sealed.endpoint.canonicalUrl);
    assert.equal(sealed.endpoint.fingerprint.includes("path-token"), false);
    assert.throws(
      () => decryptAes256GcmToken(sealed.endpoint.ciphertext, loadNamedEncryptionKey("META_TOKEN_ENCRYPTION_KEY")),
      /unable to authenticate|Unsupported state|auth/i
    );
    assert.throws(
      () =>
        decryptAes256GcmToken(
          sealed.endpoint.ciphertext,
          loadNamedEncryptionKey(CUSTOM_WEBHOOK_SECRET_KEY_ENV)
        ),
      /unable to authenticate|Unsupported state|auth/i
    );
    const secret = encryptExternalWebhookSigningSecret("whsec_external_test");
    assert.equal(decryptExternalWebhookSigningSecret(secret.ciphertext), "whsec_external_test");
    assert.equal(secret.fingerprint.includes("whsec_external_test"), false);
    const metadata = toExternalWebhookReadMetadata({
      kind: "ghl_inbound",
      authMode: "none",
      enabled: false,
      endpointHost: sealed.endpoint.hostname,
      revision: 1,
    });
    assert.equal(JSON.stringify(metadata).includes("path-token"), false);
    assert.equal(metadata.endpointHost, "hooks.example.com");
    assert.throws(() => encryptExternalWebhookSigningSecret("   "), /non-empty/);
  });
});
