import type { ClientGhlDestination, Prisma } from "@prisma/client";
import type { RoutingRuleGhlConfigBody } from "../../schemas/ghl-config.schema.js";
import { GHL_CONNECTION_CONNECTED } from "../../lib/delivery-readiness-status.js";

export function trimOrNull(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t : null;
}

export function buildDestinationUpsertData(
  locationId: string,
  existing: ClientGhlDestination | null | undefined,
  body: Pick<
    RoutingRuleGhlConfigBody,
    | "snapshotInstalled"
    | "requiredFieldsInstalled"
    | "defaultAssignedUserIdGhl"
    | "destinationWorkflowIdGhl"
    | "destinationPipelineIdGhl"
    | "destinationPipelineStageIdGhl"
    | "customFieldStampRequired"
    | "ownerAssignmentRequired"
    | "workflowStartRequired"
    | "workflowTriggerMode"
  >,
  mergedFieldMap: Record<string, string>,
  mergedOptionMap: Record<string, Record<string, string>>,
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

export function ghlStatusFromConnection(connectionStatus: string): string {
  return connectionStatus === "connected" ? GHL_CONNECTION_CONNECTED : connectionStatus;
}

export function checkClientGhlLocationMismatch(
  destLocation: string | null | undefined,
  locationId: string,
  linkedConnectionLocationId: string | null | undefined,
  confirmLocationMismatch?: boolean
): { error: string; code: "LOCATION_MISMATCH" } | null {
  const trimmed = locationId.trim();
  const dest = trimOrNull(destLocation);
  if (dest && dest !== trimmed && confirmLocationMismatch !== true) {
    return {
      error: `locationId ${trimmed} does not match saved destinationSubaccountIdGhl ${dest}. Set confirmLocationMismatch: true to override.`,
      code: "LOCATION_MISMATCH",
    };
  }
  const linked = trimOrNull(linkedConnectionLocationId);
  if (linked && linked !== trimmed && confirmLocationMismatch !== true) {
    return {
      error: `locationId ${trimmed} is not linked to this client via OAuth (linked: ${linked}). Set confirmLocationMismatch: true to override.`,
      code: "LOCATION_MISMATCH",
    };
  }
  return null;
}
