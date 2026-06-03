import type { GhlLocationConnection } from "@prisma/client";
import { encryptGhlToken } from "../../lib/ghl-token-encryption.js";
import { createGhlOAuthState, verifyGhlOAuthState } from "../../lib/ghl-oauth-state.js";
import {
  buildCocOAuthErrorRedirect,
  buildCocOAuthSuccessRedirect,
  getGhlOAuthScopesForAuthorize,
  getGhlOAuthStartConfigDebug,
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
  exchangeGhlOAuthAuthorizationCodeDetailed,
  fetchGhlLocationName,
  type GhlOAuthExchangeResult,
} from "./ghl-oauth-client.service.js";
import { logAndRecordGhlOAuthCallback } from "./ghl-oauth-callback-log.js";
import { getLatestGhlOAuthDebug } from "./ghl-oauth-debug.service.js";
import type { GhlOAuthDebugSnapshot } from "./ghl-oauth-debug.service.js";
import { getGhlAccessTokenForLocation, persistOAuthTokensForLocation } from "./ghl-location-token.service.js";
import { presentGhlLocationConnection } from "./ghl-connection.present.js";
import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import { logger } from "../../lib/logger.js";
import {
  buildGhlOAuthTokenResponseSafeShape,
  inferGhlOAuthTokenLevel,
} from "./ghl-oauth-token-shape.js";
import { persistPendingCompanyOrAgencyGhlOAuthInstall } from "./ghl-oauth-pending-install.service.js";
import { reconcileGhlOAuthPendingWithLocation } from "./ghl-oauth-reconcile.service.js";
import {
  getLatestGhlMarketplaceWebhookDebug,
  recordGhlMarketplaceWebhookDebug,
  type GhlMarketplaceWebhookSafeSnapshot,
} from "./ghl-oauth-webhook-debug.service.js";

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
  return {
    authorizeUrl,
    state,
    config: getGhlOAuthStartConfigDebug(authorizeUrl),
  };
}

export type GhlOAuthCallbackDeps = {
  fetchImpl?: typeof fetch;
  persistTokens?: (
    input: Parameters<typeof persistOAuthTokensForLocation>[0]
  ) => Promise<unknown>;
  persistPending?: (
    input: Parameters<typeof persistPendingCompanyOrAgencyGhlOAuthInstall>[0]
  ) => Promise<{ id: string }>;
};

async function persistExchangedGhlTokens(
  tokens: {
    locationId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    scopes: string[];
    companyId: string | null;
    userId: string | null;
    appId?: string | null;
  },
  clientAccountId: string | null | undefined,
  fetchImpl: typeof fetch,
  persistTokens: GhlOAuthCallbackDeps["persistTokens"]
): Promise<boolean> {
  const locationName = await fetchGhlLocationName(
    tokens.locationId,
    tokens.accessToken,
    fetchImpl
  );
  await persistTokens!({
    locationId: tokens.locationId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    clientAccountId: clientAccountId ?? null,
    locationName,
    companyId: tokens.companyId,
    userId: tokens.userId,
    appId: tokens.appId,
    connectionStatus: "connected",
  });
  return true;
}

function tokenDebugFromExchange(tokens: GhlOAuthExchangeResult): Pick<
  GhlOAuthDebugSnapshot,
  "tokenResponseShape" | "tokenLevel"
> {
  const shape = buildGhlOAuthTokenResponseSafeShape(tokens);
  return {
    tokenResponseShape: shape,
    tokenLevel: inferGhlOAuthTokenLevel(shape),
  };
}

async function storePendingOAuthWithoutLocation(
  tokens: GhlOAuthExchangeResult,
  clientAccountId: string | null | undefined,
  persistPending: GhlOAuthCallbackDeps["persistPending"]
): Promise<string> {
  const row = await persistPending!({ tokens, clientAccountId });
  return row.id;
}

