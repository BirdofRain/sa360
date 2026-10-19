import "server-only";

import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import type { PortalSessionPayload } from "../client-portal/portal-session.ts";
import { getClientPortalApiKey } from "./keys.ts";
import { buildGooglePortalApiRequestConfig } from "./google-oauth-request.ts";

export async function fetchPortalBuyerAvailability(input: {
  session: PortalSessionPayload;
  nicheKey: string;
  states: string[];
  commerceAgeBucketKeys: string[];
  productType?: string | null;
}): Promise<{ ok: true; body: unknown } | { ok: false; status: number; body: string }> {
  const baseUrl = getSa360PublicApiBaseUrl();
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) {
    return { ok: false, status: 0, body: "Client portal API not configured" };
  }
  const config = buildGooglePortalApiRequestConfig({
    baseUrl,
    apiKey,
    session: input.session,
  });
  const response = await fetch(`${config.baseUrl}/client/v1/inventory/buyer-availability`, {
    method: "POST",
    headers: {
      ...config.headers,
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({
      nicheKey: input.nicheKey,
      states: input.states,
      commerceAgeBucketKeys: input.commerceAgeBucketKeys,
      ...(input.productType ? { productType: input.productType } : {}),
    }),
  });
  const text = await response.text();
  if (!response.ok) return { ok: false, status: response.status, body: text };
  try {
    return { ok: true, body: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false, status: 502, body: "Availability response was not readable" };
  }
}
