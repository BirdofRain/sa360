import type { SourceLeadEventStatus } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { updateSourceLeadEvent } from "../../repositories/source-lead-event.repository.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { runRoutingDryRun } from "../routing-dry-run.service.js";
import { evaluateSourceLeadDuplicateRisk } from "./source-lead-duplicate-risk.service.js";
import {
  attachSourceAttributesToLifecyclePayload,
  runSourceEnrichmentPipeline,
} from "./source-enrichment-pipeline.service.js";
import { hasDeliverableIdentity } from "./source-enrichment.service.js";
import type { SourceLeadRoutingResult } from "./source-intake.types.js";

/**
 * Shared source-intake routing + duplicate-risk + enrichment persistence.
 *
 * Used by both the LeadCapture.io and Facebook Lead Ads intake services so every source
 * flows through the identical existing pipeline: runRoutingDryRun (which persists the
 * RoutingDryRunDecision + lifecycle events), duplicate-risk evaluation, source enrichment,
 * and the SourceLeadEvent status transition. No GHL delivery is performed here.
 */
export async function persistRoutingAndDuplicate(
  sourceEventId: string,
  normalized: LifecycleEventSchema,
  rawPayload: Record<string, unknown>,
  sourceProvider: string,
  sourceSystem: string,
  sourceRouteKey: string,
  sourceLeadId: string,
  sourceLeadIdGenerated: boolean,
  receivedAt: string,
  now: Date
): Promise<{
  routing: SourceLeadRoutingResult;
  duplicateRiskJson: object | null;
  status: SourceLeadEventStatus;
  normalizedWithEnrichment: LifecycleEventSchema;
}> {
  const dryRun = await runRoutingDryRun(normalized);
  const routing: SourceLeadRoutingResult = {
    matched: dryRun.matched,
    matchedRuleId: dryRun.matchedRuleId,
    destinationClientAccountId: dryRun.destinationClientAccountId,
    destinationLocationIdGhl: dryRun.destinationSubaccountIdGhl,
    reason: dryRun.reason,
    matchType: dryRun.matchType,
    routingDryRunDecisionId: dryRun.decisionId,
  };

  const duplicateRisk = await evaluateSourceLeadDuplicateRisk({
    payload: normalized,
    destinationClientAccountId: dryRun.destinationClientAccountId ?? null,
    destinationSubaccountIdGhl: dryRun.destinationSubaccountIdGhl ?? null,
    routingDryRunDecisionId: dryRun.decisionId,
    sourceProvider,
    sourceSystem,
    sourceLeadId,
    excludeEventId: sourceEventId,
    sourceLeadIdGenerated,
  });

  let status: SourceLeadEventStatus;
  if (duplicateRisk.blocksDelivery) {
    status = "duplicate_blocked";
  } else if (!hasDeliverableIdentity(normalized).ok) {
    status = "needs_review";
  } else if (dryRun.matched) {
    status = "routing_matched";
  } else {
    status = "routing_unmatched";
  }

  let destinationFieldMapJson: unknown;
  let destinationEnrichmentPolicyJson: unknown;
  let destinationAliasOverridesJson: unknown;
  let routeFieldMapJson: unknown;
  let routeAliasOverridesJson: unknown;

  if (dryRun.matchedRuleId) {
    const rule = await findCampaignRoutingRuleById(dryRun.matchedRuleId);
    routeFieldMapJson = rule?.sourceAttributeFieldMapJson;
    routeAliasOverridesJson = rule?.sourceFieldAliasOverridesJson;
    if (rule?.clientAccountId) {
      const client = await findClientAccountById(rule.clientAccountId);
      destinationFieldMapJson = client?.ghlDestination?.sourceAttributeFieldMapJson;
      destinationEnrichmentPolicyJson = client?.ghlDestination?.sourceEnrichmentPolicyJson;
      destinationAliasOverridesJson = client?.ghlDestination?.sourceFieldAliasOverridesJson;
    }
  }

  const { enrichmentMetadata } = await runSourceEnrichmentPipeline({
    rawPayload,
    normalizedPayload: normalized,
    sourceProvider,
    sourceSystem,
    sourceRouteKey,
    eventStatus: status,
    routingMatched: dryRun.matched,
    destinationFieldMapJson,
    destinationEnrichmentPolicyJson,
    destinationAliasOverridesJson,
    routeFieldMapJson,
    routeAliasOverridesJson,
    receivedAt,
  });

  const normalizedWithEnrichment = attachSourceAttributesToLifecyclePayload(
    normalized,
    enrichmentMetadata.sourceAttributes,
    enrichmentMetadata.unmappedSourceFields
  );

  await updateSourceLeadEvent(sourceEventId, {
    status,
    normalizedPayloadJson: normalizedWithEnrichment as object,
    routingResultJson: routing as object,
    duplicateRiskJson: duplicateRisk as object,
    enrichmentMetadataJson: enrichmentMetadata as object,
    routingDryRunDecisionId: dryRun.decisionId,
    clientAccountIdResolved: dryRun.destinationClientAccountId ?? null,
    destinationLocationIdResolved: dryRun.destinationSubaccountIdGhl ?? null,
    routingRuleIdResolved: dryRun.matchedRuleId ?? null,
    routedAt: now,
  });

  return { routing, duplicateRiskJson: duplicateRisk, status, normalizedWithEnrichment };
}
