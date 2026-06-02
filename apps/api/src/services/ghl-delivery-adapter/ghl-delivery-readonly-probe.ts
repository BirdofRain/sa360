import { resolveGhlBearerAuthForLocation } from "../ghl-oauth/ghl-auth-resolver.service.js";
import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";

export type GhlReadonlyProbeResult = {
  ok: boolean;
  locationId: string;
  detail: string;
  httpStatus: number | null;
  authMode?: "oauth" | "env_private_token";
};

/**
 * Read-only GET /locations/:id — no writes. Uses OAuth token for location when connected.
 * Never logs token values.
 */
export async function probeGhlLocationReadonly(
  locationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<GhlReadonlyProbeResult> {
  const trimmed = locationId.trim();
  if (!trimmed) {
    return { ok: false, locationId: "", detail: "No locationId provided.", httpStatus: null };
  }

  const auth = await resolveGhlBearerAuthForLocation(trimmed);
  if (!auth) {
    return {
      ok: false,
      locationId: trimmed,
      detail: "No GHL OAuth connection or env token configured; readonly probe skipped.",
      httpStatus: null,
    };
  }

  const base = getGhlOAuthApiBaseUrl();
  const url = `${base}/locations/${encodeURIComponent(trimmed)}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    });
    if (res.ok) {
      return {
        ok: true,
        locationId: trimmed,
        detail: `Location probe returned OK (read-only, auth=${auth.authMode}).`,
        httpStatus: res.status,
        authMode: auth.authMode,
      };
    }
    return {
      ok: false,
      locationId: trimmed,
      detail: `Location probe failed with HTTP ${res.status}.`,
      httpStatus: res.status,
      authMode: auth.authMode,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "probe failed";
    return { ok: false, locationId: trimmed, detail: msg, httpStatus: null, authMode: auth.authMode };
  }
}
