import type { CampaignRoutingRule } from "@prisma/client";
import { findClientGhlDestinationsByClientIds } from "../repositories/client-account.repository.js";
import {
  evaluateDeliveryReadiness,
  persistableReadinessFields,
  type DeliveryReadinessAssessment,
  type DeliveryReadinessRuleInput,
} from "./delivery-readiness.service.js";

export type RoutingRuleWithReadinessItem = {
  id: string;
  masterClientAccountId: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  clientDisplayName: string | null;
  locationName: string | null;
  nicheKey: string | null;
  productType: string | null;
  campaignId: string | null;
  campaignName: string | null;
  utmCampaign: string | null;
  matchType: string;
  active: boolean;
  priority: number;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  readinessStatus: string;
  lastReadinessCheckAt: string | null;
  ghlConnectionStatus: string | null;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  destinationWorkflowIdGhl: string | null;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  backupSheetEnabled: boolean;
  backupSheetId: string | null;
  defaultAssignedUserIdGhl: string | null;
  opportunityCreationEnabled: boolean;
  readiness: DeliveryReadinessAssessment;
};

export type ClientDestinationFieldMapping = {
  sa360CustomFieldIdMapJson: unknown;
  customFieldStampRequired: boolean;
  ownerAssignmentRequired?: boolean;
  workflowStartRequired?: boolean;
};

export function ruleToReadinessInput(
  rule: CampaignRoutingRule,
  destination?: ClientDestinationFieldMapping | null
): DeliveryReadinessRuleInput {
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
    sa360CustomFieldIdMapJson: destination?.sa360CustomFieldIdMapJson,
    customFieldStampRequired: destination?.customFieldStampRequired,
  };
}

export function presentRoutingRuleWithReadiness(
  rule: CampaignRoutingRule,
  destination?: ClientDestinationFieldMapping | null
): RoutingRuleWithReadinessItem {
  const readiness = evaluateDeliveryReadiness(ruleToReadinessInput(rule, destination));
  return {
    id: rule.id,
    masterClientAccountId: rule.masterClientAccountId,
    clientAccountId: rule.clientAccountId,
    destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
    clientDisplayName: rule.clientDisplayName,
    locationName: rule.locationName,
    nicheKey: rule.nicheKey,
    productType: rule.productType,
    campaignId: rule.campaignId,
    campaignName: rule.campaignName,
    utmCampaign: rule.utmCampaign,
    matchType: rule.matchType,
    active: rule.active,
    priority: rule.priority,
    deliveryMode: rule.deliveryMode,
    deliveryEnabled: rule.deliveryEnabled,
    clientCutoverApproved: rule.clientCutoverApproved,
    internalApprovalStatus: rule.internalApprovalStatus,
    readinessStatus: rule.readinessStatus,
    lastReadinessCheckAt: rule.lastReadinessCheckAt?.toISOString() ?? null,
    ghlConnectionStatus: rule.ghlConnectionStatus,
    snapshotInstalled: rule.snapshotInstalled,
    requiredFieldsInstalled: rule.requiredFieldsInstalled,
    destinationWorkflowIdGhl: rule.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: rule.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: rule.destinationPipelineStageIdGhl,
    backupSheetEnabled: rule.backupSheetEnabled,
    backupSheetId: rule.backupSheetId,
    defaultAssignedUserIdGhl: rule.defaultAssignedUserIdGhl,
    opportunityCreationEnabled: rule.opportunityCreationEnabled,
    readiness,
  };
}

export function presentRoutingRulesWithReadiness(
  rules: CampaignRoutingRule[],
  destinationByClientId?: Map<string, ClientDestinationFieldMapping>
): RoutingRuleWithReadinessItem[] {
  return rules.map((rule) =>
    presentRoutingRuleWithReadiness(
      rule,
      destinationByClientId?.get(rule.clientAccountId) ?? null
    )
  );
}

export async function presentRoutingRulesWithReadinessEnriched(
  rules: CampaignRoutingRule[]
): Promise<RoutingRuleWithReadinessItem[]> {
  const clientIds = [...new Set(rules.map((r) => r.clientAccountId))];
  const destinations = await findClientGhlDestinationsByClientIds(clientIds);
  const destinationByClientId = new Map(
    destinations.map((d) => [
      d.clientAccountId,
      {
        sa360CustomFieldIdMapJson: d.sa360CustomFieldIdMapJson,
        customFieldStampRequired: d.customFieldStampRequired,
        ownerAssignmentRequired: d.ownerAssignmentRequired,
        workflowStartRequired: d.workflowStartRequired,
      },
    ])
  );
  return presentRoutingRulesWithReadiness(rules, destinationByClientId);
}

