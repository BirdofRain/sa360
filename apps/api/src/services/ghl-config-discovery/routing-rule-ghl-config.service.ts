import type { ClientGhlDestination, Prisma } from "@prisma/client";
import type { RoutingRuleGhlConfigBody } from "../../schemas/ghl-config.schema.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import { updateCampaignRoutingRuleDeliveryConfig } from "../../repositories/campaign-routing-rule.repository.js";
import {
  findClientAccountById,
  upsertClientGhlDestination,
} from "../../repositories/client-account.repository.js";
import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";
import { evaluateDeliveryReadiness } from "../delivery-readiness.service.js";
import {
  clientDestinationFieldMappingFromDest,
  mergeRuleForAssessment,
  persistedReadinessAfterAssessment,
  presentRoutingRuleWithReadiness,
  ruleToReadinessInput,
  type ClientDestinationFieldMapping,
  type RoutingRuleWithReadinessItem,
} from "../delivery-readiness-admin.present.js";
import { findLatestGhlLocationConfigSnapshot } from "../../repositories/ghl-location-config-snapshot.repository.js";
import { snapshotToDiscoveryResult } from "./ghl-config-discovery.present.js";
import { detectSa360RequiredCustomFields } from "./ghl-config-discovery.service.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery.types.js";
import { SA360_DEMO_CUSTOM_FIELD_OPTION_MAP } from "@sa360/shared";
import { DIRECT_DEMO_CANONICAL_LOCATION_ID } from "../../lib/direct-demo-delivery-config.js";
import {
  buildFieldMappingSaveReport,
  buildSa360CustomFieldIdMapFromDiscovery,
  mergeSa360CustomFieldIdMaps,
  parseSa360CustomFieldIdMapJson,
  type Sa360CustomFieldIdMap,
  type Sa360FieldMappingSaveReport,
} from "../sa360-custom-field-mapping.service.js";
import {
  mergeSa360CustomFieldOptionMaps,
  parseSa360CustomFieldOptionMapJson,
  type Sa360CustomFieldOptionMap,
} from "../sa360-custom-field-option-mapping.service.js";

export type SaveRoutingRuleGhlConfigResult =
  | {
      item: RoutingRuleWithReadinessItem;
      discoverySummary: Record<string, unknown> | null;
      fieldMapping: Sa360FieldMappingSaveReport;
    }
  | { notFound: true }
  | { error: string; code: "LOCATION_MISMATCH" | "NOT_CONNECTED" | "VALIDATION" };

function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function buildMergedSa360OptionMapForGhlConfigSave(input: {
  existingDest: ClientGhlDestination | null | undefined;
  bodyOptionMapJson?: unknown;
  locationId: string;
}): Sa360CustomFieldOptionMap {
  const existingMap = parseSa360CustomFieldOptionMapJson(
    input.existingDest?.sa360CustomFieldOptionMapJson
  );
  const bodyMap = input.bodyOptionMapJson
    ? parseSa360CustomFieldOptionMapJson(input.bodyOptionMapJson)
    : {};
  const merged = mergeSa360CustomFieldOptionMaps(bodyMap, existingMap);
  if (
    input.locationId === DIRECT_DEMO_CANONICAL_LOCATION_ID &&
    Object.keys(merged).length === 0 &&
    Object.keys(bodyMap).length === 0
  ) {
    return { ...SA360_DEMO_CUSTOM_FIELD_OPTION_MAP };
  }
  return merged;
}

export function buildMergedSa360FieldMapForGhlConfigSave(input: {
  snapFields: GhlDiscoveredCustomField[];
  discoveryCustomFields?: GhlDiscoveredCustomField[];
  existingDest: ClientGhlDestination | null | undefined;
  bodyMapJson?: unknown;
}): Sa360CustomFieldIdMap {
  const fields =
    input.snapFields.length > 0
      ? input.snapFields
      : (input.discoveryCustomFields ?? []);
  const discoveredMap = buildSa360CustomFieldIdMapFromDiscovery(fields);
  const existingMap = parseSa360CustomFieldIdMapJson(input.existingDest?.sa360CustomFieldIdMapJson);
  const bodyMap = input.bodyMapJson
    ? parseSa360CustomFieldIdMapJson(input.bodyMapJson)
    : {};
  return mergeSa360CustomFieldIdMaps(
    mergeSa360CustomFieldIdMaps(bodyMap, discoveredMap),
    existingMap
  );
}

