import { createHash } from "node:crypto";
import {
  CANONICAL_SOURCE_ATTRIBUTE_KEYS,
  DEFAULT_SOURCE_FIELD_ALIASES,
  isReservedSourceRawKey,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
  type CanonicalSourceAttributeKey,
} from "./source-field-alias.registry.js";

/** Identity / contact fields resolved before canonical source attributes. */
export const LEADCAPTURE_IDENTITY_FIELD_ALIASES: Record<string, readonly string[]> = {
  lead_id: ["lead_id", "ref_id"],
  phone: ["phone", "phone_number"],
  full_name: ["full_name", "name"],
  first_name: ["first_name"],
  last_name: ["last_name"],
  email: ["email"],
  state: ["state"],
  submitted_at: ["submitted_at"],
  date: ["date"],
  time: ["time"],
};

export const LEADCAPTURE_COMPLIANCE_FIELD_ALIASES: Record<string, readonly string[]> = {
  is_partial_lead: ["is_partial_lead", "is_dropoff"],
};

export const LEADCAPTURE_ATTRIBUTION_FIELD_ALIASES: Record<string, readonly string[]> = {
  utm_source: ["utm_source"],
  utm_medium: ["utm_medium"],
  utm_campaign: ["utm_campaign"],
  utm_id: ["utm_id"],
  utm_content: ["utm_content"],
  utm_term: ["utm_term"],
  fbclid: ["fbclid"],
  fbp: ["fbp"],
  fbc: ["fbc"],
};

const CONTACT_FIELD_KEYS = [
  "lead_id",
  "submitted_at",
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "state",
] as const;

const COMPLIANCE_FIELD_KEYS = [
  "email_verification_status",
  "verfi_proof_url",
  "anura_result",
  "anura_rule_sets",
  "anura_invalid_traffic_type",
  "anura_mobile",
  "anura_ad_blocker",
  "anura_response_id",
  "session_recording_url",
  "is_partial_lead",
  "leadScoreSummary",
  "resume_url",
  "ttp",
  "ttclid",
  ...Object.keys(LEADCAPTURE_ATTRIBUTION_FIELD_ALIASES),
] as const;

const SA360_META_KEYS = [
  "sa360_route_key",
  "sa360_source_system",
  "sa360_source_platform",
  "sa360_source_type",
  "sa360_funnel_name",
  "sa360_campaign_name",
] as const;

export type LeadCaptureResolvableField =
  | (typeof CONTACT_FIELD_KEYS)[number]
  | CanonicalSourceAttributeKey
  | (typeof COMPLIANCE_FIELD_KEYS)[number]
  | (typeof SA360_META_KEYS)[number];

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Coerce numeric or string lead identifiers to a stable string form. */
export function coerceLeadCaptureLeadIdValue(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  return trimOrUndefined(value);
}

function hasResolvableValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

export function getLeadCaptureAnswersRecord(
  raw: Record<string, unknown>
): Record<string, unknown> | null {
  return asRecord(raw.answers);
}

export function isLeadCaptureLegacySourceSystem(raw: Record<string, unknown>): boolean {
  const explicit = trimOrUndefined(raw.sa360_source_system);
  return explicit !== "leadcapture_io_nextgen";
}

function aliasesForField(
  fieldKey: string,
  routeAliasOverrides?: Record<string, readonly string[]>
): string[] {
  const identityAliases = LEADCAPTURE_IDENTITY_FIELD_ALIASES[fieldKey];
  if (identityAliases) {
    return [...new Set([fieldKey, ...identityAliases])];
  }

  const complianceAliases = LEADCAPTURE_COMPLIANCE_FIELD_ALIASES[fieldKey];
  if (complianceAliases) {
    return [...new Set([fieldKey, ...complianceAliases])];
  }

  const attributionAliases = LEADCAPTURE_ATTRIBUTION_FIELD_ALIASES[fieldKey];
  if (attributionAliases) {
    return [...new Set([fieldKey, ...attributionAliases])];
  }

  const canonical =
    (resolveCanonicalAttributeKey(fieldKey, routeAliasOverrides) as string | null) ?? fieldKey;
  const fromRegistry = DEFAULT_SOURCE_FIELD_ALIASES[canonical as CanonicalSourceAttributeKey] ?? [];
  const fromRoute = routeAliasOverrides?.[canonical] ?? [];
  return [...new Set([canonical, ...fromRegistry, ...fromRoute])];
}

