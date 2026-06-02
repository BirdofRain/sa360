import { getGhlWorkspaceSyncPrivateToken } from "../../lib/ghl-workspace-sync-env.js";
import {
  resolveGhlAccessTokenForLocation,
  type GhlLocationAuthMode,
} from "./ghl-location-token.service.js";

export type ResolvedGhlBearerAuth = {
  token: string;
  authMode: GhlLocationAuthMode;
};

/**
 * Prefer per-location OAuth token; fall back to env private integration token for dev/pilot.
 * Server-side only — never expose token to browser.
 */
export async function resolveGhlBearerAuthForLocation(
  locationId: string | null | undefined
): Promise<ResolvedGhlBearerAuth | null> {
  const trimmed = locationId?.trim();
  if (trimmed) {
    try {
      const oauth = await resolveGhlAccessTokenForLocation(trimmed);
      if (oauth) {
        return { token: oauth.accessToken, authMode: oauth.authMode };
      }
    } catch {
      /* fall through to env token if OAuth refresh failed and env exists */
    }
  }

  const envToken = getGhlWorkspaceSyncPrivateToken();
  if (envToken) {
    return { token: envToken, authMode: "env_private_token" };
  }

  return null;
}