export async function handleGhlOAuthCallback(
  input: { code: string; state: string; requestId: string },
  deps: GhlOAuthCallbackDeps = {}
) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const persistTokens = deps.persistTokens ?? persistOAuthTokensForLocation;
  const persistPending =
    deps.persistPending ?? persistPendingCompanyOrAgencyGhlOAuthInstall;
  const trimmedCode = input.code.trim();
  const trimmedState = input.state.trim();
  const hasCode = trimmedCode.length > 0;
  const hasState = trimmedState.length > 0;

  const finish = (fields: Omit<GhlOAuthDebugSnapshot, "at" | "requestId" | "hasCode" | "hasState">) => {
    logAndRecordGhlOAuthCallback({
      at: new Date().toISOString(),
      requestId: input.requestId,
      hasCode,
      hasState,
      tokenResponseShape: fields.tokenResponseShape ?? null,
      tokenLevel: fields.tokenLevel ?? null,
      pendingInstallId: fields.pendingInstallId ?? null,
      stateValid: fields.stateValid,
      tokenExchangeStatusCode: fields.tokenExchangeStatusCode,
      tokenExchangeError: fields.tokenExchangeError,
      databaseWriteOk: fields.databaseWriteOk,
      redirectTarget: fields.redirectTarget,
      outcome: fields.outcome,
    });
    return { redirectUrl: fields.redirectTarget };
  };

  if (!hasCode) {
    const redirectTarget = buildCocOAuthErrorRedirect("missing_code_or_state");
    return finish({
      stateValid: hasState ? false : null,
      tokenExchangeStatusCode: null,
      tokenExchangeError: null,
      databaseWriteOk: null,
      redirectTarget,
      outcome: "missing_code_or_state",
      tokenResponseShape: null,
      tokenLevel: null,
      pendingInstallId: null,
    });
  }

  const runAfterExchange = async (
    exchanged: Awaited<ReturnType<typeof exchangeGhlOAuthAuthorizationCodeDetailed>>,
    ctx: {
      stateValid: boolean | null;
      clientAccountId: string | null | undefined;
      returnTo?: string | null;
      successOutcome: "connected" | "connected_unlinked";
    }
  ) => {
    if (!exchanged.ok) {
      const redirectTarget = buildCocOAuthErrorRedirect(
        "token_exchange_failed",
        ctx.returnTo
      );
      return finish({
        stateValid: ctx.stateValid,
        tokenExchangeStatusCode: exchanged.httpStatus,
        tokenExchangeError: exchanged.errorMessage,
        databaseWriteOk: null,
        redirectTarget,
        outcome: "token_exchange_failed",
        tokenResponseShape: null,
        tokenLevel: null,
        pendingInstallId: null,
      });
    }

    const tokens = exchanged.result;
    const tokenDebug = tokenDebugFromExchange(tokens);
    const locationId = tokens.locationId?.trim() || null;

    if (!locationId) {
      try {
        const pendingId = await storePendingOAuthWithoutLocation(
          tokens,
          ctx.clientAccountId,
          persistPending
        );
        const redirectTarget = buildCocOAuthSuccessRedirect(
          "pending_location",
          null,
          ctx.returnTo
        );
        return finish({
          stateValid: ctx.stateValid,
          tokenExchangeStatusCode: 200,
          tokenExchangeError: null,
          databaseWriteOk: true,
          redirectTarget,
          outcome: "pending_location",
          pendingInstallId: pendingId,
          ...tokenDebug,
        });
      } catch {
        const redirectTarget = buildCocOAuthErrorRedirect("storage_failed", ctx.returnTo);
        return finish({
          stateValid: ctx.stateValid,
          tokenExchangeStatusCode: 200,
          tokenExchangeError: null,
          databaseWriteOk: false,
          redirectTarget,
          outcome: "storage_failed",
          pendingInstallId: null,
          ...tokenDebug,
        });
      }
    }

    try {
      await persistExchangedGhlTokens(
        { ...tokens, locationId },
        ctx.clientAccountId,
        fetchImpl,
        persistTokens
      );
    } catch {
      const redirectTarget = buildCocOAuthErrorRedirect("storage_failed", ctx.returnTo);
      return finish({
        stateValid: ctx.stateValid,
        tokenExchangeStatusCode: 200,
        tokenExchangeError: null,
        databaseWriteOk: false,
        redirectTarget,
        outcome: "storage_failed",
        pendingInstallId: null,
        ...tokenDebug,
      });
    }

    const redirectTarget = buildCocOAuthSuccessRedirect(
      ctx.successOutcome,
      locationId,
      ctx.returnTo
    );
    return finish({
      stateValid: ctx.stateValid,
      tokenExchangeStatusCode: 200,
      tokenExchangeError: null,
      databaseWriteOk: true,
      redirectTarget,
      outcome: ctx.successOutcome,
      pendingInstallId: null,
      ...tokenDebug,
    });
  };

  if (!hasState) {
    if (!isGhlOAuthConfigured()) {
      const redirectTarget = buildCocOAuthErrorRedirect("token_exchange_failed");
      return finish({
        stateValid: null,
        tokenExchangeStatusCode: null,
        tokenExchangeError: "oauth_not_configured",
        databaseWriteOk: null,
        redirectTarget,
        outcome: "token_exchange_failed",
        tokenResponseShape: null,
        tokenLevel: null,
        pendingInstallId: null,
      });
    }

    const exchanged = await exchangeGhlOAuthAuthorizationCodeDetailed(trimmedCode, fetchImpl);
    return runAfterExchange(exchanged, {
      stateValid: null,
      clientAccountId: null,
      successOutcome: "connected_unlinked",
    });
  }

  let payload: ReturnType<typeof verifyGhlOAuthState>;
  try {
    payload = verifyGhlOAuthState(trimmedState);
  } catch {
    const redirectTarget = buildCocOAuthErrorRedirect("state_invalid");
    return finish({
      stateValid: false,
      tokenExchangeStatusCode: null,
      tokenExchangeError: null,
      databaseWriteOk: null,
      redirectTarget,
      outcome: "state_invalid",
      tokenResponseShape: null,
      tokenLevel: null,
      pendingInstallId: null,
    });
  }

  const exchanged = await exchangeGhlOAuthAuthorizationCodeDetailed(trimmedCode, fetchImpl);
  return runAfterExchange(exchanged, {
    stateValid: true,
    clientAccountId: payload.clientAccountId,
    returnTo: payload.returnTo,
    successOutcome: "connected",
  });
}

