import "server-only";

import type { ClientPortalDashboard, ClientPortalRangeKey } from "@/lib/client-portal/types";
import { getSa360PublicApiBaseUrl } from "@/lib/sa360-public-api-base-url";
import { resolveRangeBounds } from "@/lib/client-portal/range";
import {
  CLIENT_PORTAL_KEY_HEADER,
  getClientPortalApiKey,
  isClientPortalApiConfigured,
} from "./keys";

export { CLIENT_PORTAL_KEY_HEADER, getClientPortalApiKey, isClientPortalApiConfigured };

type FetchFailure = { ok: false; status: number; body: string };
type FetchSuccess<T> = { ok: true; data: T };
type FetchResult<T> = FetchSuccess<T> | FetchFailure;

export type PortalClientContextResponse = {
  clientAccountId: string;
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  portalEnabled: boolean;
  locationName: string | null;
  subaccountIdGhl: string | null;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
};

export type ClientPortalDashboardQuery = {
  range: ClientPortalRangeKey;
  clientAccountId: string;
};

export async function fetchPortalClientContext(
  loginEmail: string
): Promise<FetchResult<PortalClientContextResponse>> {
  const baseUrl = getSa360PublicApiBaseUrl();
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }

  const params = new URLSearchParams({
    loginEmail: loginEmail.trim().toLowerCase(),
  });
  const url = `${baseUrl.replace(/\/$/, "")}/client/v1/portal-context?${params.toString()}`;

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
    const json = JSON.parse(text) as { context: PortalClientContextResponse };
    return { ok: true, data: json.context };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch failed";
    return { ok: false, status: 0, body: msg };
  }
}

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