function coerceFieldValue(fieldKey: string, value: unknown): unknown {
  if (fieldKey === "lead_id") {
    const coerced = coerceLeadCaptureLeadIdValue(value);
    if (coerced) return coerced;
  }
  return value;
}

function readFromRecord(
  record: Record<string, unknown> | null,
  fieldKey: string,
  routeAliasOverrides?: Record<string, readonly string[]>
): unknown {
  if (!record) return undefined;
  for (const alias of aliasesForField(fieldKey, routeAliasOverrides)) {
    const direct = record[alias];
    if (hasResolvableValue(direct)) return coerceFieldValue(fieldKey, direct);
    const normalized = normalizeSourceFieldKey(alias);
    for (const [key, value] of Object.entries(record)) {
      if (normalizeSourceFieldKey(key) === normalized && hasResolvableValue(value)) {
        return coerceFieldValue(fieldKey, value);
      }
    }
  }
  return undefined;
}

/** Resolve one field using top-level → answers precedence. */
export function resolveLeadCaptureField(
  raw: Record<string, unknown>,
  fieldKey: string,
  routeAliasOverrides?: Record<string, readonly string[]>
): unknown {
  const topLevel = readFromRecord(raw, fieldKey, routeAliasOverrides);
  if (hasResolvableValue(topLevel)) return topLevel;

  const answers = getLeadCaptureAnswersRecord(raw);
  const fromAnswers = readFromRecord(answers, fieldKey, routeAliasOverrides);
  if (hasResolvableValue(fromAnswers)) return fromAnswers;

  if (answers) {
    const canonical = resolveCanonicalAttributeKey(fieldKey, routeAliasOverrides);
    if (canonical) {
      for (const [key, value] of Object.entries(answers)) {
        if (resolveCanonicalAttributeKey(key, routeAliasOverrides) === canonical && hasResolvableValue(value)) {
          return value;
        }
      }
    }
  }

  return undefined;
}

export function splitLeadCaptureFullName(full: string): { first_name: string; last_name: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: "", last_name: "" };
  if (parts.length === 1) return { first_name: parts[0], last_name: "" };
  return { first_name: parts[0], last_name: parts.slice(1).join(" ") };
}

export function resolveLegacySubmittedAt(
  raw: Record<string, unknown>,
  routeAliasOverrides?: Record<string, readonly string[]>
): string | undefined {
  const explicit = trimOrUndefined(resolveLeadCaptureField(raw, "submitted_at", routeAliasOverrides));
  if (explicit) return explicit;

  if (!isLeadCaptureLegacySourceSystem(raw)) {
    return undefined;
  }

  const date = trimOrUndefined(resolveLeadCaptureField(raw, "date", routeAliasOverrides));
  const time = trimOrUndefined(resolveLeadCaptureField(raw, "time", routeAliasOverrides));
  if (!date) return undefined;
  if (date.includes("T")) return date;
  if (time) {
    const normalizedTime = time.length <= 5 ? `${time}:00` : time;
    return `${date}T${normalizedTime}.000Z`;
  }
  return `${date}T00:00:00.000Z`;
}

export type ResolvedLeadCaptureLeadId = {
  leadId: string;
  sourceLeadIdGenerated: boolean;
};

export function resolveLeadCaptureRouteKey(
  raw: Record<string, unknown>,
  routeKeyFromPath?: string
): string {
  return (
    trimOrUndefined(routeKeyFromPath) ??
    trimOrUndefined(resolveLeadCaptureField(raw, "sa360_route_key")) ??
    "UNKNOWN_ROUTE"
  );
}

/** Apply endpoint defaults for native Legacy form posts (path route key is authoritative). */
export function applyLeadCaptureEndpointDefaults(
  raw: Record<string, unknown>,
  routeKeyFromPath?: string
): Record<string, unknown> {
  const routeKey = trimOrUndefined(routeKeyFromPath);
  if (!routeKey) return raw;
  return {
    ...raw,
    provider: raw.provider ?? "leadcapture_io",
    sa360_source_platform: raw.sa360_source_platform ?? "leadcapture_io",
    sa360_source_system: raw.sa360_source_system ?? "leadcapture_io_legacy",
    sa360_source_type: raw.sa360_source_type ?? "leadcapture_form",
    sa360_route_key: routeKey,
  };
}

