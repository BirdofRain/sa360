/**
 * Read-only GHL API paths for config discovery (Phase 5B).
 * Adjust paths here if HighLevel API routes differ for your app version.
 */
import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import {
  providerSignalsAuthentication,
  redactGhlDiscoveryText,
} from "../../lib/ghl-config-snapshot-validity.js";
import {
  getGhlWorkspaceSyncTimeoutMs,
} from "../../lib/ghl-workspace-sync-env.js";
import { resolveGhlBearerAuthForLocation } from "../ghl-oauth/ghl-auth-resolver.service.js";
import { logger } from "../../lib/logger.js";

const GHL_VERSION = "2021-07-28";
const DEFAULT_TIMEOUT_MS = 15_000;

export type GhlReadFailureClass =
  | "authentication"
  | "provider_outage"
  | "timeout"
  | "network"
  | "malformed"
  | "http_error"
  | "no_auth";

export type GhlReadOnlyFetchResult = {
  ok: boolean;
  status: number;
  json: unknown;
  errorMessage: string | null;
  failureClass: GhlReadFailureClass | null;
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
      failureClass: "no_auth",
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
      const classified = classifyHttpFailure(res.status, json);
      return { ok: false, status: res.status, json, ...classified };
    }
    if (text && json === null) {
      return {
        ok: false,
        status: res.status,
        json,
        errorMessage: "Response was not valid JSON.",
        failureClass: "malformed",
      };
    }
    if (!text) {
      return {
        ok: false,
        status: res.status,
        json: null,
        errorMessage: "Response was empty.",
        failureClass: "malformed",
      };
    }
    const providerMessage = providerErrorMessage(json);
    if (providerSignalsAuthentication(providerMessage)) {
      return {
        ok: false,
        status: res.status,
        json,
        errorMessage: redactGhlDiscoveryText(providerMessage ?? "Invalid JWT"),
        failureClass: "authentication",
      };
    }
    return { ok: true, status: res.status, json, errorMessage: null, failureClass: null };
  } catch (err) {
    const timeout = isTimeoutError(err);
    const raw = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      status: 0,
      json: null,
      errorMessage: redactGhlDiscoveryText(raw || (timeout ? "timed out" : "network error")),
      failureClass: timeout ? "timeout" : "network",
    };
  }
}

function classifyHttpFailure(
  status: number,
  json: unknown
): { errorMessage: string; failureClass: GhlReadFailureClass } {
  const providerMessage = providerErrorMessage(json);
  const errorMessage = redactGhlDiscoveryText(providerMessage ?? `HTTP ${status}`);
  if (status === 401 || providerSignalsAuthentication(providerMessage)) {
    return { errorMessage, failureClass: "authentication" };
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { errorMessage, failureClass: "provider_outage" };
  }
  return { errorMessage, failureClass: "http_error" };
}

function providerErrorMessage(json: unknown): string | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const message = (json as Record<string, unknown>).message ?? (json as Record<string, unknown>).error ?? (json as Record<string, unknown>).msg;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}

function isTimeoutError(err: unknown): boolean {
  if (typeof err === "object" && err && "name" in err) {
    const name = String((err as { name: unknown }).name);
    if (name === "TimeoutError" || name === "AbortError") return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /timeout|aborted due to timeout/i.test(message);
}
