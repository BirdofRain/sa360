import test from "node:test";
import assert from "node:assert/strict";
import { encryptGhlToken, decryptGhlToken } from "./ghl-token-encryption.js";
import { createGhlOAuthState, verifyGhlOAuthState } from "./ghl-oauth-state.js";
import { presentGhlLocationConnection, assertNoTokenFieldsInPayload } from "../services/ghl-oauth/ghl-connection.present.js";

test("encryptGhlToken round-trips with decryptGhlToken", () => {
  const prev = process.env.GHL_TOKEN_ENCRYPTION_KEY;
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
  try {
    const enc = encryptGhlToken("secret-access-token-value");
    assert.notEqual(enc, "secret-access-token-value");
    assert.equal(decryptGhlToken(enc), "secret-access-token-value");
  } finally {
    if (prev !== undefined) process.env.GHL_TOKEN_ENCRYPTION_KEY = prev;
    else delete process.env.GHL_TOKEN_ENCRYPTION_KEY;
  }
});

test("verifyGhlOAuthState rejects tampered state", () => {
  const prev = process.env.GHL_TOKEN_ENCRYPTION_KEY;
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
  try {
    const state = createGhlOAuthState({ clientAccountId: "client_1" });
    const tampered = `${state.slice(0, -2)}xx`;
    assert.throws(() => verifyGhlOAuthState(tampered), /signature|invalid/i);
  } finally {
    if (prev !== undefined) process.env.GHL_TOKEN_ENCRYPTION_KEY = prev;
    else delete process.env.GHL_TOKEN_ENCRYPTION_KEY;
  }
});

test("verifyGhlOAuthState rejects expired state", () => {
  const prev = process.env.GHL_TOKEN_ENCRYPTION_KEY;
  process.env.GHL_TOKEN_ENCRYPTION_KEY = "test-encryption-key-for-unit-tests-only";
  try {
    const state = createGhlOAuthState({
      clientAccountId: "client_1",
      now: Date.now() - 20 * 60 * 1000,
    });
    assert.throws(() => verifyGhlOAuthState(state), /expired/i);
  } finally {
    if (prev !== undefined) process.env.GHL_TOKEN_ENCRYPTION_KEY = prev;
    else delete process.env.GHL_TOKEN_ENCRYPTION_KEY;
  }
});

test("presentGhlLocationConnection omits encrypted token fields", () => {
  const item = presentGhlLocationConnection({
    id: "conn_1",
    clientAccountId: "client_1",
    locationId: "loc_1",
    locationName: "Test Location",
    companyId: null,
    userId: null,
    appId: null,
    accessTokenEncrypted: "enc_access",
    refreshTokenEncrypted: "enc_refresh",
    tokenExpiresAt: new Date(),
    scopes: ["contacts.readonly"],
    authMode: "oauth",
    connectionStatus: "connected",
    lastProbeAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  assertNoTokenFieldsInPayload(item as unknown as Record<string, unknown>);
  assert.equal(item.locationId, "loc_1");
  assert.equal((item as Record<string, unknown>).accessTokenEncrypted, undefined);
});
