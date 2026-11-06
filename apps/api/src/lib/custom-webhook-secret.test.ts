import assert from "node:assert/strict";
import test from "node:test";

import { validateDeliveryTargetMetadata } from "./delivery-target-metadata.validation.js";
import {
  customWebhookDeliveryTargetMetadata,
  customWebhookEndpointHost,
  customWebhookSecretFingerprint,
  decryptCustomWebhookSecret,
  encryptCustomWebhookSecret,
  redactCustomWebhookMaterial,
  sanitizeTeamWorkspaceTicketContext,
  toCustomWebhookReadMetadata,
  toCustomWebhookWriteMetadata,
  CUSTOM_WEBHOOK_SECRET_KEY_ENV,
} from "./custom-webhook-secret.js";
import { decryptAes256GcmToken, loadNamedEncryptionKey } from "./token-encryption.js";

const KEY = "test-custom-webhook-secret-key-not-real";
const PLAINTEXT = "whsec_super_secret_value";
const ENDPOINT_URL = "https://hooks.example.com/lead?token=do-not-log";

function withWebhookKey(fn: () => void): void {
  const saved = {
    [CUSTOM_WEBHOOK_SECRET_KEY_ENV]: process.env[CUSTOM_WEBHOOK_SECRET_KEY_ENV],
    META_TOKEN_ENCRYPTION_KEY: process.env.META_TOKEN_ENCRYPTION_KEY,
    GHL_TOKEN_ENCRYPTION_KEY: process.env.GHL_TOKEN_ENCRYPTION_KEY,
    GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  };
  process.env.META_TOKEN_ENCRYPTION_KEY = "meta-key-must-not-decrypt-webhook";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "ghl-key-must-not-decrypt-webhook";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "google-key-must-not-decrypt-webhook";
  process.env[CUSTOM_WEBHOOK_SECRET_KEY_ENV] = KEY;
  try {
    fn();
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("custom webhook encryption requires its own key and round-trips", () => {
  const saved = {
    [CUSTOM_WEBHOOK_SECRET_KEY_ENV]: process.env[CUSTOM_WEBHOOK_SECRET_KEY_ENV],
    META_TOKEN_ENCRYPTION_KEY: process.env.META_TOKEN_ENCRYPTION_KEY,
    GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  };
  delete process.env[CUSTOM_WEBHOOK_SECRET_KEY_ENV];
  process.env.META_TOKEN_ENCRYPTION_KEY = "meta-key-must-not-decrypt-webhook";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = "google-key-must-not-decrypt-webhook";
  try {
    assert.throws(() => encryptCustomWebhookSecret(PLAINTEXT), /SA360_CUSTOM_WEBHOOK_SECRET_KEY/);
    assert.throws(() => decryptCustomWebhookSecret("a.b.c"), /SA360_CUSTOM_WEBHOOK_SECRET_KEY/);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  withWebhookKey(() => {
    const ciphertext = encryptCustomWebhookSecret(PLAINTEXT);
    assert.equal(ciphertext.includes(PLAINTEXT), false);
    assert.equal(decryptCustomWebhookSecret(ciphertext), PLAINTEXT);
    assert.throws(
      () => decryptAes256GcmToken(ciphertext, loadNamedEncryptionKey("META_TOKEN_ENCRYPTION_KEY")),
      /unable to authenticate|Unsupported state|auth/i
    );
    assert.equal(customWebhookSecretFingerprint(PLAINTEXT), customWebhookSecretFingerprint(PLAINTEXT));
    assert.notEqual(
      customWebhookSecretFingerprint(PLAINTEXT),
      customWebhookSecretFingerprint(`${PLAINTEXT}-2`)
    );
    assert.equal(customWebhookSecretFingerprint(PLAINTEXT).includes(PLAINTEXT), false);
    assert.throws(() => encryptCustomWebhookSecret("   "), /non-empty/);
  });
});

test("encrypted webhook secrets are removed from logs, API metadata, tickets, and target metadata", () => {
  withWebhookKey(() => {
    const ciphertext = encryptCustomWebhookSecret(PLAINTEXT);
    const fingerprint = customWebhookSecretFingerprint(PLAINTEXT);
    const logs: string[] = [];
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.info = console.log;
    console.warn = console.log;
    console.error = console.log;
    try {
      const redacted = redactCustomWebhookMaterial(
        {
          message: `posted ${PLAINTEXT} body ${ciphertext} to ${ENDPOINT_URL}`,
          signingSecret: PLAINTEXT,
          signingSecretCiphertext: ciphertext,
          endpointUrl: ENDPOINT_URL,
          receiptId: "job_123",
          httpStatus: 204,
          nested: { note: ciphertext, endpoint_url: ENDPOINT_URL, password: "hidden" },
        },
        [PLAINTEXT, ciphertext, ENDPOINT_URL]
      );
      const read = toCustomWebhookReadMetadata({ endpointUrl: ENDPOINT_URL, enabled: false });
      const write = toCustomWebhookWriteMetadata({
        endpointUrl: ENDPOINT_URL,
        signingSecretFingerprint: fingerprint,
        enabled: false,
        revision: 2,
      });
      const ticket = sanitizeTeamWorkspaceTicketContext({
        teamWorkspace: {
          contractVersion: "team_workspace_delivery_v1",
          clientAccountId: "alex_gross",
          sourceLeadEventId: null,
          sheetsJobId: "job_123",
          ghlLiveRunId: null,
          customWebhookAttemptId: null,
          endpointUrl: ENDPOINT_URL,
          signingSecret: PLAINTEXT,
          signingSecretCiphertext: ciphertext,
          phone: "+15551234567",
          email: "lead@example.com",
        },
      });
      const metadata = customWebhookDeliveryTargetMetadata({ endpointHost: "hooks.example.com" });
      const forbidden = validateDeliveryTargetMetadata({
        endpointHost: "hooks.example.com",
        signingSecret: PLAINTEXT,
        nested: { signingSecretCiphertext: ciphertext },
      });
      const dumped = JSON.stringify({ redacted, read, write, ticket, metadata });
      assert.equal(dumped.includes(PLAINTEXT), false);
      assert.equal(dumped.includes(ciphertext), false);
      assert.equal(dumped.includes(ENDPOINT_URL), false);
      assert.equal(dumped.includes("15551234567"), false);
      assert.equal(dumped.includes("lead@example.com"), false);
      assert.equal(dumped.includes("signingSecret"), false);
      assert.equal((redacted as { receiptId: string }).receiptId, "job_123");
      assert.equal((redacted as { httpStatus: number }).httpStatus, 204);
      assert.deepEqual(read, {
        present: true,
        enabled: false,
        endpointHost: "hooks.example.com",
      });
      assert.equal(read.endpointHost, "hooks.example.com");
      assert.equal(JSON.stringify(read).includes("/lead"), false);
      assert.equal(write.secretFingerprint, fingerprint);
      assert.equal(write.revision, 2);
      assert.equal(JSON.stringify(write).includes("ciphertext"), false);
      assert.equal(ticket.teamWorkspace.contractVersion, "team_workspace_delivery_v1");
      assert.equal(ticket.teamWorkspace.clientAccountId, "alex_gross");
      assert.equal(ticket.teamWorkspace.sheetsJobId, "job_123");
      assert.equal(ticket.teamWorkspace.sourceLeadEventId, null);
      assert.equal(forbidden.ok, false);
      if (!forbidden.ok) {
        assert.ok(forbidden.paths.includes("signingSecret"));
        assert.ok(forbidden.paths.includes("nested.signingSecretCiphertext"));
      }
      assert.equal(metadata.ok, true);
      if (metadata.ok) {
        assert.deepEqual(metadata.configMetadataJson, { endpointHost: "hooks.example.com" });
        assert.deepEqual(validateDeliveryTargetMetadata(metadata.configMetadataJson), { ok: true });
      }
      assert.equal(customWebhookEndpointHost("http://hooks.example.com/hook"), null);
      assert.equal(customWebhookEndpointHost("not a url"), null);
    } finally {
      console.log = originals.log;
      console.info = originals.info;
      console.warn = originals.warn;
      console.error = originals.error;
    }
    assert.deepEqual(logs, []);
  });
});
