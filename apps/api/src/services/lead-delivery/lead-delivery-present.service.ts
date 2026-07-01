import type { SourceEnrichmentMetadata } from "../source-intake/source-enrichment.types.js";
import { parseMatchTypeFromReason } from "../routing-dry-run-admin.present.js";
import {
  normalizeDeliveryStatus,
  normalizeGhlContactStatus,
  normalizeRoutingStatus,
} from "./lead-delivery-status.js";
import {
  contactIdFromDeliveryResult,
  deliveryResultContactStatus,
  deliveryResultStatus,
  parseAttributionIds,
  parseContactFromNormalized,
  type LeadDeliveryJoinContext,
} from "./lead-delivery-read.service.js";
import {
  maskEmailForClient,
  maskPhoneForAdmin,
  maskPhoneForClient,
  redactSecrets,
} from "./lead-delivery-redact.js";
import { buildLeadDeliveryTimeline, safeSourceAttributes } from "./lead-delivery-timeline.service.js";
import type {
  LeadDeliveryAdminDetail,
  LeadDeliveryDataSource,
  LeadDeliveryDetail,
  LeadDeliveryListRow,
} from "./lead-delivery.types.js";

export type LeadDeliveryAudience = "admin" | "client";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function routingResultMatched(routingResultJson: unknown): boolean | null {
  const root = asRecord(routingResultJson);
  if (typeof root?.matched === "boolean") return root.matched;
  return null;
}

function resolveDataSource(ctx: LeadDeliveryJoinContext): LeadDeliveryDataSource {
  const hasRouting = Boolean(ctx.decision || ctx.sourceLead.routingResultJson);
  const hasDelivery = Boolean(ctx.plan || ctx.sourceLead.deliveryResultJson);
  const hasLifecycle = Boolean(ctx.timeline);
  if (hasRouting && hasDelivery && hasLifecycle) return "live";
  if (hasRouting || hasDelivery || ctx.sourceLead.normalizedPayloadJson) return "partial_live";
  return "partial_live";
}

function resolveLastEvent(ctx: LeadDeliveryJoinContext): { at: string | null; name: string | null } {
  const candidates: { at: Date; name: string }[] = [];
  const sl = ctx.sourceLead;
  if (sl.deliveredAt) candidates.push({ at: sl.deliveredAt, name: "lead_delivered" });
  if (sl.approvedAt) candidates.push({ at: sl.approvedAt, name: "lead_delivery_started" });
  if (sl.routedAt) candidates.push({ at: sl.routedAt, name: "lead_routed" });
  if (sl.normalizedAt) candidates.push({ at: sl.normalizedAt, name: "lead_created" });
  candidates.push({ at: sl.receivedAt, name: "source_lead_received" });

  if (ctx.timeline?.timeline.length) {
    const last = ctx.timeline.timeline[ctx.timeline.timeline.length - 1];
    if (last?.receivedAt) {
      return {
        at: last.receivedAt,
        name: last.eventNameInternal ?? last.summary ?? null,
      };
    }
  }

  const latest = candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return latest ? { at: latest.at.toISOString(), name: latest.name } : { at: null, name: null };
}

function buildWarnings(ctx: LeadDeliveryJoinContext): string[] {
  const warnings: string[] = [];
  const enrichment = ctx.sourceLead.enrichmentMetadataJson as SourceEnrichmentMetadata | null;
  if (enrichment?.deliveryWarnings?.length) {
    warnings.push(...enrichment.deliveryWarnings.map((w) => redactSecrets(w) ?? w));
  }
  if (ctx.timeline?.warnings?.length) {
    warnings.push(...ctx.timeline.warnings.map((w) => redactSecrets(w) ?? w));
  }
  if (ctx.plan && !ctx.adapterRun && !ctx.liveRun && ctx.sourceLead.status === "approved") {
    warnings.push("Delivery approved but no adapter or live run recorded yet.");
  }
  return [...new Set(warnings.filter(Boolean))];
}

function presentMatchedClient(ctx: LeadDeliveryJoinContext, audience: LeadDeliveryAudience): string | null {
  if (ctx.clientDisplayName) return ctx.clientDisplayName;
  const id = ctx.sourceLead.clientAccountIdResolved ?? ctx.decision?.destinationClientAccountId ?? null;
  if (!id) return null;
  return audience === "client" ? "Your account" : id;
}

