import type { CampaignRoutingRule, ClientGhlDestination } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { tryNormalizeToVerifiedE164 } from "../phone-e164.service.js";
import type { CanonicalSourceAttributeKey } from "./source-field-alias.registry.js";
import type {
  AutomationReadiness,
  EnrichmentStatus,
  IntakeStatus,
  SourceAttributeFieldMappingEntry,
  SourceAttributes,
  SourceEnrichmentDeliveryContext,
  SourceEnrichmentMetadata,
  SourceEnrichmentPolicy,
  SourceFieldRequirement,
} from "./source-enrichment.types.js";

const DEFAULT_AI_CONTEXT_REQUIRED: CanonicalSourceAttributeKey[] = [
  "branch_of_service",
  "best_time_to_call",
  "desired_coverage",
];

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function parseJsonRecord<T extends Record<string, unknown>>(raw: unknown): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {} as T;
  return raw as T;
}

export function parseSourceAttributeFieldMapJson(raw: unknown): Record<string, SourceAttributeFieldMappingEntry> {
  const record = parseJsonRecord<Record<string, unknown>>(raw);
  const out: Record<string, SourceAttributeFieldMappingEntry> = {};
  for (const [canonical, value] of Object.entries(record)) {
    if (typeof value === "string" && value.trim()) {
      out[canonical] = { ghlFieldKey: value.trim(), requirement: "optional" };
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entry = value as Record<string, unknown>;
      const ghlFieldKey = trimOrUndefined(entry.ghlFieldKey);
      if (!ghlFieldKey) continue;
      const requirement = entry.requirement as SourceFieldRequirement | undefined;
      out[canonical] = {
        ghlFieldKey,
        requirement: requirement ?? "optional",
      };
    }
  }
  return out;
}

export function parseSourceEnrichmentPolicyJson(raw: unknown): SourceEnrichmentPolicy {
  const record = parseJsonRecord<Record<string, unknown>>(raw);
  const aiContextRequired = Array.isArray(record.aiContextRequired)
    ? (record.aiContextRequired.filter((k) => typeof k === "string") as CanonicalSourceAttributeKey[])
    : undefined;
  const ignoredCanonicalKeys = Array.isArray(record.ignoredCanonicalKeys)
    ? (record.ignoredCanonicalKeys.filter((k) => typeof k === "string") as CanonicalSourceAttributeKey[])
    : undefined;
  const limitedAutomationBehavior = record.limitedAutomationBehavior;
  return {
    aiContextRequired: aiContextRequired?.length ? aiContextRequired : DEFAULT_AI_CONTEXT_REQUIRED,
    ignoredCanonicalKeys,
    limitedAutomationBehavior:
      limitedAutomationBehavior === "queue_for_review" ||
      limitedAutomationBehavior === "wait_for_enrichment"
        ? limitedAutomationBehavior
        : "basic_voice_ai",
  };
}

export function parseRouteAliasOverridesJson(raw: unknown): Record<string, readonly string[]> {
  const record = parseJsonRecord<Record<string, unknown>>(raw);
  const out: Record<string, readonly string[]> = {};
  for (const [canonical, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      out[canonical] = value.filter((v) => typeof v === "string") as string[];
    }
  }
  return out;
}

/** Route-level mapping overrides destination-level. */
export function resolveEffectiveSourceAttributeFieldMap(
  destination: { sourceAttributeFieldMapJson?: unknown } | null | undefined,
  rule: { sourceAttributeFieldMapJson?: unknown } | null | undefined
): Record<string, SourceAttributeFieldMappingEntry> {
  const destMap = parseSourceAttributeFieldMapJson(destination?.sourceAttributeFieldMapJson);
  const routeMap = parseSourceAttributeFieldMapJson(rule?.sourceAttributeFieldMapJson);
  return { ...destMap, ...routeMap };
}

export function resolveEffectiveRouteAliasOverrides(
  destination: { sourceFieldAliasOverridesJson?: unknown } | null | undefined,
  rule: { sourceFieldAliasOverridesJson?: unknown } | null | undefined
): Record<string, readonly string[]> {
  const dest = parseRouteAliasOverridesJson(destination?.sourceFieldAliasOverridesJson);
  const route = parseRouteAliasOverridesJson(rule?.sourceFieldAliasOverridesJson);
  const merged: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(dest)) merged[k] = [...v];
  for (const [k, v] of Object.entries(route)) merged[k] = [...(merged[k] ?? []), ...v];
  return merged;
}

