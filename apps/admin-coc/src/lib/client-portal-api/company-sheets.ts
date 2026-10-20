import "server-only";

import type { PortalSessionPayload } from "../client-portal/portal-session.ts";
import { getSa360PublicApiBaseUrl } from "../sa360-public-api-base-url.ts";
import { buildGooglePortalApiRequestConfig } from "./google-oauth-request.ts";
import { getClientPortalApiKey } from "./keys.ts";

export type PortalCompanySheetsDestination = {
  configured: true;
  clientAccountId: string;
  spreadsheetTitle: string | null;
  spreadsheetUrl: string;
  worksheetTitle: string;
  accessStatus: string;
  writeReadiness: "not_verified";
  deliveryExecution: "disabled";
  liveDeliveryEnabled: false;
  sharing: {
    portalLinkGrantsGoogleAccess: false;
    clientGooglePermission: "not_granted";
    anyoneWithLink: false;
    public: false;
    missingRecipientPolicy: boolean;
    status: string;
  };
  connection: {
    status: string;
    connected: boolean;
    reconnectRequired: boolean;
  };
  orderDelivery: {
    status: "not_started";
    automatedWritesEnabled: false;
  };
};

export async function fetchPortalCompanySheetsDestination(session: PortalSessionPayload): Promise<
  | { ok: true; destination: PortalCompanySheetsDestination | null }
  | { ok: false; error: string }
> {
  const baseUrl = getSa360PublicApiBaseUrl()?.replace(/\/+$/, "");
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) return { ok: false, error: "Portal API is not configured" };
  const config = buildGooglePortalApiRequestConfig({ baseUrl, apiKey, session });
  try {
    const response = await fetch(`${config.baseUrl}/client/v1/integrations/google/company-sheets`, {
      headers: config.headers,
      cache: "no-store",
    });
    const text = await response.text();
    if (!response.ok) return { ok: false, error: "Spreadsheet status is unavailable" };
    const parsed = JSON.parse(text) as { destination?: PortalCompanySheetsDestination | null };
    return { ok: true, destination: parsed.destination ?? null };
  } catch {
    return { ok: false, error: "Spreadsheet status is unavailable" };
  }
}
