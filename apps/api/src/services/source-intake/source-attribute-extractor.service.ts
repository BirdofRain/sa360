import { createHash } from "node:crypto";
import {
  CANONICAL_SOURCE_ATTRIBUTE_KEYS,
  isReservedSourceRawKey,
  listIncomingAnswerKeys,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
  type CanonicalSourceAttributeKey,
} from "./source-field-alias.registry.js";
import type { SourceAttributes, UnmappedSourceField } from "./source-enrichment.types.js";

export type SourceAttributeExtractionResult = {
  sourceAttributes: SourceAttributes;
  unmappedSourceFields: UnmappedSourceField[];
  unmappedSourceFieldKeys: string[];
  incomingAnswerKeys: string[];
};

function coerceAttributeValue(
  canonical: CanonicalSourceAttributeKey,
  raw: unknown
): string | number | boolean | null {
  if (raw === null || raw === undefined) return null;
  if (canonical === "age") {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    const n = Number(String(raw).trim());
    return Number.isFinite(n) ? n : null;
  }
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
  }
): SourceAttributeExtractionResult {
  const sourceAttributes: SourceAttributes = {};
  const unmappedSourceFields: UnmappedSourceField[] = [];
  const unmappedSourceFieldKeys: string[] = [];
  const consumedNormalized = new Set<string>();

  for (const [key, value] of Object.entries(raw)) {
    if (isReservedSourceRawKey(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;

    const canonical = resolveCanonicalAttributeKey(key, opts.routeAliasOverrides);
    if (canonical) {
      const normalizedKey = normalizeSourceFieldKey(key);
      if (consumedNormalized.has(normalizedKey)) continue;
      consumedNormalized.add(normalizedKey);
      const coerced = coerceAttributeValue(canonical, value);
      if (coerced !== null && sourceAttributes[canonical] === undefined) {
        sourceAttributes[canonical] = coerced;
      }
      continue;
    }

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
    const direct = raw[canonical];
    if (direct !== undefined && direct !== null && String(direct).trim() !== "") {
      sourceAttributes[canonical] = coerceAttributeValue(canonical, direct);
    }
  }

  return {
    sourceAttributes,
    unmappedSourceFields,
    unmappedSourceFieldKeys,
    incomingAnswerKeys: listIncomingAnswerKeys(raw),
  };
}

export function computeSchemaFingerprint(keys: string[]): string {
  const sorted = [...keys].map(normalizeSourceFieldKey).filter(Boolean).sort();
  return createHash("sha256").update(sorted.join("|")).digest("hex").slice(0, 16);
}
