import type { Prisma } from "@prisma/client";
import {
  createCampaignRoutingRule,
  deleteCampaignRoutingRuleById,
  findCampaignRoutingRuleById,
  updateCampaignRoutingRule,
} from "../repositories/campaign-routing-rule.repository.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import type {
  RoutingRuleCreateBody,
  RoutingRulePatchBody,
} from "../schemas/routing-rule.schema.js";
import { applyClientDestinationDefaultsToRule } from "./client-destination-defaults.service.js";
import {
  evaluateDeliveryReadiness,
  persistableReadinessFields,
  type DeliveryReadinessRuleInput,
} from "./delivery-readiness.service.js";
import { presentRoutingRuleWithReadiness } from "./delivery-readiness-admin.present.js";

function trimOrNull(v?: string | null): string | null {
  const t = v?.trim();
  return t ? t : null;
}

function bodyToCreateInput(
  body: RoutingRuleCreateBody,
  destinationDefaults: Record<string, unknown>
): Prisma.CampaignRoutingRuleCreateInput {
  const merged = applyClientDestinationDefaultsToRule(
    {
      masterClientAccountId: body.masterClientAccountId.trim(),
      clientAccountId: body.clientAccountId.trim(),
      destinationSubaccountIdGhl:
        body.destinationSubaccountIdGhl?.trim() ??
        (destinationDefaults.destinationSubaccountIdGhl as string) ??
        "",
      clientDisplayName: trimOrNull(body.clientDisplayName),
      locationName: trimOrNull(body.locationName),
      nicheKey: trimOrNull(body.nicheKey),
      productType: trimOrNull(body.productType),
      sourcePlatform: trimOrNull(body.sourcePlatform),
      sourceType: trimOrNull(body.sourceType),
      campaignId: trimOrNull(body.campaignId),
      campaignName: trimOrNull(body.campaignName),
      adsetId: trimOrNull(body.adsetId),
      adId: trimOrNull(body.adId),
      formId: trimOrNull(body.formId),
      utmCampaign: trimOrNull(body.utmCampaign),
      utmContent: trimOrNull(body.utmContent),
      masterDatasetId: trimOrNull(body.masterDatasetId),
      matchType: body.matchType,
      keywordPattern: trimOrNull(body.keywordPattern),
      priority: body.priority ?? 100,
      active: body.active ?? true,
      effectiveStart: body.effectiveStart ? new Date(body.effectiveStart) : undefined,
      effectiveEnd: body.effectiveEnd ? new Date(body.effectiveEnd) : undefined,
      deliveryEnabled: false,
      shadowDeliveryEnabled: true,
      deliveryMode: "shadow",
    },
    destinationDefaults as never
  );

  return merged as Prisma.CampaignRoutingRuleCreateInput;
}

function patchToUpdateInput(body: RoutingRulePatchBody): Prisma.CampaignRoutingRuleUpdateInput {
  const data: Prisma.CampaignRoutingRuleUpdateInput = {};
  if (body.clientDisplayName !== undefined) data.clientDisplayName = body.clientDisplayName;
  if (body.destinationSubaccountIdGhl !== undefined) {
    data.destinationSubaccountIdGhl = body.destinationSubaccountIdGhl.trim();
  }
  if (body.locationName !== undefined) data.locationName = body.locationName;
  if (body.nicheKey !== undefined) data.nicheKey = body.nicheKey;
  if (body.productType !== undefined) data.productType = body.productType;
  if (body.sourcePlatform !== undefined) data.sourcePlatform = body.sourcePlatform;
  if (body.sourceType !== undefined) data.sourceType = body.sourceType;
  if (body.campaignId !== undefined) data.campaignId = body.campaignId;
  if (body.campaignName !== undefined) data.campaignName = body.campaignName;
  if (body.adsetId !== undefined) data.adsetId = body.adsetId;
  if (body.adId !== undefined) data.adId = body.adId;
  if (body.formId !== undefined) data.formId = body.formId;
  if (body.utmCampaign !== undefined) data.utmCampaign = body.utmCampaign;
  if (body.utmContent !== undefined) data.utmContent = body.utmContent;
  if (body.masterDatasetId !== undefined) data.masterDatasetId = body.masterDatasetId;
  if (body.matchType !== undefined) data.matchType = body.matchType;
  if (body.keywordPattern !== undefined) data.keywordPattern = body.keywordPattern;
  if (body.priority !== undefined) data.priority = body.priority;
  if (body.active !== undefined) data.active = body.active;
  if (body.effectiveStart !== undefined) {
    data.effectiveStart = body.effectiveStart ? new Date(body.effectiveStart) : null;
  }
  if (body.effectiveEnd !== undefined) {
    data.effectiveEnd = body.effectiveEnd ? new Date(body.effectiveEnd) : null;
  }
  return data;
}

