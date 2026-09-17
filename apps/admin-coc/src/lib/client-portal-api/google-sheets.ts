import "server-only";

import type { PortalSessionPayload } from "../client-portal/portal-session.ts";
import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import { getClientPortalApiKey } from "./keys.ts";
import { buildGooglePortalApiRequestConfig } from "./google-oauth-request.ts";

function requestConfig(session: PortalSessionPayload): {
  baseUrl: string;
  headers: Record<string, string>;
} | null {
  const baseUrl = getSa360PublicApiBaseUrl()?.replace(/\/+$/, "");
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) return null;
  return buildGooglePortalApiRequestConfig({ baseUrl, apiKey, session });
}

async function portalSheetsRequest(
  session: PortalSessionPayload,
  path: string,
  init: RequestInit
): Promise<{ ok: true; status: number; data: unknown } | { ok: false; status: number; body: string }> {
  const config = requestConfig(session);
  if (!config) return { ok: false, status: 503, body: "Portal API is not configured" };
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...init,
      headers: {
        ...config.headers,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, body: text };
    return { ok: true, status: response.status, data: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 502, body: "Google Sheets request failed" };
  }
}

export function resolveGoogleSheetFromPortal(
  session: PortalSessionPayload,
  spreadsheet: string
) {
  return portalSheetsRequest(session, "/client/v1/integrations/google/sheets/resolve", {
    method: "POST",
    body: JSON.stringify({ spreadsheet }),
  });
}

export function createGoogleSheetFromPortal(session: PortalSessionPayload, title?: string) {
  return portalSheetsRequest(session, "/client/v1/integrations/google/sheets/create", {
    method: "POST",
    body: JSON.stringify(title ? { title } : {}),
  });
}

export function testGoogleSheetFromPortal(
  session: PortalSessionPayload,
  input: { spreadsheetId: string; worksheetId: number }
) {
  return portalSheetsRequest(session, "/client/v1/integrations/google/sheets/test", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function saveGoogleSheetDestinationFromPortal(
  session: PortalSessionPayload,
  input: { spreadsheetId: string; worksheetId: number; createdBySa360?: boolean }
) {
  return portalSheetsRequest(session, "/client/v1/integrations/google/sheets/destination", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function getGoogleSheetDestinationFromPortal(session: PortalSessionPayload) {
  return portalSheetsRequest(session, "/client/v1/integrations/google/sheets/destination", {
    method: "GET",
  });
}

export function deleteGoogleSheetDestinationFromPortal(session: PortalSessionPayload) {
  return portalSheetsRequest(session, "/client/v1/integrations/google/sheets/destination", {
    method: "DELETE",
  });
}
