import type { GhlOAuthTokenResponseSafeShape } from "./ghl-oauth-token-shape.js";

/** In-memory latest OAuth callback attempt (safe fields only; single API instance). */

export type GhlOAuthDebugSnapshot = {
  at: string;
  requestId: string;
  hasCode: boolean;
  hasState: boolean;
  stateValid: boolean | null;
  tokenExchangeStatusCode: number | null;
  tokenExchangeError: string | null;
  databaseWriteOk: boolean | null;
  redirectTarget: string;
  outcome: string;
  tokenResponseShape: GhlOAuthTokenResponseSafeShape | null;
  tokenLevel: "location" | "company_or_agency" | "unknown" | null;
  pendingInstallId: string | null;
};

let latestOAuthDebug: GhlOAuthDebugSnapshot | null = null;

export function recordGhlOAuthDebug(snapshot: GhlOAuthDebugSnapshot): void {
  latestOAuthDebug = snapshot;
}

export function getLatestGhlOAuthDebug(): GhlOAuthDebugSnapshot | null {
  return latestOAuthDebug ? { ...latestOAuthDebug } : null;
}

export function clearGhlOAuthDebugForTests(): void {
  latestOAuthDebug = null;
}
