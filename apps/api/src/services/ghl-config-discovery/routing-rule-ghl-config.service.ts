import type { ClientGhlDestination, Prisma } from "@prisma/client";
import type { RoutingRuleGhlConfigBody } from "../../schemas/ghl-config.schema.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import { updateCampaignRoutingRuleDeliveryConfig } from "../../repositories/campaign-routing-rule.repository.js";
import {
  findClientAccountById,
  upsertClientGhlDestination,
} from "../../repositories/client-account.repository.js";
import {
  buildDestinationUpsertData,
  ghlStatusFromConnection,
  trimOrNull,
} from "./client-ghl-destination-upsert.js";
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
import type { GhlDiscoveredCustomField, GhlDiscoveredLocation, GhlDiscoveredUser, GhlDiscoveredWorkflow } from "./ghl-config-discovery.types.js";
import {
  informationalDiscoverySummary,
  readInformationalGhlLocationSnapshot,
  withCurrentOperationalSnapshot,
  type GhlOperationalSaveDeps,
} from "./ghl-operational-snapshot.js";
import { lalAiBot1VetSavePatch } from "../ghl-delivery-adapter/lal-ai-bot1-vet-snapshot.js";
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
  | {
      error: string;
      code:
        | "LOCATION_MISMATCH"
        | "NOT_CONNECTED"
        | "VALIDATION"
        | "LAL_WEBFORM_NOT_FOUND"
        | "SNAPSHOT_MISSING"
        | "SNAPSHOT_NOT_CURRENT"
        | "SNAPSHOT_EXPIRED"
        | "SNAPSHOT_FUTURE"
        | "SNAPSHOT_WRONG_LOCATION"
        | "SNAPSHOT_BUSY";
    };

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