function readinessInputFromRule(rule: {
  id: string;
  masterClientAccountId: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  clientDisplayName: string | null;
  destinationWorkflowIdGhl: string | null;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  defaultAssignedUserIdGhl: string | null;
  backupSheetEnabled: boolean;
  backupSheetId: string | null;
  ghlConnectionStatus: string | null;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  opportunityCreationEnabled: boolean;
  active: boolean;
}): DeliveryReadinessRuleInput {
  return {
    id: rule.id,
    masterClientAccountId: rule.masterClientAccountId,
    clientAccountId: rule.clientAccountId,
    destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
    clientDisplayName: rule.clientDisplayName,
    destinationWorkflowIdGhl: rule.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: rule.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: rule.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl: rule.defaultAssignedUserIdGhl,
    backupSheetEnabled: rule.backupSheetEnabled,
    backupSheetId: rule.backupSheetId,
    ghlConnectionStatus: rule.ghlConnectionStatus,
    snapshotInstalled: rule.snapshotInstalled,
    requiredFieldsInstalled: rule.requiredFieldsInstalled,
    deliveryMode: rule.deliveryMode,
    deliveryEnabled: rule.deliveryEnabled,
    clientCutoverApproved: rule.clientCutoverApproved,
    internalApprovalStatus: rule.internalApprovalStatus,
    opportunityCreationEnabled: rule.opportunityCreationEnabled,
    active: rule.active,
  };
}

async function persistReadinessAfterWrite(
  rule: Awaited<ReturnType<typeof findCampaignRoutingRuleById>>
) {
  if (!rule) return null;
  const assessment = evaluateDeliveryReadiness(readinessInputFromRule(rule));
  return updateCampaignRoutingRule(rule.id, persistableReadinessFields(assessment));
}

export type CreateRoutingRuleResult =
  | { item: ReturnType<typeof presentRoutingRuleWithReadiness> extends infer R ? R : never }
  | { error: string; code: "CLIENT_NOT_FOUND" | "VALIDATION" };

export async function createRoutingRuleAdmin(
  body: RoutingRuleCreateBody
): Promise<CreateRoutingRuleResult> {
  const client = await findClientAccountById(body.clientAccountId);
  if (!client) {
    return {
      error: "clientAccountId must exist on a ClientAccount before creating routing rules",
      code: "CLIENT_NOT_FOUND",
    };
  }

  const dest = client.ghlDestination;
  const createInput = bodyToCreateInput(body, dest ?? {});
  if (dest) {
    Object.assign(createInput, {
      destinationWorkflowIdGhl:
        createInput.destinationWorkflowIdGhl ?? dest.destinationWorkflowIdGhl,
      destinationPipelineIdGhl:
        createInput.destinationPipelineIdGhl ?? dest.destinationPipelineIdGhl,
      destinationPipelineStageIdGhl:
        createInput.destinationPipelineStageIdGhl ?? dest.destinationPipelineStageIdGhl,
      defaultAssignedUserIdGhl:
        createInput.defaultAssignedUserIdGhl ?? dest.defaultAssignedUserIdGhl,
      ghlConnectionStatus: createInput.ghlConnectionStatus ?? dest.ghlConnectionStatus,
      snapshotInstalled: createInput.snapshotInstalled ?? dest.snapshotInstalled,
      requiredFieldsInstalled:
        createInput.requiredFieldsInstalled ?? dest.requiredFieldsInstalled,
      backupSheetEnabled: createInput.backupSheetEnabled ?? dest.backupSheetEnabled,
      backupSheetId: createInput.backupSheetId ?? dest.backupSheetId,
      opportunityCreationEnabled:
        createInput.opportunityCreationEnabled ?? dest.opportunityCreationEnabled,
    });
  }

  const created = await createCampaignRoutingRule(createInput);
  const updated = await persistReadinessAfterWrite(created);
  return { item: presentRoutingRuleWithReadiness(updated ?? created) };
}

export type PatchRoutingRuleResult =
  | { item: ReturnType<typeof presentRoutingRuleWithReadiness> extends infer R ? R : never }
  | { notFound: true };

export async function patchRoutingRuleAdmin(
  ruleId: string,
  body: RoutingRulePatchBody
): Promise<PatchRoutingRuleResult> {
  const existing = await findCampaignRoutingRuleById(ruleId.trim());
  if (!existing) return { notFound: true };

  const updated = await updateCampaignRoutingRule(existing.id, patchToUpdateInput(body));
  const withReadiness = await persistReadinessAfterWrite(updated);
  return { item: presentRoutingRuleWithReadiness(withReadiness ?? updated) };
}

export async function getRoutingRuleAdmin(ruleId: string) {
  const rule = await findCampaignRoutingRuleById(ruleId.trim());
  if (!rule) return { notFound: true as const };
  return { item: presentRoutingRuleWithReadiness(rule) };
}

export type DeleteRoutingRuleResult =
  | { deleted: true; id: string }
  | { notFound: true }
  | { error: string; code: "CONFIRMATION_REQUIRED" };

export async function deleteRoutingRuleAdmin(
  ruleId: string,
  confirm: boolean
): Promise<DeleteRoutingRuleResult> {
  if (!confirm) {
    return {
      error: "Set confirm=true to delete this routing rule.",
      code: "CONFIRMATION_REQUIRED",
    };
  }
  const existing = await findCampaignRoutingRuleById(ruleId.trim());
  if (!existing) return { notFound: true };
  await deleteCampaignRoutingRuleById(existing.id);
  return { deleted: true, id: existing.id };
}