export function resolveLeadCaptureLeadId(
  raw: Record<string, unknown>,
  routeKey: string,
  routeAliasOverrides?: Record<string, readonly string[]>
): ResolvedLeadCaptureLeadId {
  const explicit = coerceLeadCaptureLeadIdValue(
    resolveLeadCaptureField(raw, "lead_id", routeAliasOverrides)
  );
  if (explicit) {
    return { leadId: explicit, sourceLeadIdGenerated: false };
  }

  const phone = trimOrUndefined(resolveLeadCaptureField(raw, "phone", routeAliasOverrides));
  const email = trimOrUndefined(resolveLeadCaptureField(raw, "email", routeAliasOverrides));
  const submittedAt =
    resolveLegacySubmittedAt(raw, routeAliasOverrides) ??
    trimOrUndefined(resolveLeadCaptureField(raw, "submitted_at", routeAliasOverrides));
  const basis = [routeKey, phone ?? "", email ?? "", submittedAt ?? ""].join(":");
  const hash = createHash("sha256").update(basis).digest("hex").slice(0, 16);
  return { leadId: `gen-${hash}`, sourceLeadIdGenerated: true };
}

const ALL_RESOLVABLE_FIELDS: readonly string[] = [
  ...CONTACT_FIELD_KEYS,
  ...COMPLIANCE_FIELD_KEYS,
  ...SA360_META_KEYS,
  ...Object.keys(DEFAULT_SOURCE_FIELD_ALIASES),
  ...Object.keys(LEADCAPTURE_ATTRIBUTION_FIELD_ALIASES),
];

function applyResolvedIdentityNames(
  effective: Record<string, unknown>,
  raw: Record<string, unknown>,
  routeAliasOverrides?: Record<string, readonly string[]>
): void {
  if (!hasResolvableValue(effective.first_name) && !hasResolvableValue(effective.last_name)) {
    const fullName = trimOrUndefined(resolveLeadCaptureField(raw, "full_name", routeAliasOverrides));
    if (fullName) {
      const split = splitLeadCaptureFullName(fullName);
      if (split.first_name) effective.first_name = split.first_name;
      if (split.last_name) effective.last_name = split.last_name;
    }
  }
}

/** Materialize resolved LeadCapture fields onto a shallow copy (top-level wins). */
export function materializeLeadCapturePayload(
  raw: Record<string, unknown>,
  opts?: {
    routeKeyFromPath?: string;
    routeAliasOverrides?: Record<string, readonly string[]>;
  }
): Record<string, unknown> {
  const effective: Record<string, unknown> = { ...raw };
  const routeKey = resolveLeadCaptureRouteKey(raw, opts?.routeKeyFromPath);
  if (routeKey !== "UNKNOWN_ROUTE") {
    effective.sa360_route_key = routeKey;
  }

  const { leadId } = resolveLeadCaptureLeadId(raw, routeKey, opts?.routeAliasOverrides);
  if (!trimOrUndefined(effective.lead_id)) {
    effective.lead_id = leadId;
  }

  for (const fieldKey of ALL_RESOLVABLE_FIELDS) {
    if (hasResolvableValue(effective[fieldKey])) continue;
    const resolved = resolveLeadCaptureField(raw, fieldKey, opts?.routeAliasOverrides);
    if (hasResolvableValue(resolved)) {
      effective[fieldKey] = resolved;
    }
  }

  applyResolvedIdentityNames(effective, raw, opts?.routeAliasOverrides);

  const submittedAt = resolveLegacySubmittedAt(raw, opts?.routeAliasOverrides);
  if (submittedAt && !trimOrUndefined(effective.submitted_at)) {
    effective.submitted_at = submittedAt;
  }

  return effective;
}

export function listLeadCaptureIncomingAnswerKeys(raw: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  for (const key of Object.keys(raw)) {
    if (!isReservedSourceRawKey(key) && key !== "answers") keys.add(key);
  }
  const answers = getLeadCaptureAnswersRecord(raw);
  if (answers) {
    for (const key of Object.keys(answers)) {
      if (!isReservedSourceRawKey(key)) keys.add(key);
    }
  }
  return [...keys];
}

export function isLeadCaptureProviderPayload(raw: Record<string, unknown>): boolean {
  return (
    trimOrUndefined(raw.provider) === "leadcapture_io" ||
    trimOrUndefined(raw.sa360_source_platform) === "leadcapture_io"
  );
}