export function hasDeliverableIdentity(payload: LifecycleEventSchema): {
  ok: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  const first = trimOrUndefined(payload.contact.first_name);
  const last = trimOrUndefined(payload.contact.last_name);
  const full = trimOrUndefined((payload.contact as { full_name?: string }).full_name);
  const hasName = Boolean(first || last || full);
  if (!hasName) blockers.push("Name required: first name, last name, or full name.");

  const phone = trimOrUndefined(payload.contact.phone_e164) ?? trimOrUndefined(payload.contact.phone);
  const phoneOk = phone ? tryNormalizeToVerifiedE164(phone).ok : false;
  if (!phoneOk) blockers.push("Valid phone required for delivery.");

  const leadUid = trimOrUndefined(payload.contact.lead_uid);
  if (!leadUid) blockers.push("Stable lead_uid required.");

  return { ok: blockers.length === 0, blockers };
}

export function evaluateSourceEnrichment(input: {
  sourceAttributes: SourceAttributes;
  unmappedSourceFieldKeys: string[];
  sourceAttributeFieldMap: Record<string, SourceAttributeFieldMappingEntry>;
  sourceEnrichmentPolicy: SourceEnrichmentPolicy;
  routingMatched: boolean;
  identityValid: boolean;
}): Pick<
  SourceEnrichmentMetadata,
  | "enrichmentStatus"
  | "automationReadiness"
  | "missingOptionalFields"
  | "missingAiContextFields"
  | "mappedFieldCount"
  | "deliveryEligible"
  | "deliveryBlockers"
  | "deliveryWarnings"
> {
  const policy = input.sourceEnrichmentPolicy;
  const ignored = new Set(policy.ignoredCanonicalKeys ?? []);
  const aiRequired = policy.aiContextRequired ?? DEFAULT_AI_CONTEXT_REQUIRED;

  const deliveryBlockers: string[] = [];
  if (!input.identityValid) {
    deliveryBlockers.push("Identity requirements not met (name + phone + lead_uid).");
  }
  if (!input.routingMatched) {
    deliveryBlockers.push("No routing rule matched.");
  }

  const presentKeys = Object.entries(input.sourceAttributes)
    .filter(([k, v]) => !ignored.has(k as CanonicalSourceAttributeKey) && v !== null && v !== undefined)
    .map(([k]) => k);

  const mappedFieldCount = presentKeys.filter((k) => Boolean(input.sourceAttributeFieldMap[k])).length;

  const missingOptionalFields: string[] = [];
  for (const [canonical, entry] of Object.entries(input.sourceAttributeFieldMap)) {
    if (entry.requirement !== "optional") continue;
    if (ignored.has(canonical as CanonicalSourceAttributeKey)) continue;
    if (input.sourceAttributes[canonical as CanonicalSourceAttributeKey] === undefined) {
      missingOptionalFields.push(canonical);
    }
  }

  const missingAiContextFields = aiRequired.filter(
    (k) => !ignored.has(k) && input.sourceAttributes[k] === undefined
  );

  let enrichmentStatus: EnrichmentStatus;
  if (input.unmappedSourceFieldKeys.length > 0 && mappedFieldCount === 0 && presentKeys.length > 0) {
    enrichmentStatus = "mapping_required";
  } else if (presentKeys.length === 0) {
    enrichmentStatus = "none";
  } else if (missingOptionalFields.length > 0 || input.unmappedSourceFieldKeys.length > 0) {
    enrichmentStatus = "partial";
  } else {
    enrichmentStatus = "complete";
  }

  let automationReadiness: AutomationReadiness;
  if (missingAiContextFields.length > 0) {
    automationReadiness = "limited";
  } else if (enrichmentStatus === "mapping_required") {
    automationReadiness = "limited";
  } else {
    automationReadiness = "ready";
  }

  const deliveryWarnings: string[] = [];
  if (missingOptionalFields.length > 0) {
    deliveryWarnings.push(`Missing optional survey fields: ${missingOptionalFields.join(", ")}`);
  }
  if (input.unmappedSourceFieldKeys.length > 0) {
    deliveryWarnings.push(
      `${input.unmappedSourceFieldKeys.length} unmapped source field(s) preserved for review.`
    );
  }
  if (missingAiContextFields.length > 0) {
    deliveryWarnings.push(`Voice AI context limited — missing: ${missingAiContextFields.join(", ")}`);
  }

  return {
    enrichmentStatus,
    automationReadiness,
    missingOptionalFields,
    missingAiContextFields,
    mappedFieldCount,
    deliveryEligible: deliveryBlockers.length === 0,
    deliveryBlockers,
    deliveryWarnings,
  };
}