export function deliveryConfigUpdateFromPatch(
  patch: import("../schemas/delivery-readiness.schema.js").RoutingRuleDeliveryConfigPatch
): import("@prisma/client").Prisma.CampaignRoutingRuleUpdateInput {
  const data: import("@prisma/client").Prisma.CampaignRoutingRuleUpdateInput = {};
  if (patch.destinationWorkflowIdGhl !== undefined) {
    data.destinationWorkflowIdGhl = patch.destinationWorkflowIdGhl;
  }
  if (patch.destinationPipelineIdGhl !== undefined) {
    data.destinationPipelineIdGhl = patch.destinationPipelineIdGhl;
  }
  if (patch.destinationPipelineStageIdGhl !== undefined) {
    data.destinationPipelineStageIdGhl = patch.destinationPipelineStageIdGhl;
  }
  if (patch.defaultAssignedUserIdGhl !== undefined) {
    data.defaultAssignedUserIdGhl = patch.defaultAssignedUserIdGhl;
  }
  if (patch.backupSheetEnabled !== undefined) data.backupSheetEnabled = patch.backupSheetEnabled;
  if (patch.backupSheetId !== undefined) data.backupSheetId = patch.backupSheetId;
  if (patch.snapshotInstalled !== undefined) data.snapshotInstalled = patch.snapshotInstalled;
  if (patch.requiredFieldsInstalled !== undefined) {
    data.requiredFieldsInstalled = patch.requiredFieldsInstalled;
  }
  if (patch.ghlConnectionStatus !== undefined) {
    data.ghlConnectionStatus = patch.ghlConnectionStatus;
  }
  if (patch.deliveryMode !== undefined) data.deliveryMode = patch.deliveryMode;
  if (patch.deliveryEnabled !== undefined) data.deliveryEnabled = patch.deliveryEnabled;
  if (patch.clientCutoverApproved !== undefined) {
    data.clientCutoverApproved = patch.clientCutoverApproved;
  }
  if (patch.internalApprovalStatus !== undefined) {
    data.internalApprovalStatus = patch.internalApprovalStatus;
  }
  if (patch.opportunityCreationEnabled !== undefined) {
    data.opportunityCreationEnabled = patch.opportunityCreationEnabled;
  }
  return data;
}

export function mergeRuleForAssessment(
  rule: CampaignRoutingRule,
  patch: import("../schemas/delivery-readiness.schema.js").RoutingRuleDeliveryConfigPatch
): DeliveryReadinessRuleInput {
  return ruleToReadinessInput({
    ...rule,
    destinationWorkflowIdGhl:
      patch.destinationWorkflowIdGhl !== undefined
        ? patch.destinationWorkflowIdGhl
        : rule.destinationWorkflowIdGhl,
    destinationPipelineIdGhl:
      patch.destinationPipelineIdGhl !== undefined
        ? patch.destinationPipelineIdGhl
        : rule.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl:
      patch.destinationPipelineStageIdGhl !== undefined
        ? patch.destinationPipelineStageIdGhl
        : rule.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl:
      patch.defaultAssignedUserIdGhl !== undefined
        ? patch.defaultAssignedUserIdGhl
        : rule.defaultAssignedUserIdGhl,
    backupSheetEnabled:
      patch.backupSheetEnabled !== undefined ? patch.backupSheetEnabled : rule.backupSheetEnabled,
    backupSheetId: patch.backupSheetId !== undefined ? patch.backupSheetId : rule.backupSheetId,
    snapshotInstalled:
      patch.snapshotInstalled !== undefined ? patch.snapshotInstalled : rule.snapshotInstalled,
    requiredFieldsInstalled:
      patch.requiredFieldsInstalled !== undefined
        ? patch.requiredFieldsInstalled
        : rule.requiredFieldsInstalled,
    ghlConnectionStatus:
      patch.ghlConnectionStatus !== undefined
        ? patch.ghlConnectionStatus
        : rule.ghlConnectionStatus,
    deliveryMode: patch.deliveryMode !== undefined ? patch.deliveryMode : rule.deliveryMode,
    deliveryEnabled:
      patch.deliveryEnabled !== undefined ? patch.deliveryEnabled : rule.deliveryEnabled,
    clientCutoverApproved:
      patch.clientCutoverApproved !== undefined
        ? patch.clientCutoverApproved
        : rule.clientCutoverApproved,
    internalApprovalStatus:
      patch.internalApprovalStatus !== undefined
        ? patch.internalApprovalStatus
        : rule.internalApprovalStatus,
    opportunityCreationEnabled:
      patch.opportunityCreationEnabled !== undefined
        ? patch.opportunityCreationEnabled
        : rule.opportunityCreationEnabled,
  });
}

export function persistedReadinessAfterAssessment(
  assessment: DeliveryReadinessAssessment
): Pick<
  import("@prisma/client").Prisma.CampaignRoutingRuleUpdateInput,
  "readinessStatus" | "readinessWarnings" | "lastReadinessCheckAt"
> {
  const p = persistableReadinessFields(assessment);
  return {
    readinessStatus: p.readinessStatus,
    readinessWarnings: p.readinessWarnings,
    lastReadinessCheckAt: p.lastReadinessCheckAt,
  };
}
