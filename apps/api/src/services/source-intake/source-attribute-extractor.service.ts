import { createHash } from "node:crypto";
import {
  incomingFieldWasConsumed,
  resolveIncomingPayloadFields,
  type IncomingFieldConflict,
} from "./incoming-field-resolution.js";
import {
  CANONICAL_SOURCE_ATTRIBUTE_KEYS,
  isReservedSourceRawKey,
  listIncomingAnswerKeys,
  normalizeSourceFieldKey,
  type CanonicalSourceAttributeKey,
} from "./source-field-alias.registry.js";
import { listLeadCaptureIncomingAnswerKeys, getLeadCaptureAnswersRecord, getLeadCaptureFormRecord, isLeadCaptureProviderPayload, isUnresolvedTemplatePlaceholder, materializeLeadCapturePayload } from "./leadcapture-payload-resolver.js";
import type { SourceAttributes, UnmappedSourceField } from "./source-enrichment.types.js";

export type SourceAttributeExtractionResult = {
  sourceAttributes: SourceAttributes;
  unmappedSourceFields: UnmappedSourceField[];
  unmappedSourceFieldKeys: string[];
  incomingAnswerKeys: string[];
  fieldAliasConflicts: IncomingFieldConflict[];
  scopedBindingId: string | null;
};

function coerceAttributeValue(
  canonical: CanonicalSourceAttributeKey,
  raw: unknown
): string | number | boolean | null {
  if (raw === null || raw === undefined) return null;
  if (canonical === "age") {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw !== "string") return null;
    const n = Number(raw.trim());
    return Number.isFinite(n) ? n : null;
  }
  if (canonical === "date_of_birth" && (typeof raw !== "string" || !raw.trim())) return null;
  if (canonical === "phone_verified" || canonical === "email_verified") {
    if (typeof raw === "boolean") return raw;
    const s = String(raw).trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return null;
  }
  if (typeof raw === "string") {
    const t = raw.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof raw === "number" || typeof raw === "boolean") return raw;
  return String(raw);
}

export function extractSourceAttributesFromPayload(
  raw: Record<string, unknown>,
  opts: {
    sourceSystem: string;
    receivedAt: string;
    routeAliasOverrides?: Record<string, readonly string[]>;
    leadCaptureMaterialized?: Record<string, unknown>;
    sourceFunnelId?: string | null;
    routeKey?: string | null;
  }
): SourceAttributeExtractionResult {
  const materialized =
    opts.leadCaptureMaterialized ??
    (opts.sourceSystem.startsWith("leadcapture_io") || isLeadCaptureProviderPayload(raw)
      ? materializeLeadCapturePayload(raw, { routeAliasOverrides: opts.routeAliasOverrides })
      : raw);
  const answers = getLeadCaptureAnswersRecord(raw);
  const form = getLeadCaptureFormRecord(raw);
  const sourceAttributes: SourceAttributes = {};
  const unmappedSourceFields: UnmappedSourceField[] = [];
  const unmappedSourceFieldKeys: string[] = [];

  const isLeadCapture = Boolean(
    opts.leadCaptureMaterialized ||
      opts.sourceSystem.startsWith("leadcapture_io") ||
      isLeadCaptureProviderPayload(raw)
  );
  const resolution = resolveIncomingPayloadFields(raw, {
    sourceSystem: opts.sourceSystem,
    sourceFunnelId: opts.sourceFunnelId,
    routeKey: opts.routeKey,
    routeAliasOverrides: opts.routeAliasOverrides,
  });
  for (const [canonical, value] of Object.entries(resolution.attributes) as Array<
    [CanonicalSourceAttributeKey, unknown]
  >) {
    const coerced = coerceAttributeValue(canonical, value);
    if (coerced !== null) sourceAttributes[canonical] = coerced;
  }

  const incomingKeys = isLeadCapture
    ? listLeadCaptureIncomingAnswerKeys(raw)
    : listIncomingAnswerKeys(raw);

  for (const key of incomingKeys) {
    const value = materialized[key] ?? raw[key] ?? answers?.[key] ?? form?.[key];
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    // Unresolved LeadCapture merge fields are not real data: keep them out of
    // canonical source attributes and unmapped fields (raw payload still has them).
    if (isLeadCapture && isUnresolvedTemplatePlaceholder(value)) continue;
    if (incomingFieldWasConsumed(resolution, key)) continue;
    if (isReservedSourceRawKey(key)) continue;
    unmappedSourceFieldKeys.push(key);
    unmappedSourceFields.push({
      key,
      value,
      sourceSystem: opts.sourceSystem,
      receivedAt: opts.receivedAt,
    });
  }

  for (const canonical of CANONICAL_SOURCE_ATTRIBUTE_KEYS) {
    if (sourceAttributes[canonical] !== undefined) continue;
    if (resolution.blockedAttributes.has(canonical)) continue;
    const direct = materialized[canonical];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      const coerced = coerceAttributeValue(canonical, direct);
      if (coerced !== null) sourceAttributes[canonical] = coerced;
    }
  }

  return {
    sourceAttributes,
    unmappedSourceFields,
    unmappedSourceFieldKeys,
    incomingAnswerKeys: incomingKeys,
    fieldAliasConflicts: resolution.conflicts,
    scopedBindingId: resolution.scopedBindingId,
  };
}

export function computeSchemaFingerprint(keys: string[]): string {
  const sorted = [...keys].map(normalizeSourceFieldKey).filter(Boolean).sort();
  return createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 16);
}
