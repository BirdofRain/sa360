import type { SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { leadCaptureNextGenLeadCreatedSchema } from "../../schemas/leadcapture-nextgen-webhook.schema.js";
import {
  createSourceLeadEvent,
  findCorrelatedSourceLeadEvents,
  findSourceLeadEventById,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { findCampaignRoutingRuleById } from "../../repositories/campaign-routing-rule.repository.js";
import { logger } from "../../lib/logger.js";
import {
  LeadCaptureNextGenLeadIdError,
  resolveLeadCaptureLeadId,
  resolveLeadCaptureRouteKey,
} from "./leadcapture-payload-resolver.js";
import {
  canNormalizeLeadCaptureIoWebhook,
  inferLeadCaptureIoRoutingKeys,
  normalizeLeadCaptureIoWebhookToLifecyclePayload,
} from "./leadcapture-io-normalizer.js";
import { mergeLeadCaptureReplayNormalizationInput } from "./leadcapture-replay-merge.js";
import { trackCampaignInventorySafely } from "../lead-inventory/campaign-inventory-tracking.service.js";
import type { CampaignInventoryTrackingResult } from "../lead-inventory/campaign-inventory-tracking.service.js";
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";
import { ensureFulfillmentOutboxForSourceLead } from "../fulfillment-shadow/shadow-processor.service.js";
import { resolveLeadCaptureNiche } from "./leadcapture-niche-resolver.js";
import {
  resolveNextGenSourceIdentity,
  type NextGenSourceIdentity,
} from "./leadcapture-nextgen-source-identity.js";
import {
  getLeadCaptureNextGenIntakeStage,
  nextGenStageAtLeast,
  type LeadCaptureNextGenIntakeStage,
} from "./leadcapture-nextgen-stage.js";
import {
  assertNextGenLiveCanaryAllowed,
  recordNextGenLiveCanaryDeliveryAttempt,
} from "./leadcapture-nextgen-canary-gate.service.js";

const SOURCE_PROVIDER = "leadcapture_io" as const;
const SOURCE_SYSTEM = "leadcapture_io_nextgen" as const;

/** Match types that must never activate live/canary delivery for Next-Gen. */
const LOOSE_MATCH_TYPES = new Set(["keyword_fallback", "utm_campaign"]);

export type LeadCaptureNextGenIntakeDeps = {
  createSourceLeadEventImpl?: typeof createSourceLeadEvent;
  updateSourceLeadEventImpl?: typeof updateSourceLeadEvent;
  findCorrelatedSourceLeadEventsImpl?: typeof findCorrelatedSourceLeadEvents;
  findSourceLeadEventByIdImpl?: typeof findSourceLeadEventById;
  findCampaignRoutingRuleByIdImpl?: typeof findCampaignRoutingRuleById;
  persistRoutingAndDuplicateImpl?: typeof persistRoutingAndDuplicate;
  ensureFulfillmentOutboxForSourceLeadImpl?: typeof ensureFulfillmentOutboxForSourceLead;
  trackCampaignInventoryImpl?: typeof trackCampaignInventorySafely;
};

export type LeadCaptureNextGenIntakeInput = {
  rawPayload: Record<string, unknown>;
  webhookRequestLogId?: string;
  /** Test override; production uses env stage. */
  stageOverride?: LeadCaptureNextGenIntakeStage;
  deps?: LeadCaptureNextGenIntakeDeps;
};

export type LeadCaptureNextGenIntakeResult = {
  ok: true;
  provider: typeof SOURCE_PROVIDER;
  sourceSystem: typeof SOURCE_SYSTEM;
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  sourceLeadId: string;
  normalizedLeadUid: string | null;
  duplicate: boolean;
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  routingDryRunDecisionId?: string;
  intakeStage: LeadCaptureNextGenIntakeStage;
  shadowOutboxEnsured: boolean;
  nextAction: string;
  liveCanaryBlockedReason?: string;
  inventoryTracking?: CampaignInventoryTrackingResult;
};

export type LeadCaptureNextGenIntakeErrorCode =
  | "invalid_payload"
  | "missing_nextgen_lead_id"
  | "invalid_nextgen_lead_id";

export class LeadCaptureNextGenIntakeError extends Error {
  readonly code: LeadCaptureNextGenIntakeErrorCode;
  constructor(code: LeadCaptureNextGenIntakeErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function trimOrUndefined(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function asReplayRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function forceNextGenPayload(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    provider: "leadcapture_io",
    sa360_source_system: SOURCE_SYSTEM,
    sa360_source_platform: trimOrUndefined(raw.sa360_source_platform) ?? "leadcapture_io",
    sa360_source_type: trimOrUndefined(raw.sa360_source_type) ?? "leadcapture_form",
  };
}

/** Stage B+ routing match still uses explicit campaign_id / route key. */
function resolveRoutingCampaignId(raw: Record<string, unknown>, routeKey: string): string {
  return (
    trimOrUndefined(raw.campaign_id) ??
    trimOrUndefined(raw.sa360_campaign_id) ??
    routeKey
  );
}

function intakeModeForStage(stage: LeadCaptureNextGenIntakeStage): string {
  return stage === "inventory_only"
    ? "leadcapture_nextgen_inventory_only"
    : "leadcapture_nextgen_canary";
}

function applyNextGenProvenanceToNormalized(
  normalized: Record<string, unknown>,
  identity: NextGenSourceIdentity,
  inventoryNicheKey: string | undefined
): void {
  const attribution = asReplayRecord(normalized.attribution);
  if (attribution) {
    attribution.campaign_id = identity.sourceCampaignId;
    if (identity.sourceCampaignName) {
      attribution.campaign_name = identity.sourceCampaignName;
    }
    normalized.attribution = attribution;
  }
  const routing = asReplayRecord(normalized.routing) ?? {};
  routing.form_id = identity.stableSourceId ?? identity.sourceCampaignId;
  routing.funnel_id = identity.stableSourceId ?? identity.sourceCampaignId;
  if (inventoryNicheKey) {
    routing.niche_key = inventoryNicheKey;
  }
  const sourceIntake = asReplayRecord(routing.source_intake) ?? {};
  sourceIntake.form_id = identity.stableSourceId ?? identity.sourceCampaignId;
  sourceIntake.funnel_id = identity.stableSourceId ?? identity.sourceCampaignId;
  if (identity.sourceFunnelName) sourceIntake.funnel_name = identity.sourceFunnelName;
  if (identity.sourceCampaignName) sourceIntake.campaign_name = identity.sourceCampaignName;
  sourceIntake.source_route_key = identity.routeKey;
  routing.source_intake = sourceIntake;
  normalized.routing = routing;
}

function buildNextGenEnrichment(input: {
  stage: LeadCaptureNextGenIntakeStage;
  identity: NextGenSourceIdentity;
  nicheKey?: string;
  inventoryNicheKey?: string;
  nicheResolved?: boolean;
  nicheResolutionSource?: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    intakeStage: input.stage,
    intakeMode: intakeModeForStage(input.stage),
    providerFormId: input.identity.stableSourceId,
    funnelId:
      input.identity.stableSourceIdKind === "funnel_id" ||
      input.identity.stableSourceIdKind === "form_id" ||
      input.identity.stableSourceIdKind === "sa360_form_id"
        ? input.identity.stableSourceId
        : null,
    resolvedSourceCampaignId: input.identity.sourceCampaignId,
    resolvedSourceName: input.identity.sourceCampaignName,
    resolvedNiche: input.inventoryNicheKey ?? input.nicheKey ?? null,
    nicheResolutionSource: input.nicheResolutionSource ?? null,
    nicheResolved: input.nicheResolved ?? false,
    routeKeyReceived: input.identity.routeKey,
    routeKeyIdentityMismatch: input.identity.routeKeyIdentityMismatch,
    captureOnly: !nextGenStageAtLeast(input.stage, "inventory_only"),
    ...(input.extra ?? {}),
  };
}

function presentIdempotentReplay(
  event: SourceLeadEvent,
  stage: LeadCaptureNextGenIntakeStage,
  inventoryTracking?: CampaignInventoryTrackingResult
): LeadCaptureNextGenIntakeResult {
  return {
    ok: true,
    provider: SOURCE_PROVIDER,
    sourceSystem: SOURCE_SYSTEM,
    sourceEventId: event.id,
    status: event.status,
    sourceRouteKey: event.sourceRouteKey ?? "UNKNOWN_ROUTE",
    sourceLeadId: event.sourceLeadId ?? "",
    normalizedLeadUid: event.sourceLeadUid,
    duplicate: true,
    matched: Boolean(event.routingRuleIdResolved && event.clientAccountIdResolved),
    matchedRuleId: event.routingRuleIdResolved ?? undefined,
    destinationClientAccountId: event.clientAccountIdResolved ?? undefined,
    destinationLocationIdGhl: event.destinationLocationIdResolved ?? undefined,
    routingDryRunDecisionId: event.routingDryRunDecisionId ?? undefined,
    intakeStage: stage,
    shadowOutboxEnsured: false,
    nextAction: "Idempotent replay — existing SourceLeadEvent returned.",
    inventoryTracking,
  };
}

async function maybeEnqueueShadowOutbox(input: {
  sourceEventId: string;
  status: SourceLeadEventStatus;
  matched: boolean;
  matchType?: string;
  deliveryMode?: string | null;
  stage: LeadCaptureNextGenIntakeStage;
  ensureOutbox: typeof ensureFulfillmentOutboxForSourceLead;
}): Promise<boolean> {
  if (!nextGenStageAtLeast(input.stage, "shadow_fulfillment")) return false;
  if (!input.matched) return false;
  if (input.status === "duplicate_blocked" || input.status === "rejected") return false;
  if (input.matchType && LOOSE_MATCH_TYPES.has(input.matchType)) return false;

  const mode = (input.deliveryMode ?? "shadow").trim().toLowerCase();
  if (mode === "paused") return false;
  // Shadow outbox for shadow / live_canary / live / ready_for_live — never when paused.
  if (!["shadow", "live_canary", "live", "ready_for_live"].includes(mode)) return false;

  await input.ensureOutbox(input.sourceEventId);
  return true;
}

/**
 * LeadCapture Next-Gen intake canary.
 * Stage-gated: default capture_only (no routing/allocation/delivery).
 */
export async function processLeadCaptureNextGenLeadCreated(
  input: LeadCaptureNextGenIntakeInput
): Promise<LeadCaptureNextGenIntakeResult> {
  const stage = input.stageOverride ?? getLeadCaptureNextGenIntakeStage();
  const createEvent = input.deps?.createSourceLeadEventImpl ?? createSourceLeadEvent;
  const updateEvent = input.deps?.updateSourceLeadEventImpl ?? updateSourceLeadEvent;
  const findCorrelated =
    input.deps?.findCorrelatedSourceLeadEventsImpl ?? findCorrelatedSourceLeadEvents;
  const findById = input.deps?.findSourceLeadEventByIdImpl ?? findSourceLeadEventById;
  const findRule = input.deps?.findCampaignRoutingRuleByIdImpl ?? findCampaignRoutingRuleById;
  const persistRouting = input.deps?.persistRoutingAndDuplicateImpl ?? persistRoutingAndDuplicate;
  const ensureOutbox =
    input.deps?.ensureFulfillmentOutboxForSourceLeadImpl ?? ensureFulfillmentOutboxForSourceLead;
  const trackInventory =
    input.deps?.trackCampaignInventoryImpl ?? trackCampaignInventorySafely;
  const parsed = leadCaptureNextGenLeadCreatedSchema.safeParse(input.rawPayload);
  if (!parsed.success) {
    throw new LeadCaptureNextGenIntakeError(
      "invalid_payload",
      "Next-Gen webhook payload failed structured validation."
    );
  }

  const raw = forceNextGenPayload(input.rawPayload);
  if (!canNormalizeLeadCaptureIoWebhook(raw)) {
    throw new LeadCaptureNextGenIntakeError(
      "invalid_payload",
      "Next-Gen webhook payload is not a recognizable LeadCapture object."
    );
  }

  let leadId: string;
  let routeKey: string;
  try {
    routeKey = resolveLeadCaptureRouteKey(raw);
    ({ leadId } = resolveLeadCaptureLeadId(raw, routeKey));
  } catch (err) {
    if (err instanceof LeadCaptureNextGenLeadIdError) {
      throw new LeadCaptureNextGenIntakeError(err.code, err.message);
    }
    throw err;
  }

  const identity = resolveNextGenSourceIdentity(raw, routeKey);
  const nicheHint = resolveLeadCaptureNiche(raw);

  const existing = await findCorrelated(SOURCE_PROVIDER, SOURCE_SYSTEM, leadId);
  let event: Awaited<ReturnType<typeof createEvent>> | null = null;
  let replayPromotion = false;
  if (existing.length > 0) {
    const prior = await findById(existing[0].id);
    if (prior?.normalizedPayloadJson) {
      const inventoryTracking = await trackInventory({
        sourceLeadEventId: prior.id,
        sourceLane: "leadcapture_io",
      });
      return presentIdempotentReplay(prior, stage, inventoryTracking);
    }
    if (prior && !nextGenStageAtLeast(stage, "inventory_only")) {
      return presentIdempotentReplay(prior, stage);
    }
    if (prior) {
      event = prior;
      replayPromotion = true;
    }
  }

  const routingHints = inferLeadCaptureIoRoutingKeys(raw);
  const now = new Date();
  const sourceLeadUid = `leadcaptureio-${SOURCE_SYSTEM}-${leadId}`;

  if (!event) {
    event = await createEvent({
    sourceProvider: SOURCE_PROVIDER,
    sourceSystem: SOURCE_SYSTEM,
    sourceType: "webhook",
    sourceRouteKey: routeKey,
    sourceCampaignId: identity.sourceCampaignId,
    sourceCampaignName: identity.sourceCampaignName ?? routingHints.campaignName ?? null,
    sourceFunnelName: identity.sourceFunnelName ?? routingHints.funnelName ?? identity.stableSourceId,
    sourceLeadId: leadId,
    sourceLeadUid,
    webhookRequestLogId: input.webhookRequestLogId ?? null,
    status: "received",
    rawPayloadJson: raw as object,
    enrichmentMetadataJson: buildNextGenEnrichment({
      stage,
      identity,
      nicheKey: nicheHint.nicheKey,
      inventoryNicheKey: nicheHint.inventoryNicheKey,
      nicheResolved: nicheHint.resolved,
      nicheResolutionSource: nicheHint.resolutionSource,
    }) as object,
    receivedAt: now,
  });
  }

  if (!nextGenStageAtLeast(stage, "inventory_only")) {
    return {
      ok: true,
      provider: SOURCE_PROVIDER,
      sourceSystem: SOURCE_SYSTEM,
      sourceEventId: event.id,
      status: "received",
      sourceRouteKey: routeKey,
      sourceLeadId: leadId,
      normalizedLeadUid: sourceLeadUid,
      duplicate: false,
      matched: false,
      intakeStage: stage,
      shadowOutboxEnsured: false,
      nextAction:
        "Stage A capture-only — lead retained in global pool; routing/delivery not run.",
    };
  }

  const mergeBase = replayPromotion
    ? mergeLeadCaptureReplayNormalizationInput({
        latestPayload: raw,
        originalRawPayload: event.rawPayloadJson,
        originalSourceLeadId: event.sourceLeadId,
        originalSourceRouteKey: event.sourceRouteKey,
      })
    : raw;

  const effectiveRouteKey =
    trimOrUndefined(mergeBase.sa360_route_key) ??
    (replayPromotion ? trimOrUndefined(event.sourceRouteKey) : undefined) ??
    routeKey;
  const effectiveIdentity = resolveNextGenSourceIdentity(mergeBase, effectiveRouteKey);
  const effectiveNiche = resolveLeadCaptureNiche(mergeBase);
  const routingCampaignId = resolveRoutingCampaignId(mergeBase, effectiveRouteKey);

  if (replayPromotion) {
    const priorEnrichment = asReplayRecord(event.enrichmentMetadataJson);
    await updateEvent(event.id, {
      rawPayloadJson: mergeBase as object,
      sourceCampaignId: effectiveIdentity.sourceCampaignId,
      sourceCampaignName: effectiveIdentity.sourceCampaignName,
      sourceFunnelName: effectiveIdentity.sourceFunnelName,
      enrichmentMetadataJson: {
        ...(priorEnrichment ?? {}),
        ...buildNextGenEnrichment({
          stage,
          identity: effectiveIdentity,
          nicheKey: effectiveNiche.nicheKey,
          inventoryNicheKey: effectiveNiche.inventoryNicheKey,
          nicheResolved: effectiveNiche.resolved,
          nicheResolutionSource: effectiveNiche.resolutionSource,
          extra: { replayPromotion: true },
        }),
      } as object,
    });
  }

  // Ensure attribution uses explicit campaign_id for exact matcher tiers.
  const normalizeInput = {
    ...mergeBase,
    sa360_source_system: SOURCE_SYSTEM,
    sa360_route_key: effectiveRouteKey,
    ...(trimOrUndefined(mergeBase.campaign_id) ? {} : { campaign_id: routingCampaignId }),
  };

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(normalizeInput);
  // Stage B+ routing match still uses campaign_id / route key.
  // Inventory identity uses the immutable funnel/form ID.
  if (normalized.attribution) {
    normalized.attribution.campaign_id = nextGenStageAtLeast(stage, "normalize_route_proof")
      ? routingCampaignId
      : effectiveIdentity.sourceCampaignId;
  }
  if (normalized.routing) {
    (normalized.routing as Record<string, unknown>).form_id =
      effectiveIdentity.stableSourceId ?? effectiveIdentity.sourceCampaignId;
    (normalized.routing as Record<string, unknown>).funnel_id =
      effectiveIdentity.stableSourceId ?? effectiveIdentity.sourceCampaignId;
  }

  if (!nextGenStageAtLeast(stage, "normalize_route_proof")) {
    applyNextGenProvenanceToNormalized(
      normalized as unknown as Record<string, unknown>,
      effectiveIdentity,
      effectiveNiche.inventoryNicheKey
    );
    const lifecycleParsedInventory = lifecycleEventSchema.safeParse(normalized);
    const inventoryStatus = lifecycleParsedInventory.success ? "normalized" : "needs_review";
    await updateEvent(event.id, {
      status: inventoryStatus,
      errorSummary: lifecycleParsedInventory.success
        ? null
        : "Normalized Next-Gen payload failed lifecycle schema validation.",
      normalizedAt: now,
      normalizedPayloadJson: normalized as object,
      sourceCampaignId: effectiveIdentity.sourceCampaignId,
      sourceCampaignName: effectiveIdentity.sourceCampaignName,
      sourceFunnelName: effectiveIdentity.sourceFunnelName,
      enrichmentMetadataJson: buildNextGenEnrichment({
        stage,
        identity: effectiveIdentity,
        nicheKey: effectiveNiche.nicheKey,
        inventoryNicheKey: effectiveNiche.inventoryNicheKey,
        nicheResolved: effectiveNiche.resolved,
        nicheResolutionSource: effectiveNiche.resolutionSource,
        extra: {
          replayPromotion,
          inventoryTrackingAttempted: true,
        },
      }) as object,
    });

    const inventoryTracking = await trackInventory({
      sourceLeadEventId: event.id,
      sourceLane: "leadcapture_io",
    });

    logger.info("source_intake.leadcapture_nextgen.inventory_only", {
      sourceEventId: event.id,
      intakeStage: stage,
      resolvedSourceCampaignId: effectiveIdentity.sourceCampaignId,
      resolvedNiche: effectiveNiche.inventoryNicheKey ?? effectiveNiche.nicheKey ?? null,
      routeKeyIdentityMismatch: effectiveIdentity.routeKeyIdentityMismatch,
      inventoryOutcome: inventoryTracking.ok ? inventoryTracking.outcome : inventoryTracking.code,
    });
    if (effectiveIdentity.routeKeyIdentityMismatch) {
      logger.warn("source_intake.leadcapture_nextgen.route_key_identity_mismatch", {
        sourceEventId: event.id,
        resolvedSourceCampaignId: effectiveIdentity.sourceCampaignId,
        routeKeyReceived: effectiveIdentity.routeKey,
      });
    }

    return {
      ok: true,
      provider: SOURCE_PROVIDER,
      sourceSystem: SOURCE_SYSTEM,
      sourceEventId: event.id,
      status: inventoryStatus,
      sourceRouteKey: effectiveRouteKey,
      sourceLeadId: leadId,
      normalizedLeadUid: sourceLeadUid,
      duplicate: replayPromotion,
      matched: false,
      intakeStage: stage,
      shadowOutboxEnsured: false,
      inventoryTracking,
      nextAction:
        "Inventory-only — canonical inventory captured; routing/fulfillment not run.",
    };
  }

  const lifecycleParsed = lifecycleEventSchema.safeParse(normalized);
  if (!lifecycleParsed.success) {
    await updateEvent(event.id, {
      status: "needs_review",
      errorSummary: "Normalized Next-Gen payload failed lifecycle schema validation.",
      normalizedAt: now,
      normalizedPayloadJson: normalized as object,
    });
    return {
      ok: true,
      provider: SOURCE_PROVIDER,
      sourceSystem: SOURCE_SYSTEM,
      sourceEventId: event.id,
      status: "needs_review",
      sourceRouteKey: routeKey,
      sourceLeadId: leadId,
      normalizedLeadUid: sourceLeadUid,
      duplicate: false,
      matched: false,
      intakeStage: stage,
      shadowOutboxEnsured: false,
      nextAction: "Review unmatched/invalid Next-Gen lead in Admin C.O.C.",
    };
  }

  const { routing, status } = await persistRouting(
    event.id,
    lifecycleParsed.data,
    mergeBase,
    SOURCE_PROVIDER,
    SOURCE_SYSTEM,
    effectiveRouteKey,
    leadId,
    false,
    now.toISOString(),
    now
  );

  let effectiveStatus = status;
  let effectiveMatched = routing.matched;
  let liveCanaryBlockedReason: string | undefined;

  // Never treat loose keyword/UTM matches as canary-eligible client association.
  if (routing.matched && routing.matchType && LOOSE_MATCH_TYPES.has(routing.matchType)) {
    effectiveMatched = false;
    effectiveStatus = "routing_unmatched";
    await updateEvent(event.id, {
      status: "routing_unmatched",
      clientAccountIdResolved: null,
      destinationLocationIdResolved: null,
      routingRuleIdResolved: null,
      errorSummary:
        "Next-Gen canary rejected loose match type; exact campaign/form match required.",
      enrichmentMetadataJson: buildNextGenEnrichment({
        stage,
        identity: effectiveIdentity,
        nicheKey: effectiveNiche.nicheKey,
        inventoryNicheKey: effectiveNiche.inventoryNicheKey,
        nicheResolved: effectiveNiche.resolved,
        nicheResolutionSource: effectiveNiche.resolutionSource,
        extra: {
          rejectedMatchType: routing.matchType,
          unmatchedReason: "loose_match_not_allowed",
        },
      }) as object,
    });
  }

  let deliveryMode: string | null = null;
  if (effectiveMatched && routing.matchedRuleId) {
    const rule = await findRule(routing.matchedRuleId);
    deliveryMode = rule?.deliveryMode ?? null;
    if (rule && (rule.deliveryMode === "paused" || rule.active === false)) {
      effectiveStatus = "needs_review";
      await updateEvent(event.id, {
        status: "needs_review",
        errorSummary: "Matched campaign is paused or inactive.",
      });
    }
  }

  const shadowOutboxEnsured = await maybeEnqueueShadowOutbox({
    sourceEventId: event.id,
    status: effectiveStatus,
    matched: effectiveMatched,
    matchType: routing.matchType,
    deliveryMode,
    stage,
    ensureOutbox,
  });

  const inventoryTracking = await trackInventory({
    sourceLeadEventId: event.id,
    sourceLane: "leadcapture_io",
  });

  if (nextGenStageAtLeast(stage, "live_canary") && effectiveMatched) {
    const gate = await assertNextGenLiveCanaryAllowed({
      sourceLeadEventId: event.id,
      clientAccountId: routing.destinationClientAccountId ?? null,
      campaignId: routingCampaignId,
      deliveryMode,
    });
    if (!gate.ok) {
      liveCanaryBlockedReason = gate.reason;
      logger.info("source_intake.leadcapture_nextgen.live_canary_blocked", {
        sourceEventId: event.id,
        reason: gate.reason,
      });
    } else {
      await recordNextGenLiveCanaryDeliveryAttempt(event.id);
    }
  }

  return {
    ok: true,
    provider: SOURCE_PROVIDER,
    sourceSystem: SOURCE_SYSTEM,
    sourceEventId: event.id,
    status: effectiveStatus,
    sourceRouteKey: effectiveRouteKey,
    sourceLeadId: leadId,
    normalizedLeadUid: sourceLeadUid,
    duplicate: replayPromotion,
    matched: effectiveMatched,
    matchedRuleId: effectiveMatched ? routing.matchedRuleId : undefined,
    destinationClientAccountId: effectiveMatched
      ? routing.destinationClientAccountId
      : undefined,
    destinationLocationIdGhl: effectiveMatched
      ? routing.destinationLocationIdGhl
      : undefined,
    routingDryRunDecisionId: routing.routingDryRunDecisionId,
    intakeStage: stage,
    shadowOutboxEnsured,
    liveCanaryBlockedReason,
    inventoryTracking,
    nextAction: effectiveMatched
      ? shadowOutboxEnsured
        ? "Shadow fulfillment outbox ensured — review in Admin C.O.C."
        : "Matched — retained in global pool; delivery remains shadow-gated."
      : "Unmatched — sent to review; no fallback client assigned.",
  };
}
