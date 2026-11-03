import { projectCampaignDobAge } from "../consumer-age/campaign-dob-age.js";
import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import { buildCustomFieldsForPutFromMap } from "../ghl-delivery-adapter/ghl-live-transport.js";
import type { SourceAttributes, SourceAttributeFieldMappingEntry } from "./source-enrichment.types.js";

function indexDiscovered(fields: GhlDiscoveredCustomField[]): {
  byKey: Map<string, GhlDiscoveredCustomField>;
  byId: Map<string, GhlDiscoveredCustomField>;
} {
  const byKey = new Map<string, GhlDiscoveredCustomField>();
  const byId = new Map<string, GhlDiscoveredCustomField>();
  for (const field of fields) {
    if (field.id?.trim()) byId.set(field.id.trim(), field);
    const keys = [field.fieldKey, field.key].filter(Boolean) as string[];
    for (const k of keys) {
      byKey.set(k.trim(), field);
      byKey.set(k.trim().toLowerCase(), field);
    }
  }
  return { byKey, byId };
}

function stringifyAttributeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const s = String(value).trim();
  return s.length > 0 ? s : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Stamp attributes overlay the intake attributes. lead_details stays first in
 * projectCampaignDobAge, so a stored canonical age or DOB keeps its precedence.
 */
function payloadForCampaignProjection(normalizedPayload: unknown, sourceAttributes: SourceAttributes): unknown {
  const root = asRecord(normalizedPayload) ?? {};
  const routing = asRecord(root.routing) ?? {};
  const intake = asRecord(routing.source_intake) ?? {};
  const existing = asRecord(intake.sourceAttributes) ?? {};
  return {
    ...root,
    routing: {
      ...routing,
      source_intake: {
        ...intake,
        sourceAttributes: { ...existing, ...sourceAttributes },
      },
    },
  };
}

function campaignStampValues(input: {
  sourceAttributes: SourceAttributes;
  normalizedPayload?: unknown;
  receivedAt?: string | null;
}): { age: string | null; dateOfBirth: string | null } | null {
  if (input.normalizedPayload == null) return null;
  const projected = projectCampaignDobAge({
    normalizedPayload: payloadForCampaignProjection(input.normalizedPayload, input.sourceAttributes),
    receivedAt: input.receivedAt,
  });
  return {
    age: projected.age.trim() || null,
    dateOfBirth: projected.dateOfBirth.trim() || null,
  };
}

export type SourceAttributeStampPlan = {
  valuesByLogicalKey: Record<string, string | null>;
  idMap: Record<string, string>;
  mappableKeys: string[];
  unmappedKeys: string[];
  /** Mapped to a discovered field id, but this lead has no value. Not sent. */
  missingSourceKeys: string[];
  skippedKeys: string[];
};

/**
 * Resolve canonical source attributes → GHL field IDs via discovery (never auto-creates fields).
 * Age and date_of_birth use projectCampaignDobAge when a lifecycle payload is supplied.
 * Without that payload the stamp keeps reading sourceAttributes, including raw DOB text.
 */
export function buildSourceAttributeStampPlan(input: {
  sourceAttributes: SourceAttributes;
  fieldMap: Record<string, SourceAttributeFieldMappingEntry>;
  discoveredFields: GhlDiscoveredCustomField[];
  ignoredCanonicalKeys?: string[];
  normalizedPayload?: unknown;
  receivedAt?: string | null;
}): SourceAttributeStampPlan {
  const ignored = new Set(input.ignoredCanonicalKeys ?? []);
  const discovered = indexDiscovered(input.discoveredFields);
  const valuesByLogicalKey: Record<string, string | null> = {};
  const idMap: Record<string, string> = {};
  const mappableKeys: string[] = [];
  const unmappedKeys: string[] = [];
  const missingSourceKeys: string[] = [];
  const skippedKeys: string[] = [];
  const campaign = campaignStampValues(input);

  for (const [canonical, entry] of Object.entries(input.fieldMap)) {
    if (entry.requirement === "ignored" || ignored.has(canonical)) {
      skippedKeys.push(canonical);
      continue;
    }
    const ghlFieldKey = entry.ghlFieldKey.trim();
    const discoveredField =
      discovered.byId.get(ghlFieldKey) ??
      discovered.byKey.get(ghlFieldKey) ??
      discovered.byKey.get(ghlFieldKey.toLowerCase());
    if (!discoveredField?.id) {
      unmappedKeys.push(canonical);
      continue;
    }
    const value =
      campaign && (canonical === "age" || canonical === "consumer_age")
        ? campaign.age
        : campaign && canonical === "date_of_birth"
          ? campaign.dateOfBirth
          : stringifyAttributeValue(input.sourceAttributes[canonical as keyof SourceAttributes]);
    if (value === null) {
      missingSourceKeys.push(canonical);
      continue;
    }

    valuesByLogicalKey[canonical] = value;
    idMap[canonical] = discoveredField.id;
    mappableKeys.push(canonical);
  }

  return { valuesByLogicalKey, idMap, mappableKeys, unmappedKeys, missingSourceKeys, skippedKeys };
}

export function buildSourceAttributeStampPayload(
  plan: SourceAttributeStampPlan
): ReturnType<typeof buildCustomFieldsForPutFromMap> {
  return buildCustomFieldsForPutFromMap(plan.idMap, plan.valuesByLogicalKey);
}
