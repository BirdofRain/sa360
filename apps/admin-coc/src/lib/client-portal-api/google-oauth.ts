import "server-only";

import {
  CLIENT_PORTAL_ASSERTION_HEADER,
  createClientPortalAssertion,
} from "@sa360/shared/client-portal-assertion";

import type { PortalSessionPayload } from "../client-portal/portal-session.ts";
import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import { CLIENT_PORTAL_KEY_HEADER, getClientPortalApiKey } from "./keys.ts";

function requestConfig(session: PortalSessionPayload): {
  baseUrl: string;
  headers: Record<string, string>;
} | null {
  const baseUrl = getSa360PublicApiBaseUrl()?.replace(/\/+$/, "");
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) return null;
  return {
    baseUrl,
    headers: {
      [CLIENT_PORTAL_KEY_HEADER]: apiKey,
      [CLIENT_PORTAL_ASSERTION_HEADER]: createClientPortalAssertion(
        {
          clientAccountId: session.clientAccountId,
          portalSessionEpoch: session.portalSessionEpoch,
        },
        apiKey
      ),
      Accept: "application/json",
    },
  };
}

export async function startGoogleOAuthFromPortal(
  session: PortalSessionPayload,
  returnTo?: string
): Promise<{ ok: true; redirectUrl: string } | { ok: false; status: number; body: string }> {
  const config = requestConfig(session);
  if (!config) return { ok: false, status: 503, body: "Portal API is not configured" };
  const params = new URLSearchParams();
  if (returnTo) params.set("returnTo", returnTo);
  const suffix = params.size ? `?${params.toString()}` : "";
  try {
    const response = await fetch(
      `${config.baseUrl}/client/v1/integrations/google/oauth/start${suffix}`,
      { method: "GET", headers: config.headers, redirect: "manual", cache: "no-store" }
    );
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      return { ok: true, redirectUrl: location };
    }
    return { ok: false, status: response.status, body: await response.text() };
  } catch {
    return { ok: false, status: 502, body: "Google connection request failed" };
  }
}

export async function getGoogleStatusFromPortal(
  session: PortalSessionPayload
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const config = requestConfig(session);
  if (!config) return { ok: false, status: 503, body: "Portal API is not configured" };
  try {
    const response = await fetch(
      `${config.baseUrl}/client/v1/integrations/google/status`,
      { method: "GET", headers: config.headers, cache: "no-store" }
    );
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, body: text };
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 502, body: "Google status request failed" };
  }
}

export async function disconnectGoogleFromPortal(
  session: PortalSessionPayload
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; body: string }> {
  const config = requestConfig(session);
  if (!config) return { ok: false, status: 503, body: "Portal API is not configured" };
  try {
    const response = await fetch(
      `${config.baseUrl}/client/v1/integrations/google/disconnect`,
      { method: "POST", headers: config.headers, cache: "no-store" }
    );
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, body: text };
    return { ok: true, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 502, body: "Google disconnect request failed" };
  }
}
