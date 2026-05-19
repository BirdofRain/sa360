import type { WebhookRequestDetailDebug } from "@/lib/admin-api/types";

export type WebhookRawJsonTab = "request" | "response" | "meta";

export function stringifyWebhookJson(value: unknown): string | null {
  try {
    if (value === undefined || value === null) return null;
    if (typeof value === "string") {
      const t = value.trim();
      return t === "" ? null : value;
    }
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function webhookRawJsonTabPayload(
  debug: WebhookRequestDetailDebug,
  tab: WebhookRawJsonTab
): unknown {
  switch (tab) {
    case "request":
      return debug.requestBodyRedacted;
    case "response":
      return debug.responseBodyRedacted;
    case "meta":
      return debug.meta;
  }
}

export function webhookRawJsonEmptyMessage(tab: WebhookRawJsonTab): string {
  switch (tab) {
    case "request":
      return "No request JSON available for this row.";
    case "response":
      return "No response JSON available for this request.";
    case "meta":
      return "No metadata available for this request.";
  }
}

export function hasWebhookRawJsonContent(value: unknown): boolean {
  return stringifyWebhookJson(value) !== null;
}
