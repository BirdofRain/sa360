import assert from "node:assert/strict";
import test from "node:test";

import { GOOGLE_OAUTH_TOKEN_URL } from "../../lib/google-oauth-env.js";
import { encryptGoogleToken } from "../../lib/google-token-encryption.js";
import { payloadContainsPlaintextSecret } from "../../lib/token-field-denylist.js";
import { getValidGoogleAccessToken } from "./google-access-token.service.js";

const KEY = "phase-1c-google-access-token-test-key";
const ACCESS = "ya29.fresh-access-token-phase1c";
const REFRESH = "1//stored-refresh-token-phase1c";
const ACCESS_2 = "ya29.rotated-access-token-phase1c";
const REFRESH_2 = "1//rotated-refresh-token-phase1c";

const previousKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = KEY;
test.after(() => {
  if (previousKey === undefined) delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  else process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = previousKey;
});

const credentialsEnv = {
  GOOGLE_TOKEN_ENCRYPTION_KEY: KEY,
  GOOGLE_OAUTH_CLIENT_ID: "client-id",
  GOOGLE_OAUTH_CLIENT_SECRET: "client-secret",
  SA360_GOOGLE_OAUTH_ENABLED: "false",
} as NodeJS.ProcessEnv;

function secrets(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    clientAccountId: "tenant-a",
    status: "connected",
    tokenVersion: 3,
    accessTokenEncrypted: encryptGoogleToken(ACCESS),
    refreshTokenEncrypted: encryptGoogleToken(REFRESH),
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    tokenType: "Bearer",
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    ...overrides,
  };
}

function connection(status: "connected" | "reconnect_required" | "disconnected" | "error" = "connected") {
  return {
    id: "conn-1",
    clientAccountId: "tenant-a",
    status,
    googleUserId: "sub",
    googleEmail: "user@example.com",
    googleDisplayName: "User",
    tokenVersion: 3,
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    connectedAt: new Date(),
    lastRefreshedAt: new Date(),
    reconnectRequiredAt: null,
    disconnectedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    accessTokenEncrypted: "cipher",
    refreshTokenEncrypted: "cipher",
    scopes: [],
    tokenType: "Bearer",
  };
}

test("J. connected unexpired access token is decrypted without refresh", async () => {
  let refreshed = 0;
  const result = await getValidGoogleAccessToken("tenant-a", {
    env: credentialsEnv,
    loadConnection: async () => connection(),
    loadSecrets: async () => secrets(),
    refreshToken: async () => {
      refreshed += 1;
      throw new Error("must not refresh");
    },
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.accessToken, ACCESS);
  assert.equal(refreshed, 0);
});

test("K/L. expired token refreshes and preserves omitted refresh token", async () => {
  const casCalls: Array<Record<string, unknown>> = [];
  const result = await getValidGoogleAccessToken("tenant-a", {
    env: credentialsEnv,
    loadConnection: async () => connection(),
    loadSecrets: async () => secrets({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    refreshToken: async (input, fetchImpl) => {
      assert.equal(input.refreshToken, REFRESH);
      assert.equal(input.config.clientId, "client-id");
      if (fetchImpl) await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, { method: "POST" });
      return {
        ok: true as const,
        token: {
          accessToken: ACCESS_2,
          refreshToken: null,
          expiresAt: new Date(Date.now() + 3600_000),
          scopes: [],
          tokenType: "Bearer",
        },
      };
    },
    casRefresh: async (input) => {
      casCalls.push(input as unknown as Record<string, unknown>);
      assert.equal("refreshToken" in input, false);
      return { ok: true as const, tokenVersion: 4, connection: { tokenVersion: 4 } as never };
    },
    fetchImpl: (async () => new Response("{}")) as typeof fetch,
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.accessToken, ACCESS_2);
  assert.equal(casCalls.length, 1);
});

test("M. concurrent refresh CAS loser reloads the newest token", async () => {
  let loads = 0;
  const result = await getValidGoogleAccessToken("tenant-a", {
    env: credentialsEnv,
    loadConnection: async () => connection(),
    loadSecrets: async () => {
      loads += 1;
      if (loads === 1) {
        return secrets({ tokenExpiresAt: new Date(Date.now() - 1000), tokenVersion: 3 });
      }
      return secrets({
        tokenVersion: 4,
        accessTokenEncrypted: encryptGoogleToken(ACCESS_2),
        tokenExpiresAt: new Date(Date.now() + 3600_000),
      });
    },
    refreshToken: async () => ({
      ok: true as const,
      token: {
        accessToken: "loser-access-must-not-win",
        refreshToken: REFRESH_2,
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: [],
        tokenType: "Bearer",
      },
    }),
    casRefresh: async () => ({ ok: false as const, reason: "stale_version" as const }),
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.accessToken, ACCESS_2);
    assert.equal(result.tokenVersion, 4);
  }
  assert.equal(loads, 2);
});

test("N. disconnected connection cannot be resurrected by refresh CAS", async () => {
  const result = await getValidGoogleAccessToken("tenant-a", {
    env: credentialsEnv,
    loadConnection: async () => connection("disconnected"),
    loadSecrets: async () => secrets({ status: "disconnected" }),
    refreshToken: async () => {
      throw new Error("must not refresh disconnected");
    },
    casRefresh: async () => {
      throw new Error("must not CAS disconnected");
    },
  });
  assert.deepEqual(result, { ok: false, code: "google_not_connected" });
});

test("CAS disconnected reason after refresh does not persist the new token as connected", async () => {
  const result = await getValidGoogleAccessToken("tenant-a", {
    env: credentialsEnv,
    loadConnection: async () => connection(),
    loadSecrets: async () => secrets({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    refreshToken: async () => ({
      ok: true as const,
      token: {
        accessToken: ACCESS_2,
        refreshToken: REFRESH_2,
        expiresAt: new Date(Date.now() + 3600_000),
        scopes: [],
        tokenType: "Bearer",
      },
    }),
    casRefresh: async () => ({ ok: false as const, reason: "disconnected" as const }),
  });
  assert.deepEqual(result, { ok: false, code: "google_not_connected" });
});

test("O. invalid_grant marks reconnect_required", async () => {
  let marked = 0;
  const result = await getValidGoogleAccessToken("tenant-a", {
    env: credentialsEnv,
    loadConnection: async () => connection(),
    loadSecrets: async () => secrets({ tokenExpiresAt: new Date(Date.now() - 1000) }),
    refreshToken: async () => ({ ok: false as const, reason: "invalid_grant" as const }),
    markReconnect: async () => {
      marked += 1;
      return { connection: { status: "reconnect_required" } as never };
    },
  });
  assert.deepEqual(result, { ok: false, code: "google_reconnect_required" });
  assert.equal(marked, 1);
});

test("AR. reconnect_required and error statuses fail closed without refresh", async () => {
  for (const status of ["reconnect_required", "error"] as const) {
    let refreshed = 0;
    const result = await getValidGoogleAccessToken("tenant-a", {
      env: credentialsEnv,
      loadConnection: async () => connection(status),
      refreshToken: async () => {
        refreshed += 1;
        throw new Error("must not refresh");
      },
    });
    assert.deepEqual(result, { ok: false, code: "google_reconnect_required" });
    assert.equal(refreshed, 0);
  }
});

test("P. access token results never include ciphertext or plaintext secrets", async () => {
  const result = await getValidGoogleAccessToken("tenant-a", {
    env: credentialsEnv,
    loadConnection: async () => connection(),
    loadSecrets: async () => secrets(),
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes("Encrypted"), false);
  assert.equal(payloadContainsPlaintextSecret(result, [REFRESH]), false);
});
