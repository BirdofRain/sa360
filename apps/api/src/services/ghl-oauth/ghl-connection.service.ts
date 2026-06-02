import type { GhlLocationConnection } from "@prisma/client";
import { encryptGhlToken } from "../../lib/ghl-token-encryption.js";
import { createGhlOAuthState, verifyGhlOAuthState } from "../../lib/ghl-oauth-state.js";
import {
  buildCocRedirectUrl,
  getGhlOAuthScopesForAuthorize,
  isGhlOAuthConfigured,
} from "../../lib/ghl-oauth-env.js";
import {
  deleteGhlLocationConnection,
  findGhlLocationConnectionById,
  findGhlLocationConnectionByLocationId,
  listGhlLocationConnections,
  updateGhlLocationConnection,
} from "../../repositories/ghl-location-connection.repository.js";
import {
  buildGhlOAuthAuthorizeUrl,
  exchangeGhlOAuthAuthorizationCode,
  fetchGhlLocationName,
} from "./ghl-oauth-client.service.js";
import { getGhlAccessTokenForLocation, persistOAuthTokensForLocation } from "./ghl-location-token.service.js";
import { presentGhlLocationConnection } from "./ghl-connection.present.js";
import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import { logger } from "../../lib/logger.js";

export function startGhlOAuthFlow(input: {
  clientAccountId?: string | null;
  returnTo?: string | null;
}) {
  if (!isGhlOAuthConfigured()) {
    const missingScopes = !getGhlOAuthScopesForAuthorize();
    return {
      error: missingScopes
        ? ("GHL_OAUTH_SCOPES is not configured. Set a non-empty space-separated scope list." as const)
        : ("GHL OAuth is not fully configured on the API." as const),
    };
  }
  const state = createGhlOAuthState({
    clientAccountId: input.clientAccountId,
    returnTo: input.returnTo,
  });
  const authorizeUrl = buildGhlOAuthAuthorizeUrl(state);
  return { authorizeUrl, state };
}

export async function handleGhlOAuthCallback(
  code: string,
  state: string,
  fetchImpl: typeof fetch = fetch
) {
  const payload = verifyGhlOAuthState(state);
  const exchanged = await exchangeGhlOAuthAuthorizationCode(code, fetchImpl);

  const locationId = exchanged.locationId;
  if (!locationId) {
    const returnPath = buildCocRedirectUrl(payload.returnTo);
    return {
      error:
        "OAuth completed but no locationId was returned. Install at sub-account level or wait for INSTALL webhook.",
      redirectUrl: `${returnPath}${returnPath.includes("?") ? "&" : "?"}ghl_oauth=error&reason=missing_location`,
    };
  }

  const locationName = await fetchGhlLocationName(locationId, exchanged.accessToken, fetchImpl);
  await persistOAuthTokensForLocation({
    locationId,
    accessToken: exchanged.accessToken,
    refreshToken: exchanged.refreshToken,
    expiresAt: exchanged.expiresAt,
    scopes: exchanged.scopes,
    clientAccountId: payload.clientAccountId,
    locationName,
    companyId: exchanged.companyId,
    userId: exchanged.userId,
  });

  const returnPath = buildCocRedirectUrl(payload.returnTo);
  const sep = returnPath.includes("?") ? "&" : "?";
  return {
    redirectUrl: `${returnPath}${sep}ghl_oauth=connected&locationId=${encodeURIComponent(locationId)}`,
  };
}

export async function listGhlConnectionsPresented(
  opts: Parameters<typeof listGhlLocationConnections>[0]
) {
  const rows = await listGhlLocationConnections(opts);
  return rows.map(presentGhlLocationConnection);
}

