/**
 * Resolve incoming keys to canonical fields before DOB validation.
 *
 * Alias lists live in `source-field-alias.registry.ts`. This module applies
 * them. A nonempty canonical date_of_birth is kept even when it is invalid
 * or disagrees with another alias, including a scoped `date`. Disagreeing
 * aliases do not fall through to object-key order.
 */

import { parseCampaignDateOfBirth, parseCampaignSuppliedAge } from "../consumer-age/campaign-dob-age.js";
import { normalizeLeadCaptureParentUrl } from "./leadcapture-parent-url.js";
import {
  INCOMING_IDENTITY_FIELD_ALIASES,
  isAmbiguousIncomingFieldKey,
  isReservedSourceRawKey,
  matchScopedIncomingFieldBinding,
  normalizeSourceFieldKey,
  resolveCanonicalAttributeKey,
  scopedAliasForKey,
  type CanonicalSourceAttributeKey,
  type IncomingIdentityFieldKey,
  type ScopedIncomingFieldBinding,
} from "./source-field-alias.registry.js";

const TEMPLATE_PLACEHOLDER_PATTERN = /^\{\{\s*[^{}]*\s*\}\}$/;
const MARITAL_BOOLEAN_KEYS = new Set(["married", "is_married"]);

export type IncomingFieldConflictReason =
  | "disagreeing_aliases"
  | "invalid_canonical_preserved"
  | "key_normalization_collision";

export type IncomingFieldConflict = {
  canonical: string;
  reason: IncomingFieldConflictReason;
  candidates: Array<{ key: string; value: string }>;
  selectedKey: string | null;
  selectedValue: string | null;
};

export type IncomingFieldResolution = {
  attributes: Partial<Record<CanonicalSourceAttributeKey, unknown>>;
  identity: Partial<Record<IncomingIdentityFieldKey, string>>;
  conflicts: IncomingFieldConflict[];
  blockedAttributes: ReadonlySet<CanonicalSourceAttributeKey>;
  blockedIdentity: ReadonlySet<IncomingIdentityFieldKey>;
  consumedNormalizedKeys: ReadonlySet<string>;
  scopedBindingId: string | null;
};

export type IncomingFieldResolutionOptions = {
  sourceSystem: string;
  sourceFunnelId?: string | null;
  routeKey?: string | null;
  routeAliasOverrides?: Record<string, readonly string[]>;
};

