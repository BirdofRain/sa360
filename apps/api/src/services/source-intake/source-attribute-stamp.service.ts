import type { GhlDiscoveredCustomField } from "../ghl-config-discovery/ghl-config-discovery.types.js";
import { buildCustomFieldsForPutFromMap } from "../ghl-delivery-adapter/ghl-live-transport.js";
import type { SourceAttributes, SourceAttributeFieldMappingEntry } from "./source-enrichment.types.js";

function indexDiscoveredByFieldKey(
  fields: GhlDiscoveredCustomField[]
): Map<string, GhlDiscoveredCustomField> {
  const map = new Map<string, GhlDiscoveredCustomField>();
  for (const field of fields) {
    const keys = [field.fieldKey, field.key].filter(Boolean) as string[];
    for (const k of keys) {
      map.set(k.trim(), field);
      map.set(k.trim().toLowerCase(), field);
    }
  }
  return map;
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
  const discovered = indexDiscoveredByFieldKey(input.discoveredFields);
  const valuesByLogicalKey: Record<string, string | null> = {};
  const idMap: Record<string, string> = {};
  const mappableKeys: string[] = [];
  const unmappedKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const [canonical, entry] of Object.entries(input.fieldMap)) {
    if (entry.requirement === "ignored" || ignored.has(canonical)) {
      skippedKeys.push(canonical);
      continue;
    }
    const value = stringifyAttributeValue(input.sourceAttributes[canonical as keyof SourceAttributes]);
    if (value === null) continue;

    const ghlFieldKey = entry.ghlFieldKey.trim();
    const discoveredField =
      discovered.get(ghlFieldKey) ?? discovered.get(ghlFieldKey.toLowerCase());
    if (!discoveredField?.id) {
      unmappedKeys.push(canonical);
      continue;
    }

    valuesByLogicalKey[canonical] = value;
    idMap[canonical] = discoveredField.id;
    mappableKeys.push(canonical);
  }

  return { valuesByLogicalKey, idMap, mappableKeys, unmappedKeys, skippedKeys };
}

export function buildSourceAttributeStampPayload(
  plan: SourceAttributeStampPlan
): ReturnType<typeof buildCustomFieldsForPutFromMap> {
  return buildCustomFieldsForPutFromMap(plan.idMap, plan.valuesByLogicalKey);
}
