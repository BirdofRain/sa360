/**
 * Output sanitizers for delivery diagnostics.
 *
 * `redactWebhookPayloadForLog` removes credentials. It does not remove consumer
 * names, emails, or phones, so stored `requestRedactedJson` and
 * `responseRedactedJson` bodies are never copied into a diagnostics response.
 * Only the fields named here leave the process.
 */

import { machineCode, scrubDeliveryHealthText } from "../delivery-health/evidence.js";

const MAX_ERROR_TEXT = 300;
const MAX_LIST_ITEMS = 5;

export const WITHHELD_TEXT = "[withheld]";

/**
 * Step summaries and run errors carry LeadConnector's raw error text, which can
 * echo a submitted name or address. Pattern scrubbing cannot recognise those,
 * so free text is returned only when every capitalised word is known
 * vocabulary and no long digit run (street number, ZIP) appears. Anything
 * else is replaced by WITHHELD_TEXT; the error code and HTTP status still
 * identify the failure.
 */
const KNOWN_CAPITALISED = new Set([
  "A", "API", "Ambiguous", "Already", "Association", "Bad", "Blocked", "Campaign", "CampaignRoutingRule", "Cannot",
  "Conflict", "Contact", "Contacts", "Custom", "Delivery", "Duplicate", "Entity", "Error", "Existing", "Failed",
  "Field", "Fields", "Forbidden", "Found", "GHL", "Gateway", "Google", "HTTP", "ID", "Internal", "Intake",
  "Invalid", "LeadConnector", "Live", "Location", "Many", "Missing", "No", "Not", "Note", "OAuth", "OK", "Neither",
  "Opportunity", "Option", "Phase", "Pipeline", "Possible", "Request", "Requests", "Required", "SA360", "Server",
  "Service", "Sheet", "Skipped", "Source", "Stage", "TEXT", "Tag", "Tags", "The", "This", "Timeout", "Too",
  "Unauthorized", "Unavailable", "Unprocessable", "Validated", "Withheld", "Workflow",
]);

const QUOTED_VALUE = /"[^"]*"|`[^`]*`|“[^”]*”|‘[^’]*’|(^|[\s:=(])'[^']*'/g;

function isKnownVocabulary(text: string): boolean {
  if (/\d{4,}/.test(text)) return false;
  for (const word of text.split(/[^A-Za-z0-9_]+/)) {
    if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(word)) continue;
    if (/^[A-Z]/.test(word) && !KNOWN_CAPITALISED.has(word)) return false;
  }
  return true;
}

export function sanitizeErrorText(value: string | null | undefined, max = MAX_ERROR_TEXT): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const scrubbed = scrubDeliveryHealthText(trimmed, max).replace(QUOTED_VALUE, "$1[redacted]");
  return isKnownVocabulary(scrubbed) ? scrubbed : WITHHELD_TEXT;
}

export function sanitizeErrorList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = sanitizeErrorText(item);
    if (text) out.push(text);
    if (out.length >= MAX_LIST_ITEMS) break;
  }
  return out;
}

export function sanitizeCode(value: string | null | undefined): string | null {
  return machineCode(value);
}

export function httpStatusFromErrorCode(errorCode: string | null | undefined): number | null {
  if (!errorCode) return null;
  const match = /^http_(\d{3})$/.exec(errorCode.trim());
  return match ? Number(match[1]) : null;
}

export type SanitizedGhlError = {
  statusCode: number | null;
  error: string | null;
  messages: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * LeadConnector validation errors name the offending field ("pipelineStageId
 * must be a string"). That text is what separates a bad pipeline id from a
 * missing field, so it is kept after scrubbing. No other response key is read.
 */
export function sanitizedGhlErrorBody(responseRedactedJson: unknown): SanitizedGhlError | null {
  const body = record(responseRedactedJson);
  if (!body) return null;
  const statusCode = typeof body.statusCode === "number" && Number.isFinite(body.statusCode) ? body.statusCode : null;
  const error = typeof body.error === "string" ? sanitizeErrorText(body.error, 120) : null;
  const rawMessage = body.message;
  const messages =
    typeof rawMessage === "string"
      ? sanitizeErrorList([rawMessage])
      : sanitizeErrorList(Array.isArray(rawMessage) ? rawMessage : []);
  if (statusCode == null && !error && messages.length === 0) return null;
  return { statusCode, error, messages };
}

export function externalCallExecutedFromResponse(responseRedactedJson: unknown): boolean {
  return record(responseRedactedJson)?.externalCallExecuted === true;
}