function buildDestinationUpsertData(
  locationId: string,
  existing: ClientGhlDestination | null | undefined,
  body: RoutingRuleGhlConfigBody,
  mergedFieldMap: Sa360CustomFieldIdMap,
  mergedOptionMap: Sa360CustomFieldOptionMap,
  ghlStatus: string,
  snapLocationName: string | null | undefined
): Omit<Prisma.ClientGhlDestinationCreateInput, "clientAccount"> {
  return {
    destinationSubaccountIdGhl: existing?.destinationSubaccountIdGhl ?? locationId,
    locationName: existing?.locationName ?? snapLocationName ?? null,
    ghlConnectionStatus: ghlStatus,
    snapshotInstalled: body.snapshotInstalled ?? existing?.snapshotInstalled ?? false,
    requiredFieldsInstalled:
      body.requiredFieldsInstalled ?? existing?.requiredFieldsInstalled ?? false,
    defaultAssignedUserIdGhl:
      trimOrNull(body.defaultAssignedUserIdGhl) ?? existing?.defaultAssignedUserIdGhl ?? null,
    destinationWorkflowIdGhl:
      trimOrNull(body.destinationWorkflowIdGhl) ?? existing?.destinationWorkflowIdGhl ?? null,
    destinationPipelineIdGhl:
      trimOrNull(body.destinationPipelineIdGhl) ?? existing?.destinationPipelineIdGhl ?? null,
    destinationPipelineStageIdGhl:
      trimOrNull(body.destinationPipelineStageIdGhl) ??
      existing?.destinationPipelineStageIdGhl ??
      null,
    pipelineStageContactingIdGhl: existing?.pipelineStageContactingIdGhl ?? null,
    pipelineStageAppointmentSetIdGhl: existing?.pipelineStageAppointmentSetIdGhl ?? null,
    pipelineStageShowedIdGhl: existing?.pipelineStageShowedIdGhl ?? null,
    pipelineStageSoldIdGhl: existing?.pipelineStageSoldIdGhl ?? null,
    pipelineStageDeadIdGhl: existing?.pipelineStageDeadIdGhl ?? null,
    opportunityCreationEnabled: existing?.opportunityCreationEnabled ?? true,
    sa360CustomFieldIdMapJson: mergedFieldMap as Prisma.InputJsonValue,
    sa360CustomFieldOptionMapJson: mergedOptionMap as Prisma.InputJsonValue,
    customFieldStampRequired:
      body.customFieldStampRequired ?? existing?.customFieldStampRequired ?? false,
    ownerAssignmentRequired:
      body.ownerAssignmentRequired ?? existing?.ownerAssignmentRequired ?? false,
    workflowStartRequired:
      body.workflowStartRequired ?? existing?.workflowStartRequired ?? false,
    workflowTriggerMode:
      body.workflowTriggerMode ?? existing?.workflowTriggerMode ?? "tag_trigger",
    backupSheetEnabled: existing?.backupSheetEnabled ?? false,
    backupSheetId: existing?.backupSheetId ?? null,
    deliveryMode: existing?.deliveryMode ?? "shadow",
    deliveryEnabled: existing?.deliveryEnabled ?? false,
    clientCutoverApproved: existing?.clientCutoverApproved ?? false,
    internalApprovalStatus: existing?.internalApprovalStatus ?? "not_reviewed",
  };
}