export async function getRoutingRuleGhlConfigSummary(ruleId: string) {
  const rule = await findCampaignRoutingRuleById(ruleId.trim());
  if (!rule) return { notFound: true as const };

  const client = await findClientAccountById(rule.clientAccountId);
  const destMapping = clientDestinationFieldMappingFromDest(client?.ghlDestination);

  const locationId = trimOrNull(rule.destinationSubaccountIdGhl);
  const discoverySummary = locationId
    ? informationalDiscoverySummary(await readInformationalGhlLocationSnapshot(locationId), {
        savedFieldMapping: destMapping?.sa360CustomFieldIdMapJson ?? {},
        customFieldStampRequired: destMapping?.customFieldStampRequired ?? false,
      })
    : null;

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
  body: RoutingRuleGhlConfigBody,
  deps: GhlOperationalSaveDeps = {}
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

  const ghlStatus = ghlStatusFromConnection(connection.connectionStatus);
  const authorized = await withCurrentOperationalSnapshot(locationId, deps, async (tx, snap) => {
    await tx.$queryRaw`
      SELECT "id"
      FROM "CampaignRoutingRule"
      WHERE "id" = ${existing.id}
      FOR UPDATE
    `;
    await tx.$queryRaw`
      SELECT "id"
      FROM "ClientGhlDestination"
      WHERE "clientAccountId" = ${existing.clientAccountId}
      FOR UPDATE
    `;
    const lockedRule = await tx.campaignRoutingRule.findUnique({ where: { id: existing.id } });
    if (!lockedRule) return { notFound: true as const };
    const lockedLocation = trimOrNull(lockedRule.destinationSubaccountIdGhl);
    const lockedMismatch = checkRoutingRuleGhlLocationMismatch(
      lockedLocation,
      locationId,
      body.confirmLocationMismatch
    );
    if (lockedMismatch) return lockedMismatch;
    const existingDest = await tx.clientGhlDestination.findUnique({
      where: { clientAccountId: lockedRule.clientAccountId },
    });
    const snapFields = (snap.customFieldsJson as GhlDiscoveredCustomField[]) ?? [];
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
    const location = snap.locationJson as GhlDiscoveredLocation | null;
    const lalPatch = lalAiBot1VetSavePatch({
      applyDemoRetarget: body.applyLalAiBot1WebformConfiguration === true,
      existingWorkflowId: existingDest?.destinationWorkflowIdGhl ?? lockedRule.destinationWorkflowIdGhl,
      existingWorkflowTriggerMode: existingDest?.workflowTriggerMode,
      existingAssignedUserId: existingDest?.defaultAssignedUserIdGhl ?? lockedRule.defaultAssignedUserIdGhl,
      requestedWorkflowId: body.destinationWorkflowIdGhl,
      requestedWorkflowTriggerMode: body.workflowTriggerMode,
      requestedAssignedUserId: body.defaultAssignedUserIdGhl,
      locationId,
      locationPrimaryUserId: location?.primaryUserId,
      workflows: (snap.workflowsJson as GhlDiscoveredWorkflow[] | null) ?? [],
      users: (snap.usersJson as GhlDiscoveredUser[] | null) ?? [],
      discoveredFields: snapFields,
      savedSourceAttributeMap: existingDest?.sourceAttributeFieldMapJson ?? lockedRule.sourceAttributeFieldMapJson,
      requestedSourceAttributeMap: body.sourceAttributeFieldMapJson,
      savedPolicy: existingDest?.sourceEnrichmentPolicyJson,
      requestedPolicy: body.sourceEnrichmentPolicyJson,
    });
    if (!lalPatch.ok) return lalPatch;
    const lal = lalPatch.configuration;
    const effectiveBody = lal.applied
      ? {
          ...body,
          destinationWorkflowIdGhl: lal.destinationWorkflowIdGhl,
          workflowTriggerMode: lal.workflowTriggerMode ?? body.workflowTriggerMode,
          defaultAssignedUserIdGhl: lal.defaultAssignedUserIdGhl ?? body.defaultAssignedUserIdGhl,
          sourceAttributeFieldMapJson: lal.sourceAttributeFieldMap,
          sourceEnrichmentPolicyJson: lal.sourceEnrichmentPolicy,
        }
      : body;
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
        effectiveBody.workflowTriggerMode ?? existingDest?.workflowTriggerMode ?? "tag_trigger",
    };
    const merged = mergeRuleForAssessment(lockedRule, {
      destinationPipelineIdGhl: body.destinationPipelineIdGhl,
      destinationPipelineStageIdGhl: body.destinationPipelineStageIdGhl,
      destinationWorkflowIdGhl: effectiveBody.destinationWorkflowIdGhl,
      defaultAssignedUserIdGhl: effectiveBody.defaultAssignedUserIdGhl,
      snapshotInstalled: body.snapshotInstalled,
      requiredFieldsInstalled: body.requiredFieldsInstalled,
      ghlConnectionStatus: ghlStatus,
    });
    if (!lockedLocation) merged.destinationSubaccountIdGhl = locationId;
    merged.sa360CustomFieldIdMapJson = destMapping.sa360CustomFieldIdMapJson;
    merged.sa360CustomFieldOptionMapJson = destMapping.sa360CustomFieldOptionMapJson;
    merged.customFieldStampRequired = destMapping.customFieldStampRequired;
    const assessment = evaluateDeliveryReadiness(merged);
    const data: Prisma.CampaignRoutingRuleUpdateInput = {
      destinationPipelineIdGhl: trimOrNull(body.destinationPipelineIdGhl),
      destinationPipelineStageIdGhl: trimOrNull(body.destinationPipelineStageIdGhl),
      destinationWorkflowIdGhl: trimOrNull(effectiveBody.destinationWorkflowIdGhl),
      defaultAssignedUserIdGhl: trimOrNull(effectiveBody.defaultAssignedUserIdGhl),
      ...(lal.applied ? { opportunityCreationEnabled: false } : {}),
      ghlConnectionStatus: ghlStatus,
      ...persistedReadinessAfterAssessment(assessment),
    };
    if (body.snapshotInstalled !== undefined) data.snapshotInstalled = body.snapshotInstalled;
    if (body.requiredFieldsInstalled !== undefined) data.requiredFieldsInstalled = body.requiredFieldsInstalled;
    if (!lockedLocation) data.destinationSubaccountIdGhl = locationId;

    const updated = await updateCampaignRoutingRuleDeliveryConfig(lockedRule.id, data, tx);
    await upsertClientGhlDestination(
      lockedRule.clientAccountId,
      buildDestinationUpsertData(
        locationId,
        existingDest,
        effectiveBody,
        mergedFieldMap,
        mergedOptionMap,
        ghlStatus,
        snap.locationName,
        lal.applied ? { opportunityCreationEnabled: false } : undefined
      ),
      tx
    );
    const refreshedDest = await tx.clientGhlDestination.findUnique({
      where: { clientAccountId: lockedRule.clientAccountId },
    });
    const persistedMapping = clientDestinationFieldMappingFromDest(refreshedDest) ?? destMapping;
    return {
      item: presentRoutingRuleWithReadiness(updated, persistedMapping),
      discoverySummary: {
        fetchedAt: snap.fetchedAt.toISOString(),
        locationName: snap.locationName ?? refreshedDest?.locationName ?? null,
        snapshotCurrent: true,
        fieldMapping: fieldMappingReport,
      },
      fieldMapping: fieldMappingReport,
    };
  });
  if (!("ok" in authorized)) return authorized;
  return authorized.value;
}

export async function ruleReadinessPreview(ruleId: string) {
  const rule = await findCampaignRoutingRuleById(ruleId);
  if (!rule) return null;
  const client = await findClientAccountById(rule.clientAccountId);
  return evaluateDeliveryReadiness(
    ruleToReadinessInput(rule, clientDestinationFieldMappingFromDest(client?.ghlDestination))
  );
}
