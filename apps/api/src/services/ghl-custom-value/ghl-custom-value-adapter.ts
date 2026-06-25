/**
 * Narrow GHL custom-value adapter: list / create / update only.
 *
 * Scope is deliberately limited to non-secret custom values for the SA360 client profile mirror.
 * Server-side only — never returns or logs OAuth tokens. Reuses the existing per-location OAuth
 * resolver (falls back to env private token for dev/pilot).
 */
import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import { resolveGhlBearerAuthForLocation } from "../ghl-oauth/ghl-auth-resolver.service.js";
import { logger } from "../../lib/logger.js";

const GHL_VERSION = "2021-07-28";
const DEFAULT_TIMEOUT_MS = 15_000;

export type GhlCustomValue = {
  id: string;
  name: string;
  value: string;
};

export type GhlCustomValueListResult =
  | { ok: true; items: GhlCustomValue[] }
  | { ok: false; error: string; status: number };

export type GhlCustomValueWriteResult =
  | { ok: true; item: GhlCustomValue }
  | { ok: false; error: string; status: number };

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function parseCustomValues(json: unknown): GhlCustomValue[] {
  let arr: unknown[] = [];
  if (Array.isArray(json)) arr = json;
  else if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const key of ["customValues", "custom_values", "data", "items"]) {
      if (Array.isArray(o[key])) {
        arr = o[key] as unknown[];
        break;
      }
    }
  }
  return arr
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
      const id = str(o.id);
      const name = str(o.name);
      if (!id && !name) return null;
      return { id, name, value: str(o.value) };
    })
    .filter((x): x is GhlCustomValue => x !== null);
}

function parseSingleCustomValue(json: unknown): GhlCustomValue | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const candidate =
    (root.customValue && typeof root.customValue === "object"
      ? (root.customValue as Record<string, unknown>)
      : null) ?? root;
  const id = str(candidate.id);
  const name = str(candidate.name);
  if (!id && !name) return null;
  return { id, name, value: str(candidate.value) };
}

async function ghlAuthedRequest(
  locationId: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: boolean; status: number; json: unknown; errorMessage: string | null }> {
  const auth = await resolveGhlBearerAuthForLocation(locationId);
  if (!auth) {
    return { ok: false, status: 0, json: null, errorMessage: "No GHL OAuth connection for this location." };
  }
  const base = getGhlOAuthApiBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: "application/json",
        Version: GHL_VERSION,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      logger.warn("ghl_custom_value_adapter", {
        event: "request_failed",
        method,
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

export async function listGhlCustomValues(
  locationId: string,
  fetchImpl: typeof fetch = fetch
): Promise<GhlCustomValueListResult> {
  const res = await ghlAuthedRequest(
    locationId,
    "GET",
    `/locations/${encodeURIComponent(locationId.trim())}/customValues`,
    undefined,
    fetchImpl
  );
  if (!res.ok) return { ok: false, error: res.errorMessage ?? "Failed to list custom values.", status: res.status };
  return { ok: true, items: parseCustomValues(res.json) };
}

export async function createGhlCustomValue(
  locationId: string,
  input: { name: string; value: string },
  fetchImpl: typeof fetch = fetch
): Promise<GhlCustomValueWriteResult> {
  const res = await ghlAuthedRequest(
    locationId,
    "POST",
    `/locations/${encodeURIComponent(locationId.trim())}/customValues`,
    { name: input.name, value: input.value },
    fetchImpl
  );
  if (!res.ok) return { ok: false, error: res.errorMessage ?? "Create failed.", status: res.status };
  const item = parseSingleCustomValue(res.json) ?? { id: "", name: input.name, value: input.value };
  return { ok: true, item };
}

export async function updateGhlCustomValue(
  locationId: string,
  id: string,
  input: { name: string; value: string },
  fetchImpl: typeof fetch = fetch
): Promise<GhlCustomValueWriteResult> {
  const res = await ghlAuthedRequest(
    locationId,
    "PUT",
    `/locations/${encodeURIComponent(locationId.trim())}/customValues/${encodeURIComponent(id)}`,
    { name: input.name, value: input.value },
    fetchImpl
  );
  if (!res.ok) return { ok: false, error: res.errorMessage ?? "Update failed.", status: res.status };
  const item = parseSingleCustomValue(res.json) ?? { id, name: input.name, value: input.value };
  return { ok: true, item };
}
