import "server-only";

import type {
  AdminMetricsSummary,
  AdminSynthflowListResponse,
  AdminWebhookListResponse,
} from "./types";

/** Must match `apps/api` (`admin-auth.ts`). */
export const ADMIN_KEY_HEADER = "x-sa360-admin-key";

/**
 * Public origin of the Fastify API (e.g. `http://localhost:3000`).
 * `NEXT_PUBLIC_*` is required for the browser if we later add client calls; server routes read it too.
 */
export function getAdminApiBaseUrl(): string | undefined {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

/**
 * Server-only key used to call `/admin/v1`. Prefer `SA360_ADMIN_API_KEY` in this app;
 * falls back to `ADMIN_API_KEY` so local dev can reuse the same value as the API process.
 * Never use `NEXT_PUBLIC_*` for this.
 */
export function getAdminApiKey(): string | undefined {
  const a = process.env.SA360_ADMIN_API_KEY?.trim();
  const b = process.env.ADMIN_API_KEY?.trim();
  return a || b || undefined;
}

export function isAdminApiConfigured(): boolean {
  return Boolean(getAdminApiBaseUrl() && getAdminApiKey());
}

type AdminFetchFailure = { ok: false; status: number; body: string };
type AdminFetchSuccess<T> = { ok: true; data: T };
type AdminFetchResult<T> = AdminFetchSuccess<T> | AdminFetchFailure;

export async function adminFetchJson<T>(path: string): Promise<AdminFetchResult<T>> {
  const baseUrl = getAdminApiBaseUrl();
  const apiKey = getAdminApiKey();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      status: 0,
      body:
        "Admin API is not configured. Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) for this Next.js app.",
    };
  }

  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    headers: {
      [ADMIN_KEY_HEADER]: apiKey,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, body: text || res.statusText };
  }

  try {
    const data = JSON.parse(text) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, status: res.status, body: "Invalid JSON from admin API" };
  }
}

function formatError(err: AdminFetchFailure): string {
  if (err.status === 0) return err.body;
  const snippet = err.body.length > 280 ? `${err.body.slice(0, 280)}…` : err.body;
  return `Admin API error (${err.status}): ${snippet}`;
}

export async function fetchAdminMetricsSummary(): Promise<{
  summary: AdminMetricsSummary | null;
  error: string | null;
}> {
  const res = await adminFetchJson<AdminMetricsSummary>("/admin/v1/metrics/summary");
  if (!res.ok) return { summary: null, error: formatError(res) };
  return { summary: res.data, error: null };
}

export async function fetchAdminWebhookRequests(options: { limit?: number } = {}): Promise<{
  items: AdminWebhookListResponse["items"];
  nextCursor: string | null;
  error: string | null;
}> {
  const limit = options.limit ?? 50;
  const res = await adminFetchJson<AdminWebhookListResponse>(
    `/admin/v1/webhook-requests?limit=${limit}`
  );
  if (!res.ok) return { items: [], nextCursor: null, error: formatError(res) };
  return { items: res.data.items, nextCursor: res.data.nextCursor, error: null };
}

export async function fetchAdminSynthflowRequests(options: { limit?: number } = {}): Promise<{
  items: AdminSynthflowListResponse["items"];
  nextCursor: string | null;
  error: string | null;
}> {
  const limit = options.limit ?? 50;
  const res = await adminFetchJson<AdminSynthflowListResponse>(
    `/admin/v1/synthflow-requests?limit=${limit}`
  );
  if (!res.ok) return { items: [], nextCursor: null, error: formatError(res) };
  return { items: res.data.items, nextCursor: res.data.nextCursor, error: null };
}
