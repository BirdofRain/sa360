import type { CampaignRoutingRule, ClientAccount, ClientGhlDestination } from "@prisma/client";
import type { DeliveryReadinessAssessment } from "./delivery-readiness.service.js";
import {
  presentRoutingRuleWithReadiness,
  type RoutingRuleWithReadinessItem,
} from "./delivery-readiness-admin.present.js";

export type ClientGhlDestinationDto = {
  id: string;
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  locationName: string | null;
  ghlConnectionStatus: string | null;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  defaultAssignedUserIdGhl: string | null;
  destinationWorkflowIdGhl: string | null;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  pipelineStageContactingIdGhl: string | null;
  pipelineStageAppointmentSetIdGhl: string | null;
  pipelineStageShowedIdGhl: string | null;
  pipelineStageSoldIdGhl: string | null;
  pipelineStageDeadIdGhl: string | null;
  opportunityCreationEnabled: boolean;
  backupSheetEnabled: boolean;
  backupSheetId: string | null;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  updatedAt: string;
};

export type ClientAccountListItemDto = {
  clientAccountId: string;
  clientDisplayName: string;
  status: string;
  portalEnabled: boolean;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  hasGhlDestination: boolean;
  destinationSubaccountIdGhl: string | null;
  updatedAt: string;
};

export type ClientAccountDetailDto = {
  clientAccountId: string;
  clientDisplayName: string;
  status: string;
  portalEnabled: boolean;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  ghlDestination: ClientGhlDestinationDto | null;
  routingRules: RoutingRuleWithReadinessItem[];
  destinationReadiness: DeliveryReadinessAssessment | null;
  activeRoutingRuleCount: number;
};

function parseStringList(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((v): v is string => typeof v === "string");
}

export function presentClientGhlDestination(
  dest: ClientGhlDestination
): ClientGhlDestinationDto {
  return {
    id: dest.id,
    clientAccountId: dest.clientAccountId,
    destinationSubaccountIdGhl: dest.destinationSubaccountIdGhl,
    locationName: dest.locationName,
    ghlConnectionStatus: dest.ghlConnectionStatus,
    snapshotInstalled: dest.snapshotInstalled,
    requiredFieldsInstalled: dest.requiredFieldsInstalled,
    defaultAssignedUserIdGhl: dest.defaultAssignedUserIdGhl,
    destinationWorkflowIdGhl: dest.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: dest.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: dest.destinationPipelineStageIdGhl,
    pipelineStageContactingIdGhl: dest.pipelineStageContactingIdGhl,
    pipelineStageAppointmentSetIdGhl: dest.pipelineStageAppointmentSetIdGhl,
    pipelineStageShowedIdGhl: dest.pipelineStageShowedIdGhl,
    pipelineStageSoldIdGhl: dest.pipelineStageSoldIdGhl,
    pipelineStageDeadIdGhl: dest.pipelineStageDeadIdGhl,
    opportunityCreationEnabled: dest.opportunityCreationEnabled,
    backupSheetEnabled: dest.backupSheetEnabled,
    backupSheetId: dest.backupSheetId,
    deliveryMode: dest.deliveryMode,
    deliveryEnabled: dest.deliveryEnabled,
    clientCutoverApproved: dest.clientCutoverApproved,
    internalApprovalStatus: dest.internalApprovalStatus,
    updatedAt: dest.updatedAt.toISOString(),
  };
}

export function presentClientAccountListItem(
  row: ClientAccount & { ghlDestination: ClientGhlDestination | null }
): ClientAccountListItemDto {
  return {
    clientAccountId: row.clientAccountId,
    clientDisplayName: row.clientDisplayName,
    status: row.status,
    portalEnabled: row.portalEnabled,
    primaryNicheKeys: parseStringList(row.primaryNicheKeys),
    primaryProductTypes: parseStringList(row.primaryProductTypes),
    hasGhlDestination: Boolean(row.ghlDestination),
    destinationSubaccountIdGhl: row.ghlDestination?.destinationSubaccountIdGhl ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function presentClientAccountDetail(
  row: ClientAccount & { ghlDestination: ClientGhlDestination | null },
  rules: CampaignRoutingRule[],
  destinationReadiness: DeliveryReadinessAssessment | null
): ClientAccountDetailDto {
  const destMapping = row.ghlDestination
    ? {
        sa360CustomFieldIdMapJson: row.ghlDestination.sa360CustomFieldIdMapJson,
        customFieldStampRequired: row.ghlDestination.customFieldStampRequired,
      }
    : null;
  const routingRules = rules.map((rule) =>
    presentRoutingRuleWithReadiness(rule, destMapping)
  );
  return {
    clientAccountId: row.clientAccountId,
    clientDisplayName: row.clientDisplayName,
    status: row.status,
    portalEnabled: row.portalEnabled,
    portalDisplayName: row.portalDisplayName,
    portalLoginEmail: row.portalLoginEmail,
    primaryNicheKeys: parseStringList(row.primaryNicheKeys),
    primaryProductTypes: parseStringList(row.primaryProductTypes),
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ghlDestination: row.ghlDestination
      ? presentClientGhlDestination(row.ghlDestination)
      : null,
    routingRules,
    destinationReadiness,
    activeRoutingRuleCount: rules.filter((r) => r.active).length,
  };
}
