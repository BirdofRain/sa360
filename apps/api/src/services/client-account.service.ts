import type { Prisma } from "@prisma/client";
import {
  createClientAccount,
  deleteClientAccountById,
  findClientAccountById,
  listClientAccounts,
  updateClientAccount,
  upsertClientGhlDestination,
} from "../repositories/client-account.repository.js";
import {
  countRoutingRulesForClient,
  listCampaignRoutingRules,
} from "../repositories/campaign-routing-rule.repository.js";
import { prisma } from "../lib/db.js";
import type {
  ClientAccountCreateBody,
  ClientAccountPatchBody,
  ClientGhlDestinationPatchBody,
} from "../schemas/client-account.schema.js";
import { requiresLiveConfirmation } from "./routing-rule-delivery-config.service.js";
import {
  evaluateDeliveryReadiness,
  type DeliveryReadinessRuleInput,
} from "./delivery-readiness.service.js";
import {
  presentClientAccountDetail,
  presentClientAccountListItem,
  type ClientAccountDetailDto,
  type ClientAccountListItemDto,
} from "./client-onboarding.present.js";

function stringListToJson(value?: string[]): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  return value;
}

export async function listClientsAdmin(opts: {
  status?: string;
}): Promise<ClientAccountListItemDto[]> {
  const rows = await listClientAccounts(opts);
  return rows.map(presentClientAccountListItem);
}

export async function createClientAdmin(
  body: ClientAccountCreateBody
): Promise<ClientAccountDetailDto | { error: string; code: "CONFLICT" }> {
  const existing = await findClientAccountById(body.clientAccountId);
  if (existing) {
    return { error: "clientAccountId already exists", code: "CONFLICT" };
  }

  const created = await createClientAccount({
    clientAccountId: body.clientAccountId.trim(),
    clientDisplayName: body.clientDisplayName.trim(),
    status: body.status ?? "onboarding",
    portalEnabled: body.portalEnabled ?? false,
    portalDisplayName: body.portalDisplayName ?? undefined,
    portalLoginEmail: body.portalLoginEmail ?? undefined,
    primaryNicheKeys: stringListToJson(body.primaryNicheKeys) ?? [],
    primaryProductTypes: stringListToJson(body.primaryProductTypes) ?? [],
    notes: body.notes ?? undefined,
  });

  return presentClientAccountDetail(created, [], null);
}

export async function getClientAdmin(
  clientAccountId: string
): Promise<ClientAccountDetailDto | null> {
  const client = await findClientAccountById(clientAccountId);
  if (!client) return null;

  const rules = await listCampaignRoutingRules({ clientAccountId: client.clientAccountId });
  const destinationReadiness = client.ghlDestination
    ? evaluateDeliveryReadiness(destinationToReadinessInput(client, client.ghlDestination))
    : null;

  return presentClientAccountDetail(client, rules, destinationReadiness);
}

export async function patchClientAdmin(
  clientAccountId: string,
  body: ClientAccountPatchBody
): Promise<ClientAccountDetailDto | null> {
  const existing = await findClientAccountById(clientAccountId);
  if (!existing) return null;

  const data: Prisma.ClientAccountUpdateInput = {};
  if (body.clientDisplayName !== undefined) data.clientDisplayName = body.clientDisplayName;
  if (body.status !== undefined) data.status = body.status;
  if (body.portalEnabled !== undefined) data.portalEnabled = body.portalEnabled;
  if (body.portalDisplayName !== undefined) data.portalDisplayName = body.portalDisplayName;
  if (body.portalLoginEmail !== undefined) data.portalLoginEmail = body.portalLoginEmail;
  if (body.primaryNicheKeys !== undefined) {
    data.primaryNicheKeys = stringListToJson(body.primaryNicheKeys) ?? [];
  }
  if (body.primaryProductTypes !== undefined) {
    data.primaryProductTypes = stringListToJson(body.primaryProductTypes) ?? [];
  }
  if (body.notes !== undefined) data.notes = body.notes;

  const updated = await updateClientAccount(clientAccountId, data);
  const rules = await listCampaignRoutingRules({ clientAccountId: updated.clientAccountId });
  const destinationReadiness = updated.ghlDestination
    ? evaluateDeliveryReadiness(
        destinationToReadinessInput(updated, updated.ghlDestination)
      )
    : null;

  return presentClientAccountDetail(updated, rules, destinationReadiness);
}

export type PatchClientGhlDestinationResult =
  | { ok: true }
  | { notFound: true }
  | { error: string; code: "CONFIRMATION_REQUIRED" | "VALIDATION" };

