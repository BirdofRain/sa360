import test from "node:test";
import assert from "node:assert/strict";
import { inspectGhlOAuthAuthorizeUrl } from "../../lib/ghl-oauth-env.js";
import {
  buildGhlOAuthReconciliationSummary,
  deriveGhlLocationDeliveryReadiness,
  deriveGhlOAuthPageBanner,
  isGhlTestLocationId,
  presentGhlLocationConnectionForAdmin,
} from "./ghl-oauth-admin.present.js";
import type { GhlLocationConnectionItem } from "./ghl-connection.present.js";

function connection(
  overrides: Partial<GhlLocationConnectionItem> = {}
): GhlLocationConnectionItem {
  return {
    id: "conn_1",
    clientAccountId: "client_1",
    locationId: "HZ97NWGIViy5udec20Ir",
    locationName: "Breanne Kimberling",
    companyId: "co_1",
    userId: "user_1",
    appId: "app_1",
    authMode: "oauth",
    connectionStatus: "connected",
    tokenExpiresAt: new Date().toISOString(),
    scopes: ["contacts.readonly"],
    lastProbeAt: new Date().toISOString(),
    lastError: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("inspectGhlOAuthAuthorizeUrl detects version_id scope and state", () => {
  const url =
    "https://marketplace.leadconnectorhq.com/v2/oauth/chooselocation?response_type=code&redirect_uri=https%3A%2F%2Fapi.example%2Fcallback&client_id=cid&state=signed-state&version_id=ver_123&scope=contacts.readonly";
  const flags = inspectGhlOAuthAuthorizeUrl(url);
  assert.equal(flags.authorizeUrlIncludesVersionId, true);
  assert.equal(flags.authorizeUrlIncludesScope, true);
  assert.equal(flags.authorizeUrlIncludesState, true);
});

test("deriveGhlLocationDeliveryReadiness ready when connected probed and linked", () => {
  assert.equal(
    deriveGhlLocationDeliveryReadiness(connection()),
    "ready_for_delivery_config"
  );
});

test("revoked and synthetic test rows are not_delivery_capable", () => {
  assert.equal(
    deriveGhlLocationDeliveryReadiness(connection({ connectionStatus: "revoked" })),
    "not_delivery_capable"
  );
  assert.equal(
    deriveGhlLocationDeliveryReadiness(connection({ locationId: "loc_unlinked_cb" })),
    "not_delivery_capable"
  );
  assert.equal(isGhlTestLocationId("loc_inject_test"), true);
});

test("presentGhlLocationConnectionForAdmin adds readiness hint", () => {
  const item = presentGhlLocationConnectionForAdmin(connection());
  assert.equal(item.deliveryReadinessHint, "ready_for_delivery_config");
  assert.equal(item.isTestLocation, false);
});

test("reconciled webhook with connected location yields reconciled banner not pending", () => {
  const connections = [connection()];
  const banner = deriveGhlOAuthPageBanner({
    urlOauth: "pending_location",
    urlReason: null,
    connections,
    activePending: [],
    latestCallback: {
      at: new Date().toISOString(),
      requestId: "req_1",
      hasCode: true,
      hasState: true,
      stateValid: true,
      tokenExchangeStatusCode: 200,
      tokenExchangeError: null,
      databaseWriteOk: true,
      redirectTarget: "/ghl-connections?ghl_oauth=pending_location",
      outcome: "pending_location",
      tokenResponseShape: null,
      tokenLevel: "company_or_agency",
      pendingInstallId: "pending_1",
    },
    latestWebhook: {
      at: new Date().toISOString(),
      eventType: "INSTALL",
      appIdPresent: true,
      versionIdPresent: true,
      installTypePresent: false,
      locationIdPresent: true,
      companyIdPresent: true,
      userIdPresent: false,
      timestampPresent: false,
      webhookIdPresent: false,
      handled: true,
      reconcileNote: "reconciled_from_pending_connected",
    },
  });
  assert.ok(banner);
  assert.equal(banner?.tone, "success");
  assert.match(banner?.message ?? "", /reconciled/i);

  const summary = buildGhlOAuthReconciliationSummary({
    latestCallback: null,
    latestWebhook: {
      at: new Date().toISOString(),
      eventType: "INSTALL",
      appIdPresent: true,
      versionIdPresent: true,
      installTypePresent: false,
      locationIdPresent: true,
      companyIdPresent: true,
      userIdPresent: false,
      timestampPresent: false,
      webhookIdPresent: false,
      handled: true,
      reconcileNote: "reconciled_from_pending_connected",
    },
    connections,
  });
  assert.equal(summary.installWebhookReconciled, true);
  assert.equal(summary.deliveryCapable, true);
});

test("unresolved pending install shows pending banner", () => {
  const banner = deriveGhlOAuthPageBanner({
    urlOauth: null,
    urlReason: null,
    connections: [],
    activePending: [
      {
        id: "pending_1",
        clientAccountId: null,
        companyId: "co_1",
        userId: null,
        userType: "Company",
        appId: null,
        versionId: null,
        status: "pending_location",
        tokenExpiresAt: new Date().toISOString(),
        scopes: [],
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    latestCallback: null,
    latestWebhook: null,
  });
  assert.equal(banner?.tone, "info");
  assert.match(banner?.message ?? "", /pending/i);
});
