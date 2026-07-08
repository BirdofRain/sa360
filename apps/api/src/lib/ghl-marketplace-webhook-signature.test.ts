import test from "node:test";
import assert from "node:assert/strict";
import { createSign, generateKeyPairSync, sign as signAsymmetric } from "node:crypto";
import { verifyGhlMarketplaceWebhookSignature } from "./ghl-marketplace-webhook-signature.js";

test("verifyGhlMarketplaceWebhookSignature validates X-GHL-Signature (Ed25519)", () => {
  const payload = JSON.stringify({ type: "INSTALL", locationId: "loc_1" });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = signAsymmetric(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");

  const result = verifyGhlMarketplaceWebhookSignature({
    rawBody: payload,
    ghlSignatureHeader: signature,
    ghlPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  assert.deepEqual(result, { ok: true, scheme: "ghl_ed25519" });
});

test("verifyGhlMarketplaceWebhookSignature validates X-WH-Signature (legacy RSA)", () => {
  const payload = JSON.stringify({ type: "UNINSTALL", locationId: "loc_1" });
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signer = createSign("SHA256");
  signer.update(payload, "utf8");
  signer.end();
  const signature = signer.sign(privateKey, "base64");

  const result = verifyGhlMarketplaceWebhookSignature({
    rawBody: payload,
    legacySignatureHeader: signature,
    legacyPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  assert.deepEqual(result, { ok: true, scheme: "legacy_rsa" });
});

test("verifyGhlMarketplaceWebhookSignature prefers X-GHL-Signature over legacy header", () => {
  const payload = JSON.stringify({ type: "INSTALL" });
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const signature = signAsymmetric(null, Buffer.from(payload, "utf8"), privateKey).toString("base64");

  const result = verifyGhlMarketplaceWebhookSignature({
    rawBody: payload,
    ghlSignatureHeader: signature,
    legacySignatureHeader: "definitely-not-valid",
    ghlPublicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  });
  assert.deepEqual(result, { ok: true, scheme: "ghl_ed25519" });
});

test("verifyGhlMarketplaceWebhookSignature rejects missing headers", () => {
  const result = verifyGhlMarketplaceWebhookSignature({ rawBody: "{}" });
  assert.deepEqual(result, { ok: false, reason: "no_signature" });
});