export async function patchClientGhlDestinationAdmin(
  clientAccountId: string,
  patch: ClientGhlDestinationPatchBody
): Promise<PatchClientGhlDestinationResult> {
  const client = await findClientAccountById(clientAccountId);
  if (!client) return { notFound: true };

  const livePatch = {
    deliveryEnabled: patch.deliveryEnabled,
    deliveryMode: patch.deliveryMode,
  };
  if (requiresLiveConfirmation(livePatch) && patch.confirmLiveDeliveryRisk !== true) {
    return {
      error:
        "Enabling live delivery on the destination requires confirmLiveDeliveryRisk: true. No delivery is executed from this endpoint.",
      code: "CONFIRMATION_REQUIRED",
    };
  }

  const merged: DeliveryReadinessRuleInput = {
    masterClientAccountId: "client_destination",
    clientAccountId: client.clientAccountId,
    clientDisplayName: client.clientDisplayName,
    destinationSubaccountIdGhl:
      patch.destinationSubaccountIdGhl?.trim() ??
      client.ghlDestination?.destinationSubaccountIdGhl ??
      "",
    destinationWorkflowIdGhl:
      patch.destinationWorkflowIdGhl ?? client.ghlDestination?.destinationWorkflowIdGhl,
    destinationPipelineIdGhl:
      patch.destinationPipelineIdGhl ?? client.ghlDestination?.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl:
      patch.destinationPipelineStageIdGhl ??
      client.ghlDestination?.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl:
      patch.defaultAssignedUserIdGhl ?? client.ghlDestination?.defaultAssignedUserIdGhl,
    backupSheetEnabled: patch.backupSheetEnabled ?? client.ghlDestination?.backupSheetEnabled,
    backupSheetId: patch.backupSheetId ?? client.ghlDestination?.backupSheetId,
    ghlConnectionStatus: patch.ghlConnectionStatus ?? client.ghlDestination?.ghlConnectionStatus,
    snapshotInstalled: patch.snapshotInstalled ?? client.ghlDestination?.snapshotInstalled,
    requiredFieldsInstalled:
      patch.requiredFieldsInstalled ?? client.ghlDestination?.requiredFieldsInstalled,
    deliveryMode: patch.deliveryMode ?? client.ghlDestination?.deliveryMode ?? "shadow",
    deliveryEnabled: patch.deliveryEnabled ?? client.ghlDestination?.deliveryEnabled ?? false,
    clientCutoverApproved:
      patch.clientCutoverApproved ?? client.ghlDestination?.clientCutoverApproved ?? false,
    internalApprovalStatus:
      patch.internalApprovalStatus ??
      client.ghlDestination?.internalApprovalStatus ??
      "not_reviewed",
    opportunityCreationEnabled:
      patch.opportunityCreationEnabled ??
      client.ghlDestination?.opportunityCreationEnabled ??
      true,
    sa360CustomFieldIdMapJson:
      patch.sa360CustomFieldIdMapJson ?? client.ghlDestination?.sa360CustomFieldIdMapJson,
    sa360CustomFieldOptionMapJson:
      patch.sa360CustomFieldOptionMapJson ?? client.ghlDestination?.sa360CustomFieldOptionMapJson,
    customFieldStampRequired:
      patch.customFieldStampRequired ?? client.ghlDestination?.customFieldStampRequired,
    active: true,
  };

  const assessment = evaluateDeliveryReadiness(merged);
  if (requiresLiveConfirmation(livePatch) && !assessment.readyForLive) {
    return {
      error:
        "Cannot enable live delivery on destination: configuration is not ready for live.",
      code: "VALIDATION",
    };
  }

  if (!patch.destinationSubaccountIdGhl?.trim() && !client.ghlDestination) {
    return {
      error: "destinationSubaccountIdGhl is required when creating a GHL destination",
      code: "VALIDATION",
    };
  }

  await upsertClientGhlDestination(client.clientAccountId, {
    destinationSubaccountIdGhl:
      patch.destinationSubaccountIdGhl?.trim() ??
      client.ghlDestination!.destinationSubaccountIdGhl,
    locationName: patch.locationName ?? client.ghlDestination?.locationName,
    ghlConnectionStatus:
      patch.ghlConnectionStatus ?? client.ghlDestination?.ghlConnectionStatus,
    snapshotInstalled: patch.snapshotInstalled ?? client.ghlDestination?.snapshotInstalled ?? false,
    requiredFieldsInstalled:
      patch.requiredFieldsInstalled ?? client.ghlDestination?.requiredFieldsInstalled ?? false,
    defaultAssignedUserIdGhl:
      patch.defaultAssignedUserIdGhl ?? client.ghlDestination?.defaultAssignedUserIdGhl,
    destinationWorkflowIdGhl:
      patch.destinationWorkflowIdGhl ?? client.ghlDestination?.destinationWorkflowIdGhl,
    destinationPipelineIdGhl:
      patch.destinationPipelineIdGhl ?? client.ghlDestination?.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl:
      patch.destinationPipelineStageIdGhl ??
      client.ghlDestination?.destinationPipelineStageIdGhl,
    pipelineStageContactingIdGhl:
      patch.pipelineStageContactingIdGhl ?? client.ghlDestination?.pipelineStageContactingIdGhl,
    pipelineStageAppointmentSetIdGhl:
      patch.pipelineStageAppointmentSetIdGhl ??
      client.ghlDestination?.pipelineStageAppointmentSetIdGhl,
    pipelineStageShowedIdGhl:
      patch.pipelineStageShowedIdGhl ?? client.ghlDestination?.pipelineStageShowedIdGhl,
    pipelineStageSoldIdGhl:
      patch.pipelineStageSoldIdGhl ?? client.ghlDestination?.pipelineStageSoldIdGhl,
    pipelineStageDeadIdGhl:
      patch.pipelineStageDeadIdGhl ?? client.ghlDestination?.pipelineStageDeadIdGhl,
    opportunityCreationEnabled:
      patch.opportunityCreationEnabled ??
      client.ghlDestination?.opportunityCreationEnabled ??
      true,
    backupSheetEnabled: patch.backupSheetEnabled ?? client.ghlDestination?.backupSheetEnabled ?? false,
    backupSheetId: patch.backupSheetId ?? client.ghlDestination?.backupSheetId,
    deliveryMode: patch.deliveryMode ?? client.ghlDestination?.deliveryMode ?? "shadow",
    deliveryEnabled: patch.deliveryEnabled ?? client.ghlDestination?.deliveryEnabled ?? false,
    clientCutoverApproved:
      patch.clientCutoverApproved ?? client.ghlDestination?.clientCutoverApproved ?? false,
    internalApprovalStatus:
      patch.internalApprovalStatus ??
      client.ghlDestination?.internalApprovalStatus ??
      "not_reviewed",
    sa360CustomFieldIdMapJson:
      patch.sa360CustomFieldIdMapJson ??
      client.ghlDestination?.sa360CustomFieldIdMapJson ??
      {},
    sa360CustomFieldOptionMapJson:
      patch.sa360CustomFieldOptionMapJson ??
      client.ghlDestination?.sa360CustomFieldOptionMapJson ??
      {},
    customFieldStampRequired:
      patch.customFieldStampRequired ??
      client.ghlDestination?.customFieldStampRequired ??
      false,
  });

  return { ok: true };
}