export async function getRoutingRuleGhlConfigSummary(ruleId: string) {
  const rule = await findCampaignRoutingRuleById(ruleId.trim());
  if (!rule) return { notFound: true as const };

  const client = await findClientAccountById(rule.clientAccountId);
  const destMapping = clientDestinationFieldMappingFromDest(client?.ghlDestination);

  const locationId = trimOrNull(rule.destinationSubaccountIdGhl);
  let discoverySummary: Record<string, unknown> | null = null;
  if (locationId) {
    const snap = await findLatestGhlLocationConfigSnapshot(locationId);
    if (snap) {
      const fields = detectSa360RequiredCustomFields(
        (snap.customFieldsJson as GhlDiscoveredCustomField[]) ?? []
      );
      const d = snapshotToDiscoveryResult(snap, fields);
      discoverySummary = {
        fetchedAt: d.fetchedAt,
        pipelineCount: d.pipelines.length,
        workflowCount: d.workflows.length,
        requiredFieldsInstalled: d.requiredFields.requiredFieldsInstalled,
        missingRequiredFields: d.requiredFields.missingRequiredFields,
        sa360FieldMapping: d.sa360FieldMapping,
        savedFieldMapping: destMapping?.sa360CustomFieldIdMapJson ?? {},
        customFieldStampRequired: destMapping?.customFieldStampRequired ?? false,
      };
    }
  }

  return {
    rule: {
      id: rule.id,
      clientAccountId: rule.clientAccountId,
      destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
      destinationPipelineIdGhl: rule.destinationPipelineIdGhl,
      destinationPipelineStageIdGhl: rule.destinationPipelineStageIdGhl,
      destinationWorkflowIdGhl: rule.destinationWorkflowIdGhl,
      defaultAssignedUserIdGhl: rule.defaultAssignedUserIdGhl,
      snapshotInstalled: rule.snapshotInstalled,
      requiredFieldsInstalled: rule.requiredFieldsInstalled,
      ghlConnectionStatus: rule.ghlConnectionStatus,
    },
    discoverySummary,
  };
}

export function checkRoutingRuleGhlLocationMismatch(
  ruleLocation: string | null,
  locationId: string,
  confirmLocationMismatch?: boolean
): { error: string; code: "LOCATION_MISMATCH" } | null {
  const trimmed = locationId.trim();
  if (ruleLocation && ruleLocation !== trimmed && confirmLocationMismatch !== true) {
    return {
      error: `locationId ${trimmed} does not match rule destinationSubaccountIdGhl ${ruleLocation}. Set confirmLocationMismatch: true to override.`,
      code: "LOCATION_MISMATCH",
    };
  }
  return null;
}

