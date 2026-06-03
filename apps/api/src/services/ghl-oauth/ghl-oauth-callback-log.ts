import { logger } from "../../lib/logger.js";
import type { GhlOAuthDebugSnapshot } from "./ghl-oauth-debug.service.js";
import { recordGhlOAuthDebug } from "./ghl-oauth-debug.service.js";

const SECRET_PATTERN = /access_token|refresh_token|client_secret/i;

export function safeGhlOAuthErrorMessageFromBody(httpStatus: number, bodyText: string): string {
  const trimmed = bodyText.trim();
  if (!trimmed) return `HTTP ${httpStatus}`;
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    for (const key of ["error_description", "error", "message"]) {
      const val = json[key];
      if (typeof val === "string" && val.trim() && !SECRET_PATTERN.test(val)) {
        return val.trim().slice(0, 240);
      }
    }
  } catch {
    /* ignore parse errors */
  }
  if (SECRET_PATTERN.test(trimmed)) return `HTTP ${httpStatus}`;
  return trimmed.slice(0, 240);
}

export function logAndRecordGhlOAuthCallback(snapshot: GhlOAuthDebugSnapshot): void {
  recordGhlOAuthDebug(snapshot);
  logger.info("ghl_oauth_callback", {
    request_id: snapshot.requestId,
    has_code: snapshot.hasCode,
    has_state: snapshot.hasState,
    state_valid: snapshot.stateValid,
    token_exchange_status_code: snapshot.tokenExchangeStatusCode,
    token_exchange_error: snapshot.tokenExchangeError,
    database_write_ok: snapshot.databaseWriteOk,
    redirect_target: snapshot.redirectTarget,
    outcome: snapshot.outcome,
    token_level: snapshot.tokenLevel,
    pending_install_id: snapshot.pendingInstallId,
    token_response_shape: snapshot.tokenResponseShape,
  });
}

export function assertSafeOAuthDebugPayload(obj: Record<string, unknown>): void {
  const json = JSON.stringify(obj);
  assertNoSecretsInString(json);
}

export function assertNoSecretsInString(text: string): void {
  if (SECRET_PATTERN.test(text)) {
    throw new Error("OAuth debug/log payload must not contain secrets or tokens.");
  }
}
