import type { SourceLeadEventStatus } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import {
  findSourceLeadEventById,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { findSourceFunnelById } from "../../repositories/source-funnel.repository.js";
import { recordCompanySheetsCampaignIntent } from "../company-sheets-dispatch/company-sheets-dispatch-record.js";
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
import {
  readCampaignLeadTypeDecision,
  readTrustedCampaignLeadType,
  resolveCampaignLeadType,
} from "./campaign-lead-type.js";
import { persistLeadProofFromPayload } from "../lead-proof/lead-proof-ingest.service.js";
import { deliverConfirmedAssociationIfActivated } from "../association-ongoing-delivery.js";
import {
  claimPendingAssociationOutbox,
  recordGhlAssociationDispatchOutbox,
  settleGhlAssociationDispatchFromResult,
} from "../ghl-association-dispatch/ghl-association-dispatch.js";
import { enqueueExternalWebhookAttempt } from "../external-webhook/external-webhook-queue.js";
import { recordExternalWebhookAttempt } from "../external-webhook/external-webhook-schedule.js";
import {
  observeClientCampaignShadow,
  shadowFailureLogFields,
} from "../client-campaign-shadow/observe-client-campaign-shadow.js";

/**
 * Shared source-intake routing + duplicate-risk + enrichment persistence.
 *
 * Used by LeadCapture.io and Facebook Lead Ads intake so every source flows
 * through the same pipeline: runRoutingDryRun, duplicate-risk evaluation,
 * source enrichment, and the SourceLeadEvent status transition. A confirmed
 * parent-URL association records a GHL schedule in the same transaction, then
 * claims that row and calls GHL after commit. That in-process call is not guaranteed to finish
 * if the process dies. A later drain can send a pending
 * row once. A claimed row with an unknown external outcome stays uncertain and
 * is not sent again. A GHL failure does not roll back the lead or the Sheets
 * intent.
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
  now: Date,
  options?: {
    extraEnrichmentMetadata?: Record<string, unknown>;
    sourceFunnelId?: string | null;
  }
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
    routingAuthority: dryRun.routingAuthority,
    ...(dryRun.sourceAssociation ? { sourceAssociation: dryRun.sourceAssociation } : {}),
  };

  const priorEvent = await findSourceLeadEventById(sourceEventId);
  const priorDecision = readCampaignLeadTypeDecision(priorEvent?.routingResultJson);
  if (priorDecision) {
    routing.campaignLeadType = priorDecision;
  } else {
    const associationId = routing.sourceAssociation?.sourceFunnelId ?? null;
    const observedId = options?.sourceFunnelId ?? null;
    const [associationFunnel, observedFunnel] = await Promise.all([
      associationId ? findSourceFunnelById(associationId) : Promise.resolve(null),
      observedId ? findSourceFunnelById(observedId) : Promise.resolve(null),
    ]);
    routing.campaignLeadType = resolveCampaignLeadType({
      routingAuthority: routing.routingAuthority,
      matched: routing.matched,
      matchedRuleId: routing.matchedRuleId,
      matchType: routing.matchType,
      sourceAssociation: associationId
        ? {
            id: associationId,
            leadTypeKey: associationFunnel?.leadTypeKey ?? null,
          }
        : null,
      observedSource: observedFunnel
        ? { id: observedFunnel.id, leadTypeKey: observedFunnel.leadTypeKey }
        : null,
      trusted: readTrustedCampaignLeadType(rawPayload) ?? readTrustedCampaignLeadType(normalized),
    });
  }

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

  let destinationClientAccountIdForMaps: string | null = null;
  if (dryRun.matchedRuleId) {
    const rule = await findCampaignRoutingRuleById(dryRun.matchedRuleId);
    routeFieldMapJson = rule?.sourceAttributeFieldMapJson;
    routeAliasOverridesJson = rule?.sourceFieldAliasOverridesJson;
    destinationClientAccountIdForMaps = rule?.clientAccountId ?? null;
  } else {
    // Confirmed-source-association matches have no rule; destination maps still apply.
    destinationClientAccountIdForMaps = dryRun.destinationClientAccountId ?? null;
  }
  if (destinationClientAccountIdForMaps) {
    const client = await findClientAccountById(destinationClientAccountIdForMaps);
    destinationFieldMapJson = client?.ghlDestination?.sourceAttributeFieldMapJson;
    destinationEnrichmentPolicyJson = client?.ghlDestination?.sourceEnrichmentPolicyJson;
    destinationAliasOverridesJson = client?.ghlDestination?.sourceFieldAliasOverridesJson;
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
    sourceFunnelId: options?.sourceFunnelId,
  });

  const normalizedWithEnrichment = attachSourceAttributesToLifecyclePayload(
    normalized,
    enrichmentMetadata.sourceAttributes,
    enrichmentMetadata.unmappedSourceFields
  );

  let scheduledWebhookAttemptId: string | null = null;
  await prisma.$transaction(async (tx) => {
    await updateSourceLeadEvent(
      sourceEventId,
      {
        status,
        normalizedPayloadJson: normalizedWithEnrichment as object,
        routingResultJson: routing as object,
        duplicateRiskJson: duplicateRisk as object,
        enrichmentMetadataJson: {
          ...enrichmentMetadata,
          ...(options?.extraEnrichmentMetadata ?? {}),
        } as object,
        routingDryRunDecisionId: dryRun.decisionId,
        clientAccountIdResolved: dryRun.destinationClientAccountId ?? null,
        destinationLocationIdResolved: dryRun.destinationSubaccountIdGhl ?? null,
        routingRuleIdResolved: dryRun.matchedRuleId ?? null,
        routedAt: now,
      },
      tx
    );
    // A database error rolls the lead update back so a confirmed route cannot
    // commit without its schedule row. Flag-off, unmatched, and pre-cutoff
    // paths return without throwing and do not reject intake.
    await recordCompanySheetsCampaignIntent(
      {
        sourceLeadEventId: sourceEventId,
        status,
        clientAccountId: dryRun.destinationClientAccountId ?? null,
        resolvedAt: now,
      },
      tx
    );
    await recordGhlAssociationDispatchOutbox(
      {
        sourceLeadEventId: sourceEventId,
        status,
        routing,
        resolvedAt: now,
      },
      tx
    );
    const scheduledWebhook = await recordExternalWebhookAttempt(
      {
        sourceLeadEventId: sourceEventId,
        status,
        clientAccountId: dryRun.destinationClientAccountId ?? null,
        sourceLeadId,
        receivedAt,
        normalizedPayload: normalizedWithEnrichment,
        sourceFunnelId: options?.sourceFunnelId ?? routing.sourceAssociation?.sourceFunnelId ?? null,
        resolvedAt: now,
      },
      tx
    );
    scheduledWebhookAttemptId = scheduledWebhook?.attemptId ?? null;
  });

  if (scheduledWebhookAttemptId) {
    try {
      await enqueueExternalWebhookAttempt(scheduledWebhookAttemptId);
    } catch (err) {
      logger.warn("external_webhook.enqueue_failed", {
        sourceLeadEventId: sourceEventId,
        errorName: err instanceof Error ? err.name : "Error",
      });
    }
  }

  let outboxClaim: "absent" | "claimed" | "owned" = "absent";
  try {
    outboxClaim = await claimPendingAssociationOutbox(sourceEventId);
    if (outboxClaim !== "owned") {
      const ghlResult = await deliverConfirmedAssociationIfActivated({
        sourceLeadEventId: sourceEventId,
        status,
        routing,
        lifecyclePayload: normalizedWithEnrichment,
      });
      await settleGhlAssociationDispatchFromResult(sourceEventId, ghlResult);
    }
  } catch (err) {
    // A claimed row stays executing. The drain records uncertain after the
    // lease instead of calling GHL again.
    logger.warn("association_ghl.ongoing_failed", {
      sourceLeadEventId: sourceEventId,
      errorName: err instanceof Error ? err.name : "Error",
      outboxClaim,
    });
  }

  try {
    const proofResult = await persistLeadProofFromPayload(normalizedWithEnrichment, {
      sourceEventId,
    });
    if (!proofResult.ok) {
      logger.warn("lead_proof.persist.skipped", {
        sourceEventId,
        errorCode: proofResult.errorCode,
        errorSummary: proofResult.errorSummary,
      });
    }
  } catch (err) {
    logger.warn("lead_proof.persist.unexpected_error", {
      sourceEventId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Shadow resolution starts after the routing transaction, Sheets intent,
  // and GHL association have finished. The live result does not wait on it.
  // The flag check inside observe returns before any registry query when off.
  // A failure is logged without the error message, which can echo lead fields.
  void observeClientCampaignShadow(sourceEventId).catch((err) => {
    logger.warn("client_campaign_shadow.failed", shadowFailureLogFields(sourceEventId, err));
  });

  return { routing, duplicateRiskJson: duplicateRisk, status, normalizedWithEnrichment };
}