export async function probeGhlConnection(id: string, fetchImpl: typeof fetch = fetch) {
  const row = await findGhlLocationConnectionById(id);
  if (!row) return { notFound: true as const };
  if (row.connectionStatus === "revoked") {
    return { ok: false, connection: presentGhlLocationConnection(row), detail: "Connection revoked." };
  }

  try {
    const token = await getGhlAccessTokenForLocation(row.locationId, { fetchImpl });
    const base = getGhlOAuthApiBaseUrl();
    const res = await fetchImpl(`${base}/locations/${encodeURIComponent(row.locationId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    });
    const ok = res.ok;
    const updated = await updateGhlLocationConnection(row.id, {
      lastProbeAt: new Date(),
      connectionStatus: ok ? "connected" : "error",
      lastError: ok ? null : `Location probe HTTP ${res.status}`,
    });
    return {
      ok,
      connection: presentGhlLocationConnection(updated),
      detail: ok ? "Location probe OK (read-only)." : `Probe failed HTTP ${res.status}.`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const updated = await updateGhlLocationConnection(row.id, {
      lastProbeAt: new Date(),
      connectionStatus: "error",
      lastError: msg,
    });
    return { ok: false, connection: presentGhlLocationConnection(updated), detail: msg };
  }
}

export async function linkGhlConnectionToClient(id: string, clientAccountId: string) {
  const trimmed = clientAccountId.trim();
  if (!trimmed) return { error: "clientAccountId is required." as const };
  const row = await findGhlLocationConnectionById(id);
  if (!row) return { notFound: true as const };
  const updated = await updateGhlLocationConnection(id, { clientAccountId: trimmed });
  return { connection: presentGhlLocationConnection(updated) };
}

export async function disconnectGhlConnection(id: string) {
  const row = await findGhlLocationConnectionById(id);
  if (!row) return { notFound: true as const };
  const cleared = encryptGhlToken("");
  const updated = await updateGhlLocationConnection(id, {
    connectionStatus: "revoked",
    accessTokenEncrypted: cleared,
    refreshTokenEncrypted: cleared,
    tokenExpiresAt: new Date(0),
    lastError: "Disconnected by operator.",
  });
  return { connection: presentGhlLocationConnection(updated) };
}

export async function handleGhlMarketplaceWebhook(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { accepted: true, handled: false };
  }
  const body = payload as Record<string, unknown>;
  const type = typeof body.type === "string" ? body.type.toUpperCase() : "";
  const locationId = typeof body.locationId === "string" ? body.locationId.trim() : null;
  const companyId = typeof body.companyId === "string" ? body.companyId.trim() : null;
  const appId = typeof body.appId === "string" ? body.appId.trim() : null;

  logger.info("ghl_marketplace_webhook", {
    event: "received",
    type: type || "unknown",
    location_suffix: locationId ? locationId.slice(-4) : null,
  });

  if ((type === "INSTALL" || type === "UNINSTALL") && locationId) {
    if (type === "UNINSTALL") {
      const row = await findGhlLocationConnectionByLocationId(locationId);
      if (row) {
        await updateGhlLocationConnection(row.id, {
          connectionStatus: "revoked",
          lastError: "App uninstalled via marketplace webhook.",
        });
      }
      return { accepted: true, handled: true, type, locationId };
    }
    // INSTALL without tokens — reconcile when OAuth callback completes; TODO passive reconciliation
    logger.info("ghl_marketplace_webhook", {
      event: "install_noted",
      location_suffix: locationId.slice(-4),
      companyId: companyId ? companyId.slice(-4) : null,
      appId: appId ? appId.slice(-4) : null,
    });
    return { accepted: true, handled: true, type, locationId, note: "install_logged_pending_oauth_tokens" };
  }

  // TODO: future passive reconciliation for Contact/Opportunity/Appointment events
  return { accepted: true, handled: false, type: type || "unknown" };
}

export function getGhlConnectionByIdPresented(id: string) {
  return findGhlLocationConnectionById(id).then((row) =>
    row ? presentGhlLocationConnection(row) : null
  );
}

export type { GhlLocationConnection };
