import type { Prisma, PrismaClient } from "@prisma/client";

import { persistedGhlDestinationAuthorized } from "./ongoing-ghl-delivery.service.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "../routing-source-association.service.js";

type DispatchDb = PrismaClient | Prisma.TransactionClient;

export type OngoingIntentRecordInput = {
  sourceLeadEventId: string;
  status: string;
  resolvedAt: Date;
  duplicateBlocksLiveDelivery: boolean;
  routing: {
    matched: boolean;
    matchedRuleId?: string | null;
    destinationClientAccountId?: string | null;
    destinationLocationIdGhl?: string | null;
    routingDryRunDecisionId?: string | null;
    routingAuthority?: string | null;
  };
};

/**
 * Inserts a pending GHL intent in the caller's transaction.
 * Does not call GHL. Ineligible leads insert nothing and do not throw.
 * A database error rolls the lead update back with this insert.
 */
export async function recordOngoingGhlDispatchIntent(
  input: OngoingIntentRecordInput,
  db: DispatchDb
): Promise<boolean> {
  if (input.status !== "routing_matched") return false;
  if (input.duplicateBlocksLiveDelivery) return false;
  const ruleId = input.routing.matchedRuleId?.trim() ?? "";
  const clientAccountId = input.routing.destinationClientAccountId?.trim() ?? "";
  const decisionId = input.routing.routingDryRunDecisionId?.trim() ?? "";
  const locationId = input.routing.destinationLocationIdGhl?.trim() ?? "";
  if (
    input.routing.matched !== true ||
    ruleId.length > 0 ||
    input.routing.routingAuthority !== ROUTING_AUTHORITY_SOURCE_ASSOCIATION ||
    !clientAccountId ||
    !decisionId ||
    !locationId
  ) {
    return false;
  }
  const destination = await db.clientGhlDestination.findUnique({ where: { clientAccountId } });
  if (!destination) return false;
  const auth = {
    clientAccountId,
    destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
    ghlConnectionStatus: destination.ghlConnectionStatus,
    deliveryEnabled: destination.deliveryEnabled,
    deliveryMode: destination.deliveryMode,
    clientCutoverApproved: destination.clientCutoverApproved,
    internalApprovalStatus: destination.internalApprovalStatus,
    destinationWorkflowIdGhl: destination.destinationWorkflowIdGhl,
    workflowTriggerMode: destination.workflowTriggerMode,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
    destinationPipelineIdGhl: destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: destination.destinationPipelineStageIdGhl,
    sourceAttributeFieldMapJson: destination.sourceAttributeFieldMapJson,
    ongoingDeliveryNotBefore: destination.ongoingDeliveryNotBefore,
    activationLocationIdGhl: destination.activationLocationIdGhl,
    activationWorkflowIdGhl: destination.activationWorkflowIdGhl,
    activationPipelineIdGhl: destination.activationPipelineIdGhl,
    activationStageIdGhl: destination.activationStageIdGhl,
  };
  if (!persistedGhlDestinationAuthorized(auth)) return false;
  if (!destination.ongoingDeliveryNotBefore || input.resolvedAt < destination.ongoingDeliveryNotBefore) return false;
  if (locationId !== destination.destinationSubaccountIdGhl.trim()) return false;
  await db.ongoingGhlDispatchIntent.upsert({
    where: { idempotencyKey: `association:${clientAccountId}:${input.sourceLeadEventId}` },
    create: {
      idempotencyKey: `association:${clientAccountId}:${input.sourceLeadEventId}`,
      status: "pending",
      clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      routingDryRunDecisionId: decisionId,
      destinationLocationIdGhl: locationId,
      activationLocationIdGhl: destination.activationLocationIdGhl ?? locationId,
      activationWorkflowIdGhl: destination.activationWorkflowIdGhl,
      activationPipelineIdGhl: destination.activationPipelineIdGhl,
      activationStageIdGhl: destination.activationStageIdGhl,
    },
    update: {},
  });
  return true;
}