export function presentLeadDeliveryListRow(
  ctx: LeadDeliveryJoinContext,
  audience: LeadDeliveryAudience
): LeadDeliveryListRow {
  const contact = parseContactFromNormalized(ctx.sourceLead.normalizedPayloadJson);
  const { adId, adName } = parseAttributionIds(ctx.sourceLead.enrichmentMetadataJson);
  const contactId =
    ctx.timeline?.identity.contactIdGhl ??
    contactIdFromDeliveryResult(ctx.sourceLead.deliveryResultJson) ??
    null;
  const routingMatched =
    ctx.decision?.matched ??
    routingResultMatched(ctx.sourceLead.routingResultJson) ??
    Boolean(ctx.sourceLead.routingRuleIdResolved);
  const routingStatus = normalizeRoutingStatus({
    sourceStatus: ctx.sourceLead.status,
    matched: routingMatched,
    routingRuleId: ctx.sourceLead.routingRuleIdResolved,
    validationStatus: ctx.decision?.validationStatus,
    deliveryMode: ctx.plan?.deliveryMode ?? ctx.decision?.deliveryMode,
    planStatus: ctx.plan?.status,
  });
  const deliveryStatus = normalizeDeliveryStatus({
    sourceStatus: ctx.sourceLead.status,
    deliveryMode: ctx.plan?.deliveryMode ?? ctx.decision?.deliveryMode,
    planStatus: ctx.plan?.status,
    adapterRunStatus: ctx.adapterRun?.status,
    liveRunStatus: ctx.liveRun?.status,
    deliveryResultStatus: deliveryResultStatus(ctx.sourceLead.deliveryResultJson),
    hasContactId: Boolean(contactId),
  });
  const ghlContactStatus = normalizeGhlContactStatus({
    contactIdGhl: contactId,
    deliveryResultContactStatus: deliveryResultContactStatus(ctx.sourceLead.deliveryResultJson),
    liveRunContactCreated: ctx.liveRun?.status === "completed" || ctx.liveRun?.status === "succeeded",
  });
  const lastEvent = resolveLastEvent(ctx);
  const phoneRaw = contact.phoneE164;
  const emailRaw = contact.email;

  const row: LeadDeliveryListRow = {
    id: ctx.sourceLead.id,
    sourceLeadId: ctx.sourceLead.sourceLeadId,
    leadUid: ctx.sourceLead.sourceLeadUid,
    contactIdGhl: contactId,
    clientAccountId: ctx.sourceLead.clientAccountIdResolved ?? ctx.decision?.destinationClientAccountId ?? null,
    clientDisplayName: ctx.clientDisplayName,
    subaccountIdGhl:
      ctx.sourceLead.destinationLocationIdResolved ?? ctx.decision?.destinationSubaccountIdGhl ?? null,
    leadName: contact.leadName,
    phoneMasked:
      audience === "client"
        ? maskPhoneForClient(phoneRaw)
        : maskPhoneForAdmin(phoneRaw),
    emailMasked:
      audience === "client" ? maskEmailForClient(emailRaw) : emailRaw,
    sourcePlatform: ctx.sourceLead.sourceProvider,
    sourceType: ctx.sourceLead.sourceType,
    campaignId: ctx.sourceLead.sourceCampaignId,
    campaignName: ctx.sourceLead.sourceCampaignName ?? ctx.sourceLead.sourceRouteKey,
    adId,
    adName,
    receivedAt: ctx.sourceLead.receivedAt.toISOString(),
    lastEventAt: lastEvent.at,
    lastEventName: lastEvent.name,
    matchedClient: presentMatchedClient(ctx, audience),
    routingStatus,
    deliveryStatus,
    ghlContactStatus,
    workflowStarted: ctx.timeline?.currentState.routingStatus === "workflow_started" ? true : null,
    appointmentStatus: ctx.timeline?.currentState.appointmentStatus ?? null,
    soldStatus: ctx.timeline?.currentState.policyStatus ?? null,
    errorCode: ctx.sourceLead.status === "delivery_failed" ? "delivery_failed" : null,
    errorSummary: redactSecrets(ctx.sourceLead.errorSummary),
    warnings: buildWarnings(ctx),
    dataSource: resolveDataSource(ctx),
  };

  if (audience === "admin") {
    row.phoneE164 = phoneRaw;
    row.email = emailRaw;
  }

  return row;
}

