import type { AdminWebhookDetail, AdminWebhookListItem, WebhookDetailFieldValue } from "@/lib/admin-api/types";
import { isInvalidWebhookRow } from "./webhook-monitor-utils.ts";

export function formatDetailFieldValue(value: WebhookDetailFieldValue | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  const s = String(value).trim();
  return s === "" ? "—" : s;
}

export function topLineFromListItem(row: AdminWebhookListItem) {
  return {
    request_id: row.requestId,
    time: row.receivedAt,
    event: row.eventNameInternal ?? row.eventUuid,
    lead: row.leadName?.trim() || null,
    client: row.clientAccountId,
    subaccount: row.subaccountIdGhl,
    validity: isInvalidWebhookRow(row.processingStatus) ? ("invalid" as const) : ("valid" as const),
    status: row.processingStatus,
    http: row.httpStatus !== null ? String(row.httpStatus) : null,
    ms: row.durationMs !== null ? String(row.durationMs) : null,
    route: row.route,
  };
}

export function hasJsonPayload(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "" && value.trim() !== "—";
  return true;
}

export function buildCompactDebugSummary(
  row: AdminWebhookListItem,
  detail: AdminWebhookDetail | null
): string {
  const debug = detail?.debug;
  const top = debug?.topLine ?? topLineFromListItem(row);
  const lines = [
    `request_id: ${top.request_id}`,
    `time: ${top.time}`,
    `event: ${top.event ?? "—"}`,
    `status: ${top.status}`,
    `validity: ${top.validity}`,
    `client: ${top.client ?? "—"}`,
    `lead: ${top.lead ?? row.leadName ?? "—"}`,
    `error_summary: ${debug?.errors?.error_summary ?? row.errorSummary ?? "—"}`,
  ];
  return lines.join("\n");
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (text === "—" || text.trim() === "") return false;
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
