import { createHash } from "node:crypto";
import {
  DEFAULT_SOURCE_FIELD_ALIASES,
  isReservedSourceRawKey,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
  type CanonicalSourceAttributeKey,
} from "./source-field-alias.registry.js";

const CONTACT_FIELD_KEYS = [
  "lead_id",
  "submitted_at",
  "first_name",
  "last_name",
  "email",
  "phone",
  "state",
  "date",
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
  "fbp",
  "fbc",
  "utm_source",
  "utm_medium",
  "utm_campaign",
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

function aliasesForField(
  fieldKey: string,
  routeAliasOverrides?: Record<string, readonly string[]>
): string[] {
  const canonical =
    (resolveCanonicalAttributeKey(fieldKey, routeAliasOverrides) as string | null) ?? fieldKey;
  const fromRegistry = DEFAULT_SOURCE_FIELD_ALIASES[canonical as CanonicalSourceAttributeKey] ?? [];
  const fromRoute = routeAliasOverrides?.[canonical] ?? [];
  return [canonical, ...fromRegistry, ...fromRoute];
}

function readFromRecord(
  record: Record<string, unknown> | null,
  fieldKey: string,
  routeAliasOverrides?: Record<string, readonly string[]>
): unknown {
  if (!record) return undefined;
  for (const alias of aliasesForField(fieldKey, routeAliasOverrides)) {
    const direct = record[alias];
    if (hasResolvableValue(direct)) return direct;
    const normalized = normalizeSourceFieldKey(alias);
    for (const [key, value] of Object.entries(record)) {
      if (normalizeSourceFieldKey(key) === normalized && hasResolvableValue(value)) {
        return value;
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

export type ResolvedLeadCaptureLeadId = {
  leadId: string;
  sourceLeadIdGenerated: boolean;
};

export function resolveLeadCaptureRouteKey(
  raw: Record<string, unknown>,
  routeKeyFromPath?: string
): string {
  return (
    trimOrUndefined(resolveLeadCaptureField(raw, "sa360_route_key")) ??
    trimOrUndefined(routeKeyFromPath) ??
    "UNKNOWN_ROUTE"
  );
}

export function resolveLeadCaptureLeadId(
  raw: Record<string, unknown>,
  routeKey: string
): ResolvedLeadCaptureLeadId {
  const explicit = trimOrUndefined(resolveLeadCaptureField(raw, "lead_id"));
  if (explicit) {
    return { leadId: explicit, sourceLeadIdGenerated: false };
  }

  const phone = trimOrUndefined(resolveLeadCaptureField(raw, "phone"));
  const email = trimOrUndefined(resolveLeadCaptureField(raw, "email"));
  const submittedAt = trimOrUndefined(resolveLeadCaptureField(raw, "submitted_at"));
  const basis = [routeKey, phone ?? "", email ?? "", submittedAt ?? ""].join(":");
  const hash = createHash("sha256").update(basis).digest("hex").slice(0, 16);
  return { leadId: `gen-${hash}`, sourceLeadIdGenerated: true };
}

const ALL_RESOLVABLE_FIELDS: readonly string[] = [
  ...CONTACT_FIELD_KEYS,
  ...COMPLIANCE_FIELD_KEYS,
  ...SA360_META_KEYS,
  ...Object.keys(DEFAULT_SOURCE_FIELD_ALIASES),
];

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
  if (!trimOrUndefined(effective.sa360_route_key) && routeKey !== "UNKNOWN_ROUTE") {
    effective.sa360_route_key = routeKey;
  }

  const { leadId } = resolveLeadCaptureLeadId(raw, routeKey);
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
