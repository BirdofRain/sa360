import "server-only";

import type { ClientPortalDashboard, ClientPortalRangeKey } from "../client-portal/types.ts";
import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import { resolveRangeBounds } from "../client-portal/range.ts";
import {
  CLIENT_PORTAL_KEY_HEADER,
  getClientPortalApiKey,
  isClientPortalApiConfigured,
} from "./keys.ts";
export {
  fetchPortalClientContext,
  type PortalClientContextResponse,
} from "./portal-context.ts";

export { CLIENT_PORTAL_KEY_HEADER, getClientPortalApiKey, isClientPortalApiConfigured };

type FetchFailure = { ok: false; status: number; body: string };
type FetchSuccess<T> = { ok: true; data: T };
type FetchResult<T> = FetchSuccess<T> | FetchFailure;

export type ClientPortalDashboardQuery = {
  range: ClientPortalRangeKey;
  clientAccountId: string;
};

export async function fetchClientPortalDashboard(
  query: ClientPortalDashboardQuery
): Promise<FetchResult<ClientPortalDashboard>> {
  const baseUrl = getSa360PublicApiBaseUrl();
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }

  const { from, to } = resolveRangeBounds(query.range);
  const params = new URLSearchParams({
    range: query.range,
    from: from.toISOString(),
    to: to.toISOString(),
    clientAccountId: query.clientAccountId,
  });

  const url = `${baseUrl.replace(/\/$/, "")}/client/v1/dashboard?${params.toString()}`;

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: apiKey,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, body: text };
    }
    const data = JSON.parse(text) as ClientPortalDashboard;
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, body: msg };
  }
}

async function clientPortalFetchJson<T>(
  path: string,
  init?: RequestInit
): Promise<FetchResult<T>> {
  const baseUrl = getSa360PublicApiBaseUrl();
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }
  const url = `${baseUrl.replace(/\/$/, "")}${path}`;
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        [CLIENT_PORTAL_KEY_HEADER]: apiKey,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text };
    return { ok: true, data: JSON.parse(text) as T };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, body: msg };
  }
}

export async function fetchClientLeadOrdersList(opts: {
  clientAccountId: string;
  status?: string;
  nicheKey?: string;
}): Promise<{ items: unknown[]; error: string | null }> {
  const params = new URLSearchParams({ clientAccountId: opts.clientAccountId });
  if (opts.status) params.set("status", opts.status);
  if (opts.nicheKey) params.set("nicheKey", opts.nicheKey);
  const res = await clientPortalFetchJson<{ ok: boolean; items: unknown[] }>(
    `/client/v1/lead-orders?${params.toString()}`
  );
  if (!res.ok) return { items: [], error: res.body };
  return { items: res.data.items ?? [], error: null };
}

export async function createClientLeadOrder(opts: {
  clientAccountId: string;
  body: Record<string, unknown>;
}): Promise<{ item: unknown | null; error: string | null }> {
  const params = new URLSearchParams({ clientAccountId: opts.clientAccountId });
  const res = await clientPortalFetchJson<{ ok: boolean; item: unknown }>(
    `/client/v1/lead-orders?${params.toString()}`,
    { method: "POST", body: JSON.stringify(opts.body) }
  );
  if (!res.ok) return { item: null, error: res.body };
  return { item: res.data.item, error: null };
}

export type ClientLeadsOnDemandAvailabilityRow = {
  nicheKey: string;
  productType: string | null;
  state: string;
  ageBandLabel: string;
  inventoryClass: string;
  exclusivityMode: string;
  availabilityLabel: "Available" | "Limited" | "Currently unavailable";
  unitPriceCents: number | null;
  evaluatedAt: string;
};

export type ClientLeadsOnDemandAvailabilityResult = {
  rows: ClientLeadsOnDemandAvailabilityRow[];
  evaluatedAt: string | null;
  dataSource: "live" | "empty";
  error: string | null;
};

export async function fetchClientLeadsOnDemandAvailability(opts: {
  clientAccountId: string;
  nicheKey?: string;
  productType?: string;
}): Promise<ClientLeadsOnDemandAvailabilityResult> {
  if (!isClientPortalApiConfigured()) {
    return {
      rows: [],
      evaluatedAt: null,
      dataSource: "empty",
      error: "Client portal API not configured",
    };
  }

  const params = new URLSearchParams({ clientAccountId: opts.clientAccountId });
  if (opts.nicheKey) params.set("nicheKey", opts.nicheKey);
  if (opts.productType) params.set("productType", opts.productType);

  const res = await clientPortalFetchJson<{
    ok: boolean;
    availability: {
      rows: ClientLeadsOnDemandAvailabilityRow[];
      evaluatedAt: string;
    };
  }>(`/client/v1/leads-on-demand/availability?${params.toString()}`);

  if (!res.ok) {
    return {
      rows: [],
      evaluatedAt: null,
      dataSource: "empty",
      error: res.body,
    };
  }

  return {
    rows: res.data.availability?.rows ?? [],
    evaluatedAt: res.data.availability?.evaluatedAt ?? null,
    dataSource: "live",
    error: null,
  };
}