function destinationToReadinessInput(
  client: { clientAccountId: string; clientDisplayName: string },
  dest: {
    destinationSubaccountIdGhl: string;
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
    sa360CustomFieldIdMapJson?: unknown;
    sa360CustomFieldOptionMapJson?: unknown;
    customFieldStampRequired?: boolean;
    ownerAssignmentRequired?: boolean;
    workflowStartRequired?: boolean;
  }
): DeliveryReadinessRuleInput {
  return {
    masterClientAccountId: "tenant",
    clientAccountId: client.clientAccountId,
    clientDisplayName: client.clientDisplayName,
    destinationSubaccountIdGhl: dest.destinationSubaccountIdGhl,
    destinationWorkflowIdGhl: dest.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: dest.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: dest.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl: dest.defaultAssignedUserIdGhl,
    backupSheetEnabled: dest.backupSheetEnabled,
    backupSheetId: dest.backupSheetId,
    ghlConnectionStatus: dest.ghlConnectionStatus,
    snapshotInstalled: dest.snapshotInstalled,
    requiredFieldsInstalled: dest.requiredFieldsInstalled,
    deliveryMode: dest.deliveryMode,
    deliveryEnabled: dest.deliveryEnabled,
    clientCutoverApproved: dest.clientCutoverApproved,
    internalApprovalStatus: dest.internalApprovalStatus,
    opportunityCreationEnabled: dest.opportunityCreationEnabled,
    sa360CustomFieldIdMapJson: dest.sa360CustomFieldIdMapJson,
    sa360CustomFieldOptionMapJson: dest.sa360CustomFieldOptionMapJson,
    customFieldStampRequired: dest.customFieldStampRequired,
    active: true,
  };
}

export type DeleteClientResult =
  | {
      deleted: true;
      clientAccountId: string;
      routingRulesDeleted: number;
      ghlConnectionsUnlinked: number;
    }
  | { notFound: true }
  | { error: string; code: "CONFIRMATION_REQUIRED" };

export async function deleteClientAdmin(
  clientAccountId: string,
  confirm: boolean
): Promise<DeleteClientResult> {
  if (!confirm) {
    return {
      error: "Set confirm=true to delete this client and all of its routing rules.",
      code: "CONFIRMATION_REQUIRED",
    };
  }
  const id = clientAccountId.trim();
  const existing = await findClientAccountById(id);
  if (!existing) return { notFound: true };

  const ruleCount = await countRoutingRulesForClient(id);
  const ghlLinked = await prisma.ghlLocationConnection.count({
    where: { clientAccountId: id },
  });
  await deleteClientAccountById(id);

  return {
    deleted: true,
    clientAccountId: id,
    routingRulesDeleted: ruleCount,
    ghlConnectionsUnlinked: ghlLinked,
  };
}