export function deriveIntakeStatus(
  eventStatus: string,
  identityValid: boolean,
  routingMatched: boolean
): IntakeStatus {
  if (!identityValid) return "invalid_identity";
  if (eventStatus === "routing_matched" || (routingMatched && eventStatus !== "routing_unmatched")) {
    return "routing_matched";
  }
  if (eventStatus === "routing_unmatched" || !routingMatched) return "routing_unmatched";
  if (eventStatus === "normalized") return "normalized";
  return "received";
}

export function buildSourceEnrichmentDeliveryContext(
  payload: LifecycleEventSchema,
  destination: ClientGhlDestination | null | undefined,
  rule: CampaignRoutingRule | null | undefined
): SourceEnrichmentDeliveryContext {
  const intake = payload.routing?.source_intake as
    | {
        sourceAttributes?: SourceAttributes;
        compliance?: SourceAttributes;
        unmappedSourceFieldsJson?: Array<{ key: string }>;
      }
    | undefined;
  const sourceAttributes: SourceAttributes = {
    ...(intake?.compliance ?? {}),
    ...(intake?.sourceAttributes ?? {}),
  };

  const unmappedSourceFieldKeys = (intake?.unmappedSourceFieldsJson ?? []).map((u) => u.key);

  const policy = parseSourceEnrichmentPolicyJson(destination?.sourceEnrichmentPolicyJson);
  const fieldMap = resolveEffectiveSourceAttributeFieldMap(destination, rule);

  const enrichment = evaluateSourceEnrichment({
    sourceAttributes,
    unmappedSourceFieldKeys,
    sourceAttributeFieldMap: fieldMap,
    sourceEnrichmentPolicy: policy,
    routingMatched: true,
    identityValid: true,
  });

  return {
    sourceAttributes,
    enrichmentStatus: enrichment.enrichmentStatus,
    automationReadiness: enrichment.automationReadiness,
    missingOptionalFields: enrichment.missingOptionalFields,
    unmappedSourceFieldKeys,
    sourceAttributeFieldMap: fieldMap,
    sourceEnrichmentPolicy: policy,
  };
}

export function presentFieldMappingRows(input: {
  sourceAttributes: SourceAttributes;
  unmappedSourceFields: Array<{ key: string; value: unknown }>;
  fieldMap: Record<string, SourceAttributeFieldMappingEntry>;
  discoveredFieldKeys: Set<string>;
}): Array<{
  incomingField: string;
  canonicalAttribute: string | null;
  exampleValue: string | null;
  destinationGhlField: string | null;
  requirement: SourceFieldRequirement;
  status: "mapped" | "missing" | "incompatible" | "unknown";
}> {
  const rows: Array<{
    incomingField: string;
    canonicalAttribute: string | null;
    exampleValue: string | null;
    destinationGhlField: string | null;
    requirement: SourceFieldRequirement;
    status: "mapped" | "missing" | "incompatible" | "unknown";
  }> = [];

  for (const [canonical, value] of Object.entries(input.sourceAttributes)) {
    const entry = input.fieldMap[canonical];
    const ghlKey = entry?.ghlFieldKey ?? null;
    let status: "mapped" | "missing" | "incompatible" | "unknown" = "unknown";
    if (!ghlKey) status = "unknown";
    else if (value === undefined || value === null) status = "missing";
    else if (!input.discoveredFieldKeys.has(ghlKey)) status = "incompatible";
    else status = "mapped";
    rows.push({
      incomingField: canonical,
      canonicalAttribute: canonical,
      exampleValue: value === null || value === undefined ? null : String(value),
      destinationGhlField: ghlKey,
      requirement: entry?.requirement ?? "optional",
      status,
    });
  }

  for (const unmapped of input.unmappedSourceFields) {
    rows.push({
      incomingField: unmapped.key,
      canonicalAttribute: null,
      exampleValue:
        unmapped.value === null || unmapped.value === undefined ? null : String(unmapped.value),
      destinationGhlField: null,
      requirement: "optional",
      status: "unknown",
    });
  }

  return rows;
}
