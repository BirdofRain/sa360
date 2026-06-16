import type { SourceLeadEventStatus } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { prisma } from "../../lib/db.js";
import {
  createSourceLeadEvent,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { runRoutingDryRun } from "../routing-dry-run.service.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { evaluateSourceLeadDuplicateRisk } from "./source-lead-duplicate-risk.service.js";
import {
  attachSourceAttributesToLifecyclePayload,
  runSourceEnrichmentPipeline,
} from "./source-enrichment-pipeline.service.js";
import { hasDeliverableIdentity } from "./source-enrichment.service.js";
import {
  canNormalizeLeadCaptureIoWebhook,
  inferLeadCaptureIoRoutingKeys,
  normalizeLeadCaptureIoWebhookToLifecyclePayload,
  type LeadCaptureIoSourceSystem,
} from "./leadcapture-io-normalizer.js";
import {
  resolveLeadCaptureLeadId,
  resolveLeadCaptureRouteKey,
} from "./leadcapture-payload-resolver.js";
import type { SourceLeadRoutingResult } from "./source-intake.types.js";

export type LeadCaptureIoIntakeInput = {
  rawPayload: Record<string, unknown>;
  routeKeyFromPath?: string;
  webhookRequestLogId?: string;
};

export type SourceLeadIntakeResult = {
  ok: true;
  provider: "leadcapture_io";
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  sourceLeadId: string;
  sourceLeadIdGenerated?: boolean;
  normalizedLeadUid: string;
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  routingDryRunDecisionId?: string;
  nextAction: string;
  devWarning?: string;
};

function resolveLeadCaptureSourceSystem(raw: Record<string, unknown>): LeadCaptureIoSourceSystem {
  const v = typeof raw.sa360_source_system === "string" ? raw.sa360_source_system.trim() : "";
  return v === "leadcapture_io_nextgen" ? "leadcapture_io_nextgen" : "leadcapture_io_legacy";
}

function resolveLeadCaptureSourceType(raw: Record<string, unknown>): "webhook" | "lead_form" {
  const t = typeof raw.sa360_source_type === "string" ? raw.sa360_source_type.trim() : "";
  if (t === "webhook") return "webhook";
  return "lead_form";
}

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

async function persistRoutingAndDuplicate(
  sourceEventId: string,
  normalized: LifecycleEventSchema,
  rawPayload: Record<string, unknown>,
  sourceProvider: string,
  sourceSystem: string,
  sourceRouteKey: string,
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

  const { enrichmentMetadata, extraction } = await runSourceEnrichmentPipeline({
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

/** Process LeadCapture.io webhook: store raw, normalize, route, duplicate check — no GHL delivery. */
export async function processLeadCaptureIoWebhookIntake(
  input: LeadCaptureIoIntakeInput
): Promise<SourceLeadIntakeResult> {
  const raw = input.rawPayload;
  if (!canNormalizeLeadCaptureIoWebhook(raw)) {
    throw new Error("invalid_leadcapture_io_payload");
  }

  const now = new Date();
  const routingHints = inferLeadCaptureIoRoutingKeys(raw, input.routeKeyFromPath);
  const routeKey = resolveLeadCaptureRouteKey(raw, input.routeKeyFromPath);
  const { leadId, sourceLeadIdGenerated } = resolveLeadCaptureLeadId(raw, routeKey);
  const sourceSystem = resolveLeadCaptureSourceSystem(raw);
  const sourceType = resolveLeadCaptureSourceType(raw);

  const event = await createSourceLeadEvent({
    sourceProvider: "leadcapture_io",
    sourceSystem,
    sourceType,
    sourceRouteKey: routeKey,
    sourceCampaignId: routeKey,
    sourceCampaignName: routingHints.campaignName ?? null,
    sourceFunnelName: routingHints.funnelName ?? null,
    sourceLeadId: leadId,
    sourceLeadUid: `leadcaptureio-${sourceSystem}-${leadId}`,
    webhookRequestLogId: input.webhookRequestLogId ?? null,
    status: "received",
    rawPayloadJson: raw as object,
    receivedAt: now,
  });

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw, {
    routeKeyFromPath: input.routeKeyFromPath,
  });
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) {
    await updateSourceLeadEvent(event.id, {
      status: "needs_review",
      errorSummary: "Normalized payload failed lifecycle schema validation.",
      normalizedAt: now,
    });
    return {
      ok: true,
      provider: "leadcapture_io",
      sourceEventId: event.id,
      status: "needs_review",
      sourceRouteKey: routeKey,
      sourceLeadId: leadId,
      sourceLeadIdGenerated,
      normalizedLeadUid: normalized.contact.lead_uid,
      matched: false,
      nextAction: "Review and approve delivery in Admin C.O.C.",
    };
  }

  await updateSourceLeadEvent(event.id, {
    status: "normalized",
    normalizedPayloadJson: parsed.data as object,
    normalizedAt: now,
  });

  const { routing, status } = await persistRoutingAndDuplicate(
    event.id,
    parsed.data,
    raw,
    "leadcapture_io",
    sourceSystem,
    routeKey,
    now.toISOString(),
    now
  );

  return {
    ok: true,
    provider: "leadcapture_io",
    sourceEventId: event.id,
    status,
    sourceRouteKey: routeKey,
    sourceLeadId: leadId,
    sourceLeadIdGenerated,
    normalizedLeadUid: parsed.data.contact.lead_uid,
    matched: routing.matched,
    matchedRuleId: routing.matchedRuleId,
    destinationClientAccountId: routing.destinationClientAccountId,
    destinationLocationIdGhl: routing.destinationLocationIdGhl,
    routingDryRunDecisionId: routing.routingDryRunDecisionId,
    nextAction: "Review and approve delivery in Admin C.O.C.",
  };
}

export type SourceLeadIntakeServiceDeps = {
  prisma: typeof prisma;
};

export { prisma as defaultSourceLeadIntakePrisma };
