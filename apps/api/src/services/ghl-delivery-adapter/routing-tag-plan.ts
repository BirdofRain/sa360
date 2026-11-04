/**
 * Known write-plan gate for tag previews.
 * Matches the collisions and unresolved delivery_required keys the executor
 * can see before an HTTP call. A later stamp failure is not known here.
 */
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";
import { buildTypedCustomFieldStampPlan } from "./ghl-custom-field-stamp-plan.js";
import {
  buildCustomFieldStampRequest,
  buildLiveCanaryCustomFieldsMap,
} from "./ghl-delivery-request-builders.js";
import {
  parseSa360CustomFieldIdMapJson,
  resolveAndAssessSa360FieldMapping,
  resolveSa360CustomFieldKeyMap,
} from "../sa360-custom-field-mapping.service.js";
import { parseSa360CustomFieldOptionMapJson } from "../sa360-custom-field-option-mapping.service.js";
import { buildSourceAttributeStampPlan } from "../source-intake/source-attribute-stamp.service.js";

export function knownWritePlanBlocksAutomationEntry(ctx: GhlAdapterPlanContext): boolean {
  const enrichment = ctx.sourceEnrichment;
  if (enrichment) {
    const sourcePlan = buildSourceAttributeStampPlan({
      sourceAttributes: enrichment.sourceAttributes,
      fieldMap: enrichment.sourceAttributeFieldMap,
      discoveredFields: ctx.destinationFieldMapping?.discoveredCustomFields ?? [],
      ignoredCanonicalKeys: enrichment.sourceEnrichmentPolicy.ignoredCanonicalKeys,
      normalizedPayload: enrichment.normalizedPayload,
      receivedAt: enrichment.receivedAt,
    });
    if (sourcePlan.collisions.length > 0 || sourcePlan.unresolvedDeliveryRequired.length > 0) return true;
  }

  const mapping = ctx.destinationFieldMapping;
  if (!mapping) return false;
  const destMap = parseSa360CustomFieldIdMapJson(mapping.sa360CustomFieldIdMapJson);
  const hasDestinationFieldMap = Object.values(destMap).some((value) => value?.trim());
  const fieldMapping = resolveAndAssessSa360FieldMapping({
    destinationMapJson: mapping.sa360CustomFieldIdMapJson,
    useEnvFallback: !hasDestinationFieldMap,
    customFieldStampRequired: mapping.customFieldStampRequired,
  });
  const keyMap = resolveSa360CustomFieldKeyMap({
    destinationKeyMapJson: mapping.sa360CustomFieldKeyMapJson,
    discoveredFields: mapping.discoveredCustomFields,
  });
  const optionMap = parseSa360CustomFieldOptionMapJson(mapping.sa360CustomFieldOptionMapJson);
  const values = {
    ...buildLiveCanaryCustomFieldsMap(ctx, "preview"),
    sa360_routing_status: "LIVE_CANARY_DELIVERED",
  };
  const stamp = buildCustomFieldStampRequest(ctx, values);
  const typed = buildTypedCustomFieldStampPlan({
    idMap: fieldMapping.idMap,
    values: stamp.customFields,
    keyMap,
    optionMap,
    discoveredFields: mapping.discoveredCustomFields,
  });
  return typed.collisions.length > 0;
}
