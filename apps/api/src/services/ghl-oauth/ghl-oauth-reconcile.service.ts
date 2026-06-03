import { decryptGhlToken } from "../../lib/ghl-token-encryption.js";
import {
  findGhlLocationConnectionByLocationId,
  updateGhlLocationConnection,
} from "../../repositories/ghl-location-connection.repository.js";
import {
  findReconcilableGhlOAuthPendingInstall,
  updateGhlOAuthPendingInstall,
} from "../../repositories/ghl-oauth-pending-install.repository.js";
import {
  exchangeGhlLocationTokenFromCompanyAccessToken,
  shouldAttemptGhlLocationTokenConversion,
} from "./ghl-oauth-company-location-token.service.js";
import { fetchGhlLocationName } from "./ghl-oauth-client.service.js";
import type { GhlOAuthExchangeResult } from "./ghl-oauth-client.service.js";
import { persistOAuthTokensForLocation } from "./ghl-location-token.service.js";
import { presentGhlLocationConnection } from "./ghl-connection.present.js";

export type GhlOAuthReconcileInput = {
  locationId: string;
  companyId?: string | null;
  userId?: string | null;
  appId?: string | null;
  versionId?: string | null;
  clientAccountId?: string | null;
  fetchImpl?: typeof fetch;
};

export type GhlOAuthReconcileResult = {
  handled: boolean;
  connectionStatus: "connected" | "pending_token" | "pending_location" | null;
  connectionId: string | null;
  note: string;
};

async function resolveTokensForLocation(
  pendingTokens: GhlOAuthExchangeResult,
  locationId: string,
  fetchImpl: typeof fetch
): Promise<{ tokens: GhlOAuthExchangeResult; connectionStatus: "connected" | "pending_token" }> {
  if (
    pendingTokens.locationId?.trim() === locationId &&
    !shouldAttemptGhlLocationTokenConversion(pendingTokens.userType)
  ) {
    return { tokens: { ...pendingTokens, locationId }, connectionStatus: "connected" };
  }

  if (
    shouldAttemptGhlLocationTokenConversion(pendingTokens.userType) &&
    pendingTokens.companyId
  ) {
    const converted = await exchangeGhlLocationTokenFromCompanyAccessToken(
      {
        companyAccessToken: pendingTokens.accessToken,
        companyId: pendingTokens.companyId,
        locationId,
      },
      fetchImpl
    );
    if (converted.ok && converted.result.locationId) {
      return { tokens: converted.result, connectionStatus: "connected" };
    }
    return {
      tokens: { ...pendingTokens, locationId },
      connectionStatus: "pending_token",
    };
  }

  if (pendingTokens.locationId?.trim()) {
    return { tokens: pendingTokens, connectionStatus: "connected" };
  }

  return {
    tokens: { ...pendingTokens, locationId },
    connectionStatus: "pending_token",
  };
}

export type GhlOAuthReconcileDeps = {
  findPending?: typeof findReconcilableGhlOAuthPendingInstall;
  persistTokens?: typeof persistOAuthTokensForLocation;
  updatePending?: typeof updateGhlOAuthPendingInstall;
  updateConnection?: typeof updateGhlLocationConnection;
  findConnectionByLocationId?: typeof findGhlLocationConnectionByLocationId;
  fetchImpl?: typeof fetch;
};

export async function reconcileGhlOAuthPendingWithLocation(
  input: GhlOAuthReconcileInput,
  deps: GhlOAuthReconcileDeps = {}
): Promise<GhlOAuthReconcileResult> {
  const locationId = input.locationId.trim();
  if (!locationId) {
    return { handled: false, connectionStatus: null, connectionId: null, note: "missing_locationId" };
  }

  const fetchImpl = deps.fetchImpl ?? input.fetchImpl ?? fetch;
  const findPending = deps.findPending ?? findReconcilableGhlOAuthPendingInstall;
  const persistTokens = deps.persistTokens ?? persistOAuthTokensForLocation;
  const updatePending = deps.updatePending ?? updateGhlOAuthPendingInstall;
  const updateConnection = deps.updateConnection ?? updateGhlLocationConnection;
  const findByLocation = deps.findConnectionByLocationId ?? findGhlLocationConnectionByLocationId;

  const pending = await findPending({
    companyId: input.companyId,
    userId: input.userId,
    appId: input.appId,
  });

  if (!pending) {
    const existing = await findGhlLocationConnectionByLocationId(locationId);
    if (existing) {
      return {
        handled: true,
        connectionStatus: existing.connectionStatus as GhlOAuthReconcileResult["connectionStatus"],
        connectionId: existing.id,
        note: "connection_exists_no_pending_tokens",
      };
    }
    return {
      handled: false,
      connectionStatus: "pending_location",
      connectionId: null,
      note: "awaiting_oauth_tokens",
    };
  }

  const pendingTokens: GhlOAuthExchangeResult = {
    accessToken: decryptGhlToken(pending.accessTokenEncrypted),
    refreshToken: decryptGhlToken(pending.refreshTokenEncrypted),
    expiresAt: pending.tokenExpiresAt,
    scopes: Array.isArray(pending.scopes)
      ? pending.scopes.filter((s): s is string => typeof s === "string")
      : [],
    locationId: null,
    companyId: pending.companyId,
    userId: pending.userId,
    userType: pending.userType,
    appId: pending.appId ?? input.appId ?? null,
    tokenType: null,
    expiresIn: null,
  };

  const { tokens, connectionStatus } = await resolveTokensForLocation(
    pendingTokens,
    locationId,
    fetchImpl
  );

  const locationName = await fetchGhlLocationName(locationId, tokens.accessToken, fetchImpl);
  const row = await persistTokens({
    locationId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    clientAccountId: input.clientAccountId ?? pending.clientAccountId,
    locationName,
    companyId: tokens.companyId ?? input.companyId,
    userId: tokens.userId ?? input.userId,
    appId: tokens.appId ?? input.appId,
    connectionStatus,
  });

  if (connectionStatus === "pending_token") {
    await updateConnection(row.id, {
      lastError: "Location token conversion pending; company-level OAuth token stored.",
    });
  }

  await updatePending(pending.id, {
    status: "reconciled",
    lastError: null,
  });

  const updated = await findByLocation(locationId);
  return {
    handled: true,
    connectionStatus: updated?.connectionStatus as GhlOAuthReconcileResult["connectionStatus"] ?? connectionStatus,
    connectionId: updated?.id ?? row.id,
    note: `reconciled_from_pending_${connectionStatus}`,
  };
}

export function presentReconciledConnection(locationId: string) {
  return findGhlLocationConnectionByLocationId(locationId).then((row) =>
    row ? presentGhlLocationConnection(row) : null
  );
}
