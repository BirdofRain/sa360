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
  writeReadiness: string;
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
  destinationRevision?: number;
  tabs?: PortalCompanySheetsTab[];
  orderDelivery: {
    status: "not_started";
    automatedWritesEnabled: false;
  };
};

export type PortalCompanySheetsTab = {
  role: "campaign" | "aged";
  setupState: "missing" | "incompatible" | "bound";
  setupReason: string | null;
  worksheetTitle: string | null;
  schemaVersion: string | null;
  tabUrl: string | null;
  deliveryState: "configured" | "queued" | "partial" | "uncertain" | "succeeded";
};

export type PortalOrderSheetsEvidence = {
  exportPackageId: string;
  spreadsheetUrl: string;
  tabUrl: string;
  worksheetId?: number;
  worksheetTitle: string;
  status: string;
  deliveryState: "configured" | "queued" | "partial" | "uncertain" | "succeeded";
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
      const tabUrl = isRecordedSheetUrl(record.tabUrl) ? record.tabUrl : record.spreadsheetUrl;
      const deliveryState = record.deliveryState;
      evidence.push({
        exportPackageId: record.exportPackageId,
        spreadsheetUrl: record.spreadsheetUrl,
        tabUrl,
        worksheetId: typeof record.worksheetId === "number" ? record.worksheetId : undefined,
        worksheetTitle: record.worksheetTitle,
        status: record.status,
        deliveryState:
          deliveryState === "configured" ||
          deliveryState === "queued" ||
          deliveryState === "partial" ||
          deliveryState === "uncertain" ||
          deliveryState === "succeeded"
            ? deliveryState
            : record.status === "succeeded"
              ? "succeeded"
              : record.status === "uncertain"
                ? "uncertain"
                : record.status === "retryable"
                  ? "partial"
                  : "queued",
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