export function presentLeadDeliveryDetail(
  ctx: LeadDeliveryJoinContext,
  audience: LeadDeliveryAudience
): LeadDeliveryDetail {
  const base = presentLeadDeliveryListRow(ctx, audience);
  const enrichment = ctx.sourceLead.enrichmentMetadataJson as SourceEnrichmentMetadata | null;
  const routingResult = asRecord(ctx.sourceLead.routingResultJson);
  const duplicateRisk = asRecord(ctx.sourceLead.duplicateRiskJson);
  const contactId =
    base.contactIdGhl ??
    contactIdFromDeliveryResult(ctx.sourceLead.deliveryResultJson);

  const detail: LeadDeliveryDetail = {
    ...base,
    attribution: {
      sourceCampaignId: ctx.sourceLead.sourceCampaignId,
      sourceCampaignName: ctx.sourceLead.sourceCampaignName,
      sourceFunnelName: ctx.sourceLead.sourceFunnelName,
      adId: base.adId,
      adName: base.adName,
      sourceAttributes: safeSourceAttributes(enrichment),
    },
    routing: {
      matched: ctx.decision?.matched ?? routingResultMatched(ctx.sourceLead.routingResultJson) ?? false,
      matchType:
        parseMatchTypeFromReason(ctx.decision?.matchReason) ??
        (typeof routingResult?.matchType === "string" ? routingResult.matchType : null),
      routingRuleId: ctx.sourceLead.routingRuleIdResolved ?? ctx.decision?.matchedRuleId ?? null,
      routingDryRunDecisionId: ctx.sourceLead.routingDryRunDecisionId,
      destinationClientAccountId:
        ctx.sourceLead.clientAccountIdResolved ?? ctx.decision?.destinationClientAccountId ?? null,
      destinationSubaccountIdGhl:
        ctx.sourceLead.destinationLocationIdResolved ?? ctx.decision?.destinationSubaccountIdGhl ?? null,
      deliveryMode: ctx.plan?.deliveryMode ?? ctx.decision?.deliveryMode ?? null,
      reason: redactSecrets(
        ctx.decision?.matchReason ??
          (typeof routingResult?.reason === "string" ? routingResult.reason : null)
      ),
      validationStatus: ctx.decision?.validationStatus ?? null,
    },
    delivery: {
      planId: ctx.plan?.id ?? null,
      planStatus: ctx.plan?.status ?? null,
      deliveryMode: ctx.plan?.deliveryMode ?? ctx.decision?.deliveryMode ?? null,
      adapterRunId: ctx.adapterRun?.id ?? null,
      adapterRunStatus: ctx.adapterRun?.status ?? null,
      liveRunId: ctx.liveRun?.id ?? null,
      liveRunStatus: ctx.liveRun?.status ?? null,
      deliveredAt: ctx.sourceLead.deliveredAt?.toISOString() ?? ctx.liveRun?.completedAt?.toISOString() ?? null,
      approvedAt: ctx.sourceLead.approvedAt?.toISOString() ?? null,
      approvedBy: audience === "admin" ? ctx.sourceLead.approvedBy : null,
    },
    lifecycle: {
      intakeStatus: enrichment?.intakeStatus ?? null,
      enrichmentStatus: enrichment?.enrichmentStatus ?? null,
      automationReadiness: enrichment?.automationReadiness ?? null,
      lifecycleStage: ctx.timeline?.currentState.lifecycleStage ?? null,
      agentDisposition: ctx.timeline?.currentState.agentDisposition ?? null,
      aiStatus: ctx.timeline?.currentState.aiStatus ?? null,
    },
    timeline: buildLeadDeliveryTimeline({
      sourceLead: ctx.sourceLead,
      timeline: ctx.timeline,
      contactIdGhl: contactId,
    }),
  };

  if (audience === "admin") {
    detail.adminDetail = {
      routingDryRunDecisionId: ctx.sourceLead.routingDryRunDecisionId,
      deliveryPlanId: ctx.plan?.id ?? null,
      webhookRequestLogId: ctx.sourceLead.webhookRequestLogId,
      duplicateRiskSummary:
        typeof duplicateRisk?.summary === "string"
          ? redactSecrets(duplicateRisk.summary)
          : duplicateRisk?.blocksDelivery
            ? "Duplicate risk flagged"
            : null,
      enrichmentWarnings: enrichment?.deliveryWarnings?.map((w) => redactSecrets(w) ?? w) ?? [],
    };
  }

  return detail;
}
