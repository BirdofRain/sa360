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
