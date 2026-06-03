import test from "node:test";
import assert from "node:assert/strict";
import type { GhlOAuthPendingInstall } from "@prisma/client";
import { handleGhlOAuthCallback, handleGhlMarketplaceWebhook } from "./ghl-connection.service.js";
import { clearGhlOAuthDebugForTests, getLatestGhlOAuthDebug } from "./ghl-oauth-debug.service.js";
import {
  clearGhlMarketplaceWebhookDebugForTests,
  getLatestGhlMarketplaceWebhookDebug,
} from "./ghl-oauth-webhook-debug.service.js";
import { encryptGhlToken } from "../../lib/ghl-token-encryption.js";
import { reconcileGhlOAuthPendingWithLocation } from "./ghl-oauth-reconcile.service.js";
import { assertNoSecretsInString } from "./ghl-oauth-callback-log.js";
import { assertNoTokenFieldsInPayload } from "./ghl-connection.present.js";
import { createGhlOAuthState } from "../../lib/ghl-oauth-state.js";

const TEST_KEY = "test-encryption-key-for-unit-tests-only";

function withOAuthEnv(run: () => void | Promise<void>): Promise<void> {
  const keys = [
    "GHL_OAUTH_CLIENT_ID",
    "GHL_OAUTH_CLIENT_SECRET",
    "GHL_OAUTH_REDIRECT_URI",
    "GHL_OAUTH_SCOPES",
    "GHL_TOKEN_ENCRYPTION_KEY",
    "ADMIN_COC_BASE_URL",
  ] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  process.env.GHL_OAUTH_CLIENT_ID = "client_id_test";
  process.env.GHL_OAUTH_CLIENT_SECRET = "client_secret_test";
  process.env.GHL_OAUTH_REDIRECT_URI =
    "https://sa360-sw6oq.ondigitalocean.app/integrations/oauth/callback";
  process.env.GHL_OAUTH_SCOPES = "contacts.readonly";
  process.env.GHL_TOKEN_ENCRYPTION_KEY = TEST_KEY;
  process.env.ADMIN_COC_BASE_URL = "https://admin-coc.example.com";

  return Promise.resolve(run()).finally(() => {
    clearGhlOAuthDebugForTests();
    clearGhlMarketplaceWebhookDebugForTests();
    for (const k of keys) {
      if (prev[k] !== undefined) process.env[k] = prev[k];
      else delete process.env[k];
    }
  });
}

test("token exchange HTTP 200 without locationId stores pending install", () =>
  withOAuthEnv(async () => {
    const fetchImpl = async (input: string | URL | Request) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "company-access-token",
            refresh_token: "company-refresh-token",
            expires_in: 3600,
            scope: "contacts.readonly",
            userType: "Company",
            companyId: "co_agency_1",
            userId: "user_1",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    };

    let pendingStored = false;
    const result = await handleGhlOAuthCallback(
      { code: "agency-code", state: "", requestId: "req-pending" },
      {
        fetchImpl: fetchImpl as typeof fetch,
        persistTokens: async () => {
          throw new Error("must not create location connection without locationId");
        },
        persistPending: async () => {
          pendingStored = true;
          return { id: "pending_install_1" };
        },
      }
    );

    assert.equal(pendingStored, true);
    assert.match(result.redirectUrl, /ghl_oauth=pending_location/);
    assert.doesNotMatch(result.redirectUrl, /loc_unlinked|missing_location/i);

    const debug = getLatestGhlOAuthDebug();
    assert.ok(debug);
    assert.equal(debug?.outcome, "pending_location");
    assert.equal(debug?.tokenExchangeStatusCode, 200);
    assert.equal(debug?.tokenLevel, "company_or_agency");
    assert.equal(debug?.tokenResponseShape?.locationIdPresent, false);
    assert.equal(debug?.tokenResponseShape?.companyIdPresent, true);
    assert.equal(debug?.pendingInstallId, "pending_install_1");
    assertNoTokenFieldsInPayload(debug as unknown as Record<string, unknown>);
    assertNoSecretsInString(JSON.stringify(debug));
  }));

test("token exchange HTTP 200 with locationId does not call persistPending", () =>
  withOAuthEnv(async () => {
    const state = createGhlOAuthState({ clientAccountId: "client_1" });
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          access_token: "loc-access",
          refresh_token: "loc-refresh",
          expires_in: 3600,
          locationId: "loc_real_1",
          userType: "Location",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    let pendingCalled = false;
    let locationPersisted = false;
    await handleGhlOAuthCallback(
      { code: "code", state, requestId: "req-loc" },
      {
        fetchImpl: fetchImpl as typeof fetch,
        persistPending: async () => {
          pendingCalled = true;
          return { id: "x" };
        },
        persistTokens: async () => {
          locationPersisted = true;
          return { id: "conn_1", locationId: "loc_real_1" };
        },
      }
    );

    assert.equal(pendingCalled, false);
    assert.equal(locationPersisted, true);
    assert.equal(getLatestGhlOAuthDebug()?.outcome, "connected");
    assert.equal(getLatestGhlOAuthDebug()?.tokenLevel, "location");
  }));

