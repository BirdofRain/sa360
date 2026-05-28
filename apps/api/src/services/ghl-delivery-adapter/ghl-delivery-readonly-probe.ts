import { getGhlWorkspaceSyncApiBaseUrl, getGhlWorkspaceSyncPrivateToken } from "../../lib/ghl-workspace-sync-env.js";

export type GhlReadonlyProbeResult = {
  ok: boolean;
  locationId: string;
  detail: string;
  httpStatus: number | null;
};

/**
 * Read-only GET /locations/:id — no writes. Returns skipped if token missing.
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
  const token = getGhlWorkspaceSyncPrivateToken();
  if (!token) {
    return {
      ok: false,
      locationId: trimmed,
      detail: "GHL token not configured; readonly probe skipped.",
      httpStatus: null,
    };
  }
  const base = getGhlWorkspaceSyncApiBaseUrl();
  const url = `${base}/locations/${encodeURIComponent(trimmed)}`;
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: "2021-07-28",
        Accept: "application/json",
      },
    });
    if (res.ok) {
      return {
        ok: true,
        locationId: trimmed,
        detail: "Location probe returned OK (read-only).",
        httpStatus: res.status,
      };
    }
    return {
      ok: false,
      locationId: trimmed,
      detail: `Location probe failed with HTTP ${res.status}.`,
      httpStatus: res.status,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "probe failed";
    return { ok: false, locationId: trimmed, detail: msg, httpStatus: null };
  }
}
