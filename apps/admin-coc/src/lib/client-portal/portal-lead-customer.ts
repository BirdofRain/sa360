import { formatPortalDisplayValue } from "./portal-labels.ts";

/**
 * Presentation-only helpers for customer lead detail.
 * Does not change API contracts; operator/admin surfaces keep the raw fields.
 */

const INTERNAL_SOURCE_TOKENS = new Set([
  "webhook",
  "leadcapture",
  "leadcapture_io",
  "leadcapture.io",
  "synthflow",
  "ghl",
  "ghl_pro",
  "ghl_location",
]);

const CUSTOMER_TIMELINE_MILESTONES = new Set([
  "source_lead_received",
  "lead_delivered",
  "first_touch_sent",
  "contact_replied",
  "appointment_set",
  "appointment_showed",
  "sold",
]);

const INTERNAL_DIAGNOSTIC_PATTERNS: RegExp[] = [
  /inboundcontactindex/i,
  /inbound contact index/i,
  /snapshot found for this lead/i,
  /webhook/i,
  /routing/i,
  /funnel/i,
  /\bghl\b/i,
  /automation/i,
  /enrichment/i,
  /adapter/i,
  /dry[\s-]?run/i,
  /leadcapture/i,
  /synthflow/i,
  /\bdebug\b/i,
  /workflow/i,
  /contact index/i,
  /no adapter or live run/i,
  /ad[_\s-]?id/i,
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFactString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function isPortalInternalSourceToken(value: string): boolean {
  return INTERNAL_SOURCE_TOKENS.has(normalizeToken(value));
}

export function isPortalInternalLeadDiagnostic(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return INTERNAL_DIAGNOSTIC_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function filterPortalCustomerWarnings(warnings: string[]): string[] {
  return warnings.filter((warning) => warning.trim() && !isPortalInternalLeadDiagnostic(warning));
}

export function portalCustomerErrorSummary(errorSummary: string | null | undefined): string | null {
  if (!errorSummary?.trim()) return null;
  if (isPortalInternalLeadDiagnostic(errorSummary)) return null;
  return errorSummary.trim();
}

export function isPortalCustomerTimelineMilestone(milestone: string): boolean {
  return CUSTOMER_TIMELINE_MILESTONES.has(milestone);
}

export function portalCustomerCampaign(campaign: string | null | undefined): string | null {
  const trimmed = campaign?.trim();
  if (!trimmed || trimmed === "—") return null;
  if (isPortalInternalSourceToken(trimmed)) return null;
  return trimmed;
}

export function portalCustomerSourceLabel(sourceLabel: string | null | undefined): string | null {
  const trimmed = sourceLabel?.trim();
  if (!trimmed || trimmed === "—") return null;
  const kept = trimmed
    .split(/\s*[·•|/]\s*/)
    .map((part) => part.trim())
    .filter((part) => part && !isPortalInternalSourceToken(part));
  if (kept.length === 0) return null;
  return formatPortalDisplayValue(kept.join(" · "));
}

export function portalCustomerState(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^[a-z]{2}$/i.test(trimmed)) return trimmed.toUpperCase();
  return formatPortalDisplayValue(trimmed) ?? trimmed;
}

function firstAttribute(
  attrs: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = asFactString(attrs[key]);
    if (value) return value;
  }
  return null;
}

export function readPortalCustomerLeadFacts(attribution: unknown): {
  state: string | null;
  age: string | null;
  leadType: string | null;
} {
  const root = asRecord(attribution);
  const attrs = asRecord(root?.sourceAttributes) ?? root;
  if (!attrs) {
    return { state: null, age: null, leadType: null };
  }
  return {
    state: firstAttribute(attrs, ["state", "location", "region"]),
    age: firstAttribute(attrs, ["age", "consumer_age"]),
    leadType: firstAttribute(attrs, ["niche", "lead_type", "leadType"]),
  };
}
