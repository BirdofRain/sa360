/**
 * GHL plan/canary configuration for a confirmed source association.
 *
 * Association routing matches a page without a CampaignRoutingRule, so
 * matchedRuleId stays null. Plan generation and live-canary preflight read the
 * destination client's ClientGhlDestination instead of inventing a rule.
 * Stored delivery flags are copied as-is. This module never enables delivery.
 */

import type { CampaignRoutingRule, ClientGhlDestination, RoutingDryRunDecision } from "@prisma/client";
import { findCampaignRoutingRuleById } from "../repositories/campaign-routing-rule.repository.js";
import { findClientAccountById } from "../repositories/client-account.repository.js";
import { ROUTING_AUTHORITY_SOURCE_ASSOCIATION } from "./routing-source-association.service.js";

/** In-memory plan rule id. Never persisted as campaignRoutingRuleId. */
export const CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID = "confirmed_source_association";

export type DeliveryPlanRuleResolution = {
  rule: CampaignRoutingRule | null;
  associationMissingDestination: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function routingAuthorityFromSnapshot(snapshot: unknown): string | null {
  const value = asRecord(snapshot)?.routingAuthority;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Matched association decision with no campaign rule id. */
export function isConfirmedSourceAssociationDecision(
  decision: Pick<RoutingDryRunDecision, "matched" | "matchedRuleId" | "attributionSnapshot">
): boolean {
  return (
    decision.matched === true &&
    !decision.matchedRuleId?.trim() &&
    routingAuthorityFromSnapshot(decision.attributionSnapshot) ===
      ROUTING_AUTHORITY_SOURCE_ASSOCIATION
  );
}

export function missingDeliveryRuleBlocker(associationMissingDestination: boolean): string {
  return associationMissingDestination
    ? "Confirmed source association has no GHL destination for this client."
    : "Matched routing rule not found for this plan.";
}

export function persistedCampaignRoutingRuleId(
  rule: { id: string } | null | undefined
): string | null {
  const id = rule?.id?.trim();
  if (!id || id === CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID) return null;
  return id;
}

/**
 * Synthetic plan rule backed by the destination record. Copies delivery flags
 * from that record and does not write them.
 */
export function associationDestinationToPlanRule(input: {
  masterClientAccountId: string;
  clientDisplayName: string | null;
  destinationSubaccountIdGhl: string;
  destination: ClientGhlDestination;
}): CampaignRoutingRule {
  const location =
    input.destinationSubaccountIdGhl.trim() ||
    input.destination.destinationSubaccountIdGhl.trim();
  return {
    id: CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID,
    masterClientAccountId: input.masterClientAccountId,
    clientAccountId: input.destination.clientAccountId,
    clientDisplayName: input.clientDisplayName,
    destinationSubaccountIdGhl: location,
    locationName: input.destination.locationName,
    nicheKey: null,
    productType: null,
    destinationWorkflowIdGhl: input.destination.destinationWorkflowIdGhl,
    destinationPipelineIdGhl: input.destination.destinationPipelineIdGhl,
    destinationPipelineStageIdGhl: input.destination.destinationPipelineStageIdGhl,
    defaultAssignedUserIdGhl: input.destination.defaultAssignedUserIdGhl,
    opportunityCreationEnabled: input.destination.opportunityCreationEnabled,
    backupSheetEnabled: input.destination.backupSheetEnabled,
    backupSheetId: input.destination.backupSheetId,
    ghlConnectionStatus: input.destination.ghlConnectionStatus,
    snapshotInstalled: input.destination.snapshotInstalled,
    requiredFieldsInstalled: input.destination.requiredFieldsInstalled,
    deliveryMode: input.destination.deliveryMode,
    deliveryEnabled: input.destination.deliveryEnabled,
    clientCutoverApproved: input.destination.clientCutoverApproved,
    internalApprovalStatus: input.destination.internalApprovalStatus,
    shadowDeliveryEnabled: false,
    active: true,
    sourceAttributeFieldMapJson: input.destination.sourceAttributeFieldMapJson,
    sourceFieldAliasOverridesJson: input.destination.sourceFieldAliasOverridesJson,
    createdAt: input.destination.createdAt,
    updatedAt: input.destination.updatedAt,
  } as CampaignRoutingRule;
}

/**
 * Real campaign rule when matchedRuleId is set. Otherwise the destination
 * behind a confirmed source association. Does not insert a routing rule.
 */
export async function resolveDeliveryPlanRule(
  decision: RoutingDryRunDecision
): Promise<DeliveryPlanRuleResolution> {
  if (decision.matched && decision.matchedRuleId?.trim()) {
    const rule = await findCampaignRoutingRuleById(decision.matchedRuleId.trim());
    return { rule, associationMissingDestination: false };
  }
  if (!isConfirmedSourceAssociationDecision(decision)) {
    return { rule: null, associationMissingDestination: false };
  }

  const clientAccountId = decision.destinationClientAccountId?.trim() ?? "";
  if (!clientAccountId) {
    return { rule: null, associationMissingDestination: true };
  }
  const client = await findClientAccountById(clientAccountId);
  const destination = client?.ghlDestination;
  if (!destination) {
    return { rule: null, associationMissingDestination: true };
  }

  return {
    rule: associationDestinationToPlanRule({
      masterClientAccountId: decision.masterClientAccountId,
      clientDisplayName: client.clientDisplayName,
      destinationSubaccountIdGhl: decision.destinationSubaccountIdGhl?.trim() ?? "",
      destination,
    }),
    associationMissingDestination: false,
  };
}