export async function saveRoutingRuleGhlConfig(
  ruleId: string,
  body: RoutingRuleGhlConfigBody
): Promise<SaveRoutingRuleGhlConfigResult> {
  const existing = await findCampaignRoutingRuleById(ruleId.trim());
  if (!existing) return { notFound: true };

  const locationId = body.locationId.trim();
  const ruleLocation = trimOrNull(existing.destinationSubaccountIdGhl);
  const mismatch = checkRoutingRuleGhlLocationMismatch(
    ruleLocation,
    locationId,
    body.confirmLocationMismatch
  );
  if (mismatch) return mismatch;

  const connection = await findGhlLocationConnectionByLocationId(locationId);
  if (!connection || connection.connectionStatus === "revoked") {
    return {
      error: "No connected GHL OAuth location for this locationId.",
      code: "NOT_CONNECTED",
    };
  }

  const ghlStatus =
    connection.connectionStatus === "connected"
      ? GHL_CONNECTION_CONNECTED
      : connection.connectionStatus;

  const client = await findClientAccountById(existing.clientAccountId);
  const existingDest = client?.ghlDestination ?? null;
  const snap = await findLatestGhlLocationConfigSnapshot(locationId);
  const snapFields = (snap?.customFieldsJson as GhlDiscoveredCustomField[]) ?? [];
  const mergedFieldMap = buildMergedSa360FieldMapForGhlConfigSave({
    snapFields,
    discoveryCustomFields: body.discoveryCustomFields as GhlDiscoveredCustomField[] | undefined,
    existingDest,
    bodyMapJson: body.sa360CustomFieldIdMapJson,
  });
  const mergedOptionMap = buildMergedSa360OptionMapForGhlConfigSave({
    existingDest,
    bodyOptionMapJson: body.sa360CustomFieldOptionMapJson,
    locationId,
  });
  const fieldMappingReport = buildFieldMappingSaveReport(
    mergedFieldMap,
    body.customFieldStampRequired ?? existingDest?.customFieldStampRequired ?? false
  );
  const destMapping: ClientDestinationFieldMapping = {
    sa360CustomFieldIdMapJson: mergedFieldMap,
    sa360CustomFieldOptionMapJson: mergedOptionMap,
    customFieldStampRequired:
      body.customFieldStampRequired ?? existingDest?.customFieldStampRequired ?? false,
    ownerAssignmentRequired:
      body.ownerAssignmentRequired ?? existingDest?.ownerAssignmentRequired ?? false,
    workflowStartRequired:
      body.workflowStartRequired ?? existingDest?.workflowStartRequired ?? false,
    workflowTriggerMode:
      body.workflowTriggerMode ?? existingDest?.workflowTriggerMode ?? "tag_trigger",
  };

  const merged = mergeRuleForAssessment(existing, {
    destinationPipelineIdGhl: body.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: body.destinationPipelineStageIdGhl,
    destinationWorkflowIdGhl: body.destinationWorkflowIdGhl,
    defaultAssignedUserIdGhl: body.defaultAssignedUserIdGhl,
    snapshotInstalled: body.snapshotInstalled,
    requiredFieldsInstalled: body.requiredFieldsInstalled,
    ghlConnectionStatus: ghlStatus,
  });
  if (!ruleLocation) {
    merged.destinationSubaccountIdGhl = locationId;
  }
  merged.sa360CustomFieldIdMapJson = destMapping.sa360CustomFieldIdMapJson;
  merged.sa360CustomFieldOptionMapJson = destMapping.sa360CustomFieldOptionMapJson;
  merged.customFieldStampRequired = destMapping.customFieldStampRequired;

  const assessment = evaluateDeliveryReadiness(merged);

  const data: Prisma.CampaignRoutingRuleUpdateInput = {
    destinationPipelineIdGhl: trimOrNull(body.destinationPipelineIdGhl),
    destinationPipelineStageIdGhl: trimOrNull(body.destinationPipelineStageIdGhl),
    destinationWorkflowIdGhl: trimOrNull(body.destinationWorkflowIdGhl),
    defaultAssignedUserIdGhl: trimOrNull(body.defaultAssignedUserIdGhl),
    ghlConnectionStatus: ghlStatus,
    ...persistedReadinessAfterAssessment(assessment),
  };
  if (body.snapshotInstalled !== undefined) {
    data.snapshotInstalled = body.snapshotInstalled;
  }
  if (body.requiredFieldsInstalled !== undefined) {
    data.requiredFieldsInstalled = body.requiredFieldsInstalled;
  }
  if (!ruleLocation) {
    data.destinationSubaccountIdGhl = locationId;
  }

  const updated = await updateCampaignRoutingRuleDeliveryConfig(existing.id, data);

  await upsertClientGhlDestination(
    existing.clientAccountId,
    buildDestinationUpsertData(
      locationId,
      existingDest,
      body,
      mergedFieldMap,
      mergedOptionMap,
      ghlStatus,
      snap?.locationName
    )
  );

  const refreshedClient = await findClientAccountById(existing.clientAccountId);
  const persistedMapping =
    clientDestinationFieldMappingFromDest(refreshedClient?.ghlDestination) ?? destMapping;
  const item = presentRoutingRuleWithReadiness(updated, persistedMapping);

  const discoverySummary = {
    fetchedAt: snap?.fetchedAt.toISOString() ?? null,
    locationName: snap?.locationName ?? refreshedClient?.ghlDestination?.locationName ?? null,
    fieldMapping: fieldMappingReport,
  };

  return { item, discoverySummary, fieldMapping: fieldMappingReport };
}

export async function ruleReadinessPreview(ruleId: string) {
  const rule = await findCampaignRoutingRuleById(ruleId);
  if (!rule) return null;
  const client = await findClientAccountById(rule.clientAccountId);
  return evaluateDeliveryReadiness(
    ruleToReadinessInput(rule, clientDestinationFieldMappingFromDest(client?.ghlDestination))
  );
}
