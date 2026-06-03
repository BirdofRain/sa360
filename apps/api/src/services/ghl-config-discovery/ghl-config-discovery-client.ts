/**
 * Read-only GHL API paths for config discovery (Phase 5B).
 * Adjust paths here if HighLevel API routes differ for your app version.
 */
import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import {
  getGhlWorkspaceSyncTimeoutMs,
} from "../../lib/ghl-workspace-sync-env.js";
import { resolveGhlBearerAuthForLocation } from "../ghl-oauth/ghl-auth-resolver.service.js";
import { logger } from "../../lib/logger.js";

const GHL_VERSION = "2021-07-28";
const DEFAULT_TIMEOUT_MS = 15_000;

export type GhlReadOnlyFetchResult = {
  ok: boolean;
  status: number;
  json: unknown;
  errorMessage: string | null;
};

export const GHL_CONFIG_DISCOVERY_PATHS = {
  location: (locationId: string) => `/locations/${encodeURIComponent(locationId)}`,
  pipelines: "/opportunities/pipelines",
  workflows: "/workflows/",
  users: "/users/",
  customFields: (locationId: string) =>
    `/locations/${encodeURIComponent(locationId)}/customFields`,
  tags: (locationId: string) => `/locations/${encodeURIComponent(locationId)}/tags`,
} as const;

export async function ghlReadOnlyGet(
  locationId: string,
  path: string,
  query?: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<GhlReadOnlyFetchResult> {
  const auth = await resolveGhlBearerAuthForLocation(locationId);
  if (!auth) {
    return {
      ok: false,
      status: 0,
      json: null,
      errorMessage: "No GHL OAuth connection for this location.",
    };
  }

  const base = getGhlOAuthApiBaseUrl();
  const timeoutMs = getGhlWorkspaceSyncTimeoutMs() || DEFAULT_TIMEOUT_MS;
  const qs = query ? `?${new URLSearchParams(query).toString()}` : "";
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}${qs}`;

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/json",
        Version: GHL_VERSION,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      logger.warn("ghl_config_discovery", {
        event: "read_failed",
        path,
        http_status: res.status,
        location_suffix: locationId.slice(-4),
      });
      let errorMessage = `HTTP ${res.status}`;
      if (json && typeof json === "object" && !Array.isArray(json)) {
        const o = json as Record<string, unknown>;
        const msg = o.message ?? o.error ?? o.msg;
        if (typeof msg === "string" && msg.trim()) errorMessage = msg.trim().slice(0, 200);
      }
      return { ok: false, status: res.status, json, errorMessage };
    }
    return { ok: true, status: res.status, json, errorMessage: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, json: null, errorMessage: msg.slice(0, 200) };
  }
}
