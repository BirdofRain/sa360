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

export type PortalOrderSheetsEvidence = {
  exportPackageId: string;
  spreadsheetUrl: string;
  worksheetTitle: string;
  status: string;
};

function isRecordedSheetUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("https://docs.google.com/spreadsheets/");
}

export async function fetchPortalOrderSheetsEvidence(
  session: PortalSessionPayload,
  orderId: string
): Promise<{ ok: true; evidence: PortalOrderSheetsEvidence[] } | { ok: false; error: string }> {
  const baseUrl = getSa360PublicApiBaseUrl()?.replace(/\/+$/, "");
  const apiKey = getClientPortalApiKey();
  if (!baseUrl || !apiKey) return { ok: false, error: "Portal API is not configured" };
  const config = buildGooglePortalApiRequestConfig({ baseUrl, apiKey, session });
  const order = orderId.trim();
  if (!order) return { ok: false, error: "Spreadsheet status is unavailable" };
  try {
    const response = await fetch(
      `${config.baseUrl}/client/v1/lead-orders/${encodeURIComponent(order)}/google-sheets-delivery`,
      { headers: config.headers, cache: "no-store" }
    );
    const text = await response.text();
    if (!response.ok) return { ok: false, error: "Spreadsheet status for this order is unavailable" };
    const parsed = JSON.parse(text) as { evidence?: unknown };
    const rows = Array.isArray(parsed.evidence) ? parsed.evidence : [];
    const evidence: PortalOrderSheetsEvidence[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const record = row as Record<string, unknown>;
      if (!isRecordedSheetUrl(record.spreadsheetUrl)) continue;
      if (typeof record.exportPackageId !== "string" || typeof record.worksheetTitle !== "string") continue;
      if (typeof record.status !== "string") continue;
      evidence.push({
        exportPackageId: record.exportPackageId,
        spreadsheetUrl: record.spreadsheetUrl,
        worksheetTitle: record.worksheetTitle,
        status: record.status,
      });
    }
    return { ok: true, evidence };
  } catch {
    return { ok: false, error: "Spreadsheet status for this order is unavailable" };
  }
}

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
