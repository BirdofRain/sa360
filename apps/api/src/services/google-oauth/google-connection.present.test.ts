import assert from "node:assert/strict";
import test from "node:test";
import type { GoogleAccountConnection, GoogleOAuthPendingAuth } from "@prisma/client";

import { payloadContainsPlaintextSecret } from "../../lib/token-field-denylist.js";
import {
  assertNoTokenFieldsInPayload,
  presentGoogleAccountConnection,
  presentGoogleOAuthPendingAuth,
} from "./google-connection.present.js";

test("E. presentGoogleAccountConnection omits token ciphertext and plaintext", () => {
  const row = {
    id: "gconn_1",
    clientAccountId: "client_1",
    googleUserId: "google-sub-1",
    googleEmail: "user@example.com",
    googleDisplayName: "Sam Example",
    status: "connected",
    accessTokenEncrypted: "enc_access_ciphertext",
    refreshTokenEncrypted: "enc_refresh_ciphertext",
    tokenExpiresAt: new Date("2026-09-15T00:00:00.000Z"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    tokenType: "Bearer",
    tokenVersion: 3,
    connectedAt: new Date("2026-09-15T00:00:00.000Z"),
    lastRefreshedAt: null,
    reconnectRequiredAt: null,
    disconnectedAt: null,
    lastError: null,
    createdAt: new Date("2026-09-15T00:00:00.000Z"),
    updatedAt: new Date("2026-09-15T00:00:00.000Z"),
  } as GoogleAccountConnection;

  const item = presentGoogleAccountConnection(row);
  assertNoTokenFieldsInPayload(item as unknown as Record<string, unknown>);
  assert.equal((item as Record<string, unknown>).accessTokenEncrypted, undefined);
  assert.equal((item as Record<string, unknown>).refreshTokenEncrypted, undefined);
  assert.equal((item as Record<string, unknown>).accessToken, undefined);
  assert.equal(item.googleEmail, "user@example.com");
  assert.equal(item.tokenVersion, 3);
  assert.equal(
    payloadContainsPlaintextSecret(item, ["enc_access_ciphertext", "enc_refresh_ciphertext"]),
    false
  );
});

test("E. presentGoogleOAuthPendingAuth omits PKCE verifier and state hash", () => {
  const row = {
    id: "pend_1",
    clientAccountId: "client_1",
    stateHash: "abc123statehash",
    pkceVerifierEncrypted: "enc_pkce_ciphertext",
    returnTo: "/portal/account",
    expiresAt: new Date("2026-09-15T00:15:00.000Z"),
    consumedAt: null,
    createdAt: new Date("2026-09-15T00:00:00.000Z"),
  } as GoogleOAuthPendingAuth;

  const item = presentGoogleOAuthPendingAuth(row);
  assertNoTokenFieldsInPayload(item as unknown as Record<string, unknown>);
  assert.equal((item as Record<string, unknown>).pkceVerifierEncrypted, undefined);
  assert.equal((item as Record<string, unknown>).stateHash, undefined);
  assert.equal((item as Record<string, unknown>).pkceVerifier, undefined);
  assert.equal(item.returnTo, "/portal/account");
  assert.equal(
    payloadContainsPlaintextSecret(item, ["enc_pkce_ciphertext", "abc123statehash"]),
    false
  );
});