export function getGhlOAuthDebugForAdmin() {
  return getLatestGhlOAuthDebug();
}

export function getGhlMarketplaceWebhookDebugForAdmin() {
  return getLatestGhlMarketplaceWebhookDebug();
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
  if (row.connectionStatus === "pending_token" || row.connectionStatus === "pending_location") {
    return {
      ok: false,
      connection: presentGhlLocationConnection(row),
      detail: "Connection is pending location token or install reconciliation.",
    };
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

/** Hard-delete a connection row (test cleanup only — e.g. loc_unlinked_cb). */
export async function purgeGhlConnection(id: string) {
  const row = await findGhlLocationConnectionById(id);
  if (!row) return { notFound: true as const };
  await deleteGhlLocationConnection(id);
  return { purged: true as const, locationId: row.locationId };
}

function parseMarketplaceWebhook(body: Record<string, unknown>) {
  const type =
    (typeof body.type === "string" ? body.type : null) ??
    (typeof body.event === "string" ? body.event : null);
  return {
    type: type?.trim().toUpperCase() ?? "",
    appId: typeof body.appId === "string" ? body.appId.trim() : null,
    versionId: typeof body.versionId === "string" ? body.versionId.trim() : null,
    installType: typeof body.installType === "string" ? body.installType.trim() : null,
    locationId: typeof body.locationId === "string" ? body.locationId.trim() : null,
    companyId: typeof body.companyId === "string" ? body.companyId.trim() : null,
    userId: typeof body.userId === "string" ? body.userId.trim() : null,
    timestamp:
      typeof body.timestamp === "string"
        ? body.timestamp.trim()
        : typeof body.timestamp === "number"
          ? String(body.timestamp)
          : null,
    webhookId:
      (typeof body.webhookId === "string" ? body.webhookId.trim() : null) ??
      (typeof body.id === "string" ? body.id.trim() : null),
  };
}

function recordWebhookDebug(
  parsed: ReturnType<typeof parseMarketplaceWebhook>,
  handled: boolean,
  reconcileNote: string | null
) {
  const snapshot: GhlMarketplaceWebhookSafeSnapshot = {
    at: new Date().toISOString(),
    eventType: parsed.type || null,
    appIdPresent: Boolean(parsed.appId),
    versionIdPresent: Boolean(parsed.versionId),
    installTypePresent: Boolean(parsed.installType),
    locationIdPresent: Boolean(parsed.locationId),
    companyIdPresent: Boolean(parsed.companyId),
    userIdPresent: Boolean(parsed.userId),
    timestampPresent: Boolean(parsed.timestamp),
    webhookIdPresent: Boolean(parsed.webhookId),
    handled,
    reconcileNote,
  };
  recordGhlMarketplaceWebhookDebug(snapshot);
  return snapshot;
}

export type GhlMarketplaceWebhookDeps = {
  fetchImpl?: typeof fetch;
  reconcile?: typeof reconcileGhlOAuthPendingWithLocation;
  findConnectionByLocationId?: typeof findGhlLocationConnectionByLocationId;
  updateConnection?: typeof updateGhlLocationConnection;
};

export async function handleGhlMarketplaceWebhook(
  payload: unknown,
  opts?: GhlMarketplaceWebhookDeps
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    recordWebhookDebug(
      {
        type: "",
        appId: null,
        versionId: null,
        installType: null,
        locationId: null,
        companyId: null,
        userId: null,
        timestamp: null,
        webhookId: null,
      },
      false,
      "invalid_payload"
    );
    return { accepted: true, handled: false };
  }

  const body = payload as Record<string, unknown>;
  const parsed = parseMarketplaceWebhook(body);

  logger.info("ghl_marketplace_webhook", {
    event: "received",
    type: parsed.type || "unknown",
    location_suffix: parsed.locationId ? parsed.locationId.slice(-4) : null,
  });

  const findByLocation = opts?.findConnectionByLocationId ?? findGhlLocationConnectionByLocationId;
  const updateConnection = opts?.updateConnection ?? updateGhlLocationConnection;
  const reconcileImpl = opts?.reconcile ?? reconcileGhlOAuthPendingWithLocation;

  if (parsed.type === "UNINSTALL" && parsed.locationId) {
    const row = await findByLocation(parsed.locationId);
    if (row) {
      await updateConnection(row.id, {
        connectionStatus: "revoked",
        lastError: "App uninstalled via marketplace webhook.",
      });
    }
    recordWebhookDebug(parsed, true, row ? "location_revoked" : "no_connection");
    return { accepted: true, handled: true, type: parsed.type, locationId: parsed.locationId };
  }

  if (parsed.type === "INSTALL" && parsed.locationId) {
    const reconcile = await reconcileImpl(
      {
        locationId: parsed.locationId,
        companyId: parsed.companyId,
        userId: parsed.userId,
        appId: parsed.appId,
        versionId: parsed.versionId,
        fetchImpl: opts?.fetchImpl,
      },
      { fetchImpl: opts?.fetchImpl }
    );
    recordWebhookDebug(parsed, true, reconcile.note);
    return {
      accepted: true,
      handled: true,
      type: parsed.type,
      locationId: parsed.locationId,
      connectionStatus: reconcile.connectionStatus,
      connectionId: reconcile.connectionId,
      note: reconcile.note,
    };
  }

  if (parsed.type === "INSTALL") {
    recordWebhookDebug(parsed, true, "install_without_locationId");
    return { accepted: true, handled: true, type: parsed.type, note: "install_without_locationId" };
  }

  recordWebhookDebug(parsed, false, null);
  return { accepted: true, handled: false, type: parsed.type || "unknown" };
}

export function getGhlConnectionByIdPresented(id: string) {
  return findGhlLocationConnectionById(id).then((row) =>
    row ? presentGhlLocationConnection(row) : null
  );
}

export type { GhlLocationConnection };
