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

export type SourceAttributeStampPlan = {
  valuesByLogicalKey: Record<string, string | null>;
  idMap: Record<string, string>;
  mappableKeys: string[];
  unmappedKeys: string[];
  /** Mapped to a discovered field id, but this lead has no value. Not sent. */
  missingSourceKeys: string[];
  skippedKeys: string[];
};

/** Resolve canonical source attributes → GHL field IDs via discovery (never auto-creates fields). */
export function buildSourceAttributeStampPlan(input: {
  sourceAttributes: SourceAttributes;
  fieldMap: Record<string, SourceAttributeFieldMappingEntry>;
  discoveredFields: GhlDiscoveredCustomField[];
  ignoredCanonicalKeys?: string[];
}): SourceAttributeStampPlan {
  const ignored = new Set(input.ignoredCanonicalKeys ?? []);
  const discovered = indexDiscovered(input.discoveredFields);
  const valuesByLogicalKey: Record<string, string | null> = {};
  const idMap: Record<string, string> = {};
  const mappableKeys: string[] = [];
  const unmappedKeys: string[] = [];
  const missingSourceKeys: string[] = [];
  const skippedKeys: string[] = [];

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
    const value = stringifyAttributeValue(input.sourceAttributes[canonical as keyof SourceAttributes]);
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