type Candidate = {
  layer: number;
  key: string;
  normalizedKey: string;
  value: unknown;
  text: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTemplate(value: unknown): boolean {
  return typeof value === "string" && TEMPLATE_PLACEHOLDER_PATTERN.test(value.trim());
}

function scalarText(value: unknown): string | null {
  if (typeof value === "string") return trimmedString(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return null;
}

/**
 * Boolean marital answers. `false` is "Not married" and is never rewritten
 * to "Single". Any other nonempty string is left unchanged by the caller.
 */
export function maritalStatusFromBooleanLike(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "Married" : "Not married";
  if (typeof value === "number") {
    if (value === 1) return "Married";
    if (value === 0) return "Not married";
    return null;
  }
  const token = trimmedString(value)?.toLowerCase();
  if (!token) return null;
  if (token === "true" || token === "yes" || token === "1") return "Married";
  if (token === "false" || token === "no" || token === "0") return "Not married";
  return null;
}

function identityCanonical(normalizedKey: string): IncomingIdentityFieldKey | null {
  for (const [canonical, aliases] of Object.entries(INCOMING_IDENTITY_FIELD_ALIASES)) {
    if (aliases.some((alias) => normalizeSourceFieldKey(alias) === normalizedKey)) {
      return canonical as IncomingIdentityFieldKey;
    }
  }
  return null;
}

function classifyKey(
  key: string,
  binding: ScopedIncomingFieldBinding | null,
  routeAliasOverrides?: Record<string, readonly string[]>
): { namespace: "attribute" | "identity"; canonical: string } | null {
  const scoped = scopedAliasForKey(binding, key);
  if (scoped) return { namespace: "attribute", canonical: scoped };
  if (isAmbiguousIncomingFieldKey(key)) return null;
  const attribute = resolveCanonicalAttributeKey(key, routeAliasOverrides);
  if (attribute) return { namespace: "attribute", canonical: attribute };
  const identity = identityCanonical(normalizeSourceFieldKey(key));
  if (identity) return { namespace: "identity", canonical: identity };
  return null;
}

function parentUrlKeyFromPayload(raw: Record<string, unknown>): string | null {
  const answers = asRecord(raw.answers);
  const form = asRecord(raw.form);
  const value = raw.parent_url ?? answers?.parent_url ?? form?.parent_url;
  return normalizeLeadCaptureParentUrl(value)?.parentUrlKey ?? null;
}

function providerFromPayload(raw: Record<string, unknown>, sourceSystem: string): string {
  return (
    trimmedString(raw.provider) ??
    trimmedString(raw.sa360_source_platform) ??
    (sourceSystem.startsWith("leadcapture_io") ? "leadcapture_io" : "")
  );
}

function pushLayer(
  target: Array<{ layer: number; record: Record<string, unknown> }>,
  layer: number,
  record: Record<string, unknown> | null
): void {
  if (record) target.push({ layer, record });
}

function dobToken(text: string): string {
  return parseCampaignDateOfBirth(text) ?? `invalid:${text}`;
}

function ageToken(text: string): string {
  return parseCampaignSuppliedAge(text) ?? `invalid:${text}`;
}

function comparableToken(canonical: string, text: string): string {
  if (canonical === "date_of_birth") return dobToken(text);
  if (canonical === "age") return ageToken(text);
  return text;
}

function chooseGroup(
  canonical: string,
  candidates: Candidate[]
): { selected: Candidate | null; conflicts: IncomingFieldConflict[] } {
  const conflicts: IncomingFieldConflict[] = [];
  const byKey = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = byKey.get(candidate.normalizedKey) ?? [];
    group.push(candidate);
    byKey.set(candidate.normalizedKey, group);
  }

  const survivors: Candidate[] = [];
  for (const group of byKey.values()) {
    const layers = [...new Set(group.map((candidate) => candidate.layer))].sort((a, b) => a - b);
    let collided = false;
    for (const layer of layers) {
      const inLayer = group.filter((candidate) => candidate.layer === layer);
      const texts = new Set(inLayer.map((candidate) => comparableToken(canonical, candidate.text)));
      if (texts.size > 1) {
        collided = true;
        conflicts.push({
          canonical,
          reason: "key_normalization_collision",
          candidates: inLayer.map((candidate) => ({ key: candidate.key, value: candidate.text })),
          selectedKey: null,
          selectedValue: null,
        });
      }
    }
    if (collided) continue;
    const topLayer = layers[0];
    const chosen = group
      .filter((candidate) => candidate.layer === topLayer)
      .sort((a, b) => a.key.localeCompare(b.key))[0];
    if (chosen) survivors.push(chosen);
  }

  if (conflicts.some((conflict) => conflict.reason === "key_normalization_collision")) {
    return { selected: null, conflicts };
  }
  if (survivors.length === 0) return { selected: null, conflicts };

  const canonicalKey = normalizeSourceFieldKey(canonical);
  const spelling = survivors.find((candidate) => candidate.normalizedKey === canonicalKey) ?? null;
  const tokens = new Set(survivors.map((candidate) => comparableToken(canonical, candidate.text)));
  const evidence = survivors.map((candidate) => ({ key: candidate.key, value: candidate.text }));

  if (spelling) {
    const parsedDob = canonical === "date_of_birth" ? parseCampaignDateOfBirth(spelling.text) : null;
    const invalidDob = canonical === "date_of_birth" && !parsedDob;
    const othersDisagree = survivors.some(
      (candidate) =>
        candidate !== spelling &&
        comparableToken(canonical, candidate.text) !== comparableToken(canonical, spelling.text)
    );
    if (invalidDob || othersDisagree) {
      conflicts.push({
        canonical,
        reason: invalidDob ? "invalid_canonical_preserved" : "disagreeing_aliases",
        candidates: evidence,
        selectedKey: spelling.key,
        selectedValue: storedText(canonical, spelling),
      });
    }
    return { selected: spelling, conflicts };
  }

  if (tokens.size > 1) {
    conflicts.push({
      canonical,
      reason: "disagreeing_aliases",
      candidates: evidence,
      selectedKey: null,
      selectedValue: null,
    });
    return { selected: null, conflicts };
  }

  const selected = [...survivors].sort((a, b) => a.key.localeCompare(b.key))[0] ?? null;
  return { selected, conflicts };
}

function storedText(canonical: string, candidate: Candidate): string {
  if (canonical === "marital_status" && MARITAL_BOOLEAN_KEYS.has(candidate.normalizedKey)) {
    return maritalStatusFromBooleanLike(candidate.value) ?? candidate.text;
  }
  return candidate.text;
}

function storedValue(canonical: string, candidate: Candidate): unknown {
  if (canonical === "marital_status" && MARITAL_BOOLEAN_KEYS.has(candidate.normalizedKey)) {
    return maritalStatusFromBooleanLike(candidate.value) ?? candidate.text;
  }
  if (canonical === "age" && typeof candidate.value === "number") return candidate.value;
  if (canonical === "date_of_birth") return candidate.text;
  return candidate.value;
}

function acceptsCandidate(canonical: string, value: unknown): boolean {
  if (canonical === "date_of_birth") return typeof value === "string" && value.trim().length > 0;
  return scalarText(value) != null;
}

export function resolveIncomingPayloadFields(
  raw: Record<string, unknown>,
  options: IncomingFieldResolutionOptions
): IncomingFieldResolution {
  const sourceSystem =
    trimmedString(raw.sa360_source_system) ?? options.sourceSystem;
  const binding = matchScopedIncomingFieldBinding({
    provider: providerFromPayload(raw, sourceSystem),
    sourceSystem,
    sourceFunnelId: options.sourceFunnelId,
    parentUrlKey: parentUrlKeyFromPayload(raw),
    sourceRouteKey: options.routeKey ?? trimmedString(raw.sa360_route_key),
  });
  const legacy = sourceSystem !== "leadcapture_io_nextgen";
  const layers: Array<{ layer: number; record: Record<string, unknown> }> = [];
  pushLayer(layers, 0, raw);
  pushLayer(layers, 1, asRecord(raw.answers));
  if (legacy) pushLayer(layers, 2, asRecord(raw.form));

  const grouped = new Map<string, Candidate[]>();
  const consumed = new Set<string>();
  const conflicts: IncomingFieldConflict[] = [];
  const unusableCanonical = new Set<string>();

  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer.record)) {
      if (value == null || isTemplate(value)) continue;
      const normalizedKey = normalizeSourceFieldKey(key);
      if (!normalizedKey) continue;
      const classified = classifyKey(key, binding, options.routeAliasOverrides);
      if (!classified) continue;
      consumed.add(normalizedKey);
      if (
        classified.canonical === "date_of_birth" &&
        normalizedKey === "date_of_birth" &&
        !acceptsCandidate(classified.canonical, value)
      ) {
        unusableCanonical.add(classified.canonical);
        conflicts.push({
          canonical: classified.canonical,
          reason: "invalid_canonical_preserved",
          candidates: [{ key, value: "[non-string]" }],
          selectedKey: key,
          selectedValue: null,
        });
        continue;
      }
      if (!acceptsCandidate(classified.canonical, value)) continue;
      const text = scalarText(value);
      if (!text) continue;
      const bucketKey = `${classified.namespace}:${classified.canonical}`;
      const bucket = grouped.get(bucketKey) ?? [];
      bucket.push({ layer: layer.layer, key, normalizedKey, value, text });
      grouped.set(bucketKey, bucket);
    }
  }

  const attributes: IncomingFieldResolution["attributes"] = {};
  const identity: IncomingFieldResolution["identity"] = {};
  const blockedAttributes = new Set<CanonicalSourceAttributeKey>();
  const blockedIdentity = new Set<IncomingIdentityFieldKey>();

  for (const canonical of unusableCanonical) {
    blockedAttributes.add(canonical as CanonicalSourceAttributeKey);
  }

  for (const [bucketKey, candidates] of grouped) {
    const separator = bucketKey.indexOf(":");
    const namespace = bucketKey.slice(0, separator);
    const canonical = bucketKey.slice(separator + 1);
    if (unusableCanonical.has(canonical)) continue;
    const choice = chooseGroup(canonical, candidates);
    conflicts.push(...choice.conflicts);
    if (!choice.selected) {
      if (namespace === "attribute") blockedAttributes.add(canonical as CanonicalSourceAttributeKey);
      else blockedIdentity.add(canonical as IncomingIdentityFieldKey);
      continue;
    }
    if (namespace === "attribute") {
      attributes[canonical as CanonicalSourceAttributeKey] = storedValue(canonical, choice.selected);
    } else {
      identity[canonical as IncomingIdentityFieldKey] = storedText(canonical, choice.selected);
    }
  }

  return {
    attributes,
    identity,
    conflicts,
    blockedAttributes,
    blockedIdentity,
    consumedNormalizedKeys: consumed,
    scopedBindingId: binding?.id ?? null,
  };
}

export function incomingFieldWasConsumed(
  resolution: IncomingFieldResolution,
  key: string
): boolean {
  const normalized = normalizeSourceFieldKey(key);
  return Boolean(normalized) && resolution.consumedNormalizedKeys.has(normalized);
}

export function reservedTransportKey(key: string): boolean {
  return isReservedSourceRawKey(key);
}