test("install webhook with locationId reconciles pending company token to connected", () =>
  withOAuthEnv(async () => {
  const pending: GhlOAuthPendingInstall = {
    id: "pending_1",
    clientAccountId: null,
    companyId: "co_agency_1",
    userId: "user_1",
    userType: "Company",
    appId: "app_1",
    versionId: null,
    accessTokenEncrypted: encryptGhlToken("company-access-token"),
    refreshTokenEncrypted: encryptGhlToken("company-refresh-token"),
    tokenExpiresAt: new Date(Date.now() + 3600_000),
    scopes: ["contacts.readonly"],
    status: "pending_location",
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const connections = new Map<string, { id: string; locationId: string; connectionStatus: string }>();

  const result = await reconcileGhlOAuthPendingWithLocation(
    {
      locationId: "loc_from_webhook",
      companyId: "co_agency_1",
      userId: "user_1",
      appId: "app_1",
      fetchImpl: async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (url.includes("/oauth/locationToken")) {
          return new Response(
            JSON.stringify({
              access_token: "loc-scoped-access",
              refresh_token: "loc-scoped-refresh",
              expires_in: 3600,
              locationId: "loc_from_webhook",
              userType: "Location",
            }),
            { status: 200 }
          );
        }
        if (url.includes("/locations/")) {
          return new Response(JSON.stringify({ location: { name: "Sub" } }), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      },
    },
    {
      findPending: async () => pending,
      persistTokens: async (input) => {
        const row = {
          id: "conn_reconciled",
          locationId: input.locationId,
          connectionStatus: input.connectionStatus ?? "connected",
        };
        connections.set(input.locationId, row);
        return row as never;
      },
      updatePending: async () => ({ ...pending, status: "reconciled" }),
      updateConnection: async (id, data) => {
        const row = [...connections.values()].find((r) => r.id === id);
        if (row && data.connectionStatus) row.connectionStatus = String(data.connectionStatus);
        return row as never;
      },
      findConnectionByLocationId: async (locationId) => {
        const row = connections.get(locationId.trim());
        return row
          ? ({
              id: row.id,
              locationId: row.locationId,
              connectionStatus: row.connectionStatus,
            } as never)
          : null;
      },
    }
  );

  assert.equal(result.handled, true);
  assert.equal(result.connectionStatus, "connected");
  assert.match(result.note, /reconciled/);
  }));

test("uninstall webhook marks connection revoked", async () => {
  clearGhlMarketplaceWebhookDebugForTests();
  const row = {
    id: "conn_1",
    locationId: "loc_uninstall",
    connectionStatus: "connected",
  };
  const result = await handleGhlMarketplaceWebhook(
    { type: "UNINSTALL", locationId: "loc_uninstall" },
    {
      findConnectionByLocationId: async () => row as never,
      updateConnection: async (_id, data) => {
        row.connectionStatus = String(data.connectionStatus ?? "revoked");
        return row as never;
      },
    }
  );
  assert.equal(result.handled, true);
  assert.equal(row.connectionStatus, "revoked");
  const debug = getLatestGhlMarketplaceWebhookDebug();
  assert.equal(debug?.eventType, "UNINSTALL");
  assert.equal(debug?.locationIdPresent, true);
  assertNoTokenFieldsInPayload(debug as unknown as Record<string, unknown>);
});

test("install webhook records safe debug snapshot", async () => {
  clearGhlMarketplaceWebhookDebugForTests();
  await handleGhlMarketplaceWebhook(
    {
      type: "INSTALL",
      locationId: "loc_install_dbg",
      companyId: "co_1",
      appId: "app_1",
      versionId: "ver_1",
      installType: "location",
      webhookId: "wh_1",
      timestamp: "2026-05-19T00:00:00Z",
    },
    {
      reconcile: async () => ({
        handled: true,
        connectionStatus: "pending_location",
        connectionId: null,
        note: "awaiting_oauth_tokens",
      }),
    }
  );
  const debug = getLatestGhlMarketplaceWebhookDebug();
  assert.ok(debug);
  assert.equal(debug?.eventType, "INSTALL");
  assert.equal(debug?.locationIdPresent, true);
  assert.equal(debug?.companyIdPresent, true);
  assertNoSecretsInString(JSON.stringify(debug));
});
