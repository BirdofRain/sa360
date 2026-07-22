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
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";
import { ensureFulfillmentOutboxForSourceLead } from "../fulfillment-shadow/shadow-processor.service.js";
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

function forceNextGenPayload(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    ...raw,
    provider: "leadcapture_io",
    sa360_source_system: SOURCE_SYSTEM,
    sa360_source_platform: trimOrUndefined(raw.sa360_source_platform) ?? "leadcapture_io",
    sa360_source_type: trimOrUndefined(raw.sa360_source_type) ?? "leadcapture_form",
  };
}

function resolveCampaignId(raw: Record<string, unknown>, routeKey: string): string {
  return (
    trimOrUndefined(raw.campaign_id) ??
    trimOrUndefined(raw.sa360_campaign_id) ??
    routeKey
  );
}

function resolveFormOrFunnelId(raw: Record<string, unknown>): string | null {
  return (
    trimOrUndefined(raw.funnel_id) ??
    trimOrUndefined(raw.form_id) ??
    trimOrUndefined(raw.sa360_form_id) ??
    null
  );
}

function presentIdempotentReplay(
  event: SourceLeadEvent,
  stage: LeadCaptureNextGenIntakeStage
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

  const campaignId = resolveCampaignId(raw, routeKey);

  const existing = await findCorrelated(SOURCE_PROVIDER, SOURCE_SYSTEM, leadId);
  if (existing.length > 0) {
    const prior = await findById(existing[0].id);
    if (prior) return presentIdempotentReplay(prior, stage);
  }

  const routingHints = inferLeadCaptureIoRoutingKeys(raw);
  const formOrFunnelId = resolveFormOrFunnelId(raw);
  const now = new Date();
  const sourceLeadUid = `leadcaptureio-${SOURCE_SYSTEM}-${leadId}`;

  const event = await createEvent({
    sourceProvider: SOURCE_PROVIDER,
    sourceSystem: SOURCE_SYSTEM,
    sourceType: "webhook",
    sourceRouteKey: routeKey,
    sourceCampaignId: campaignId,
    sourceCampaignName: routingHints.campaignName ?? null,
    sourceFunnelName: routingHints.funnelName ?? formOrFunnelId,
    sourceLeadId: leadId,
    sourceLeadUid,
    webhookRequestLogId: input.webhookRequestLogId ?? null,
    status: "received",
    rawPayloadJson: raw as object,
    enrichmentMetadataJson: {
      intakeStage: stage,
      intakeMode: "leadcapture_nextgen_canary",
      providerFormId: formOrFunnelId,
      captureOnly: !nextGenStageAtLeast(stage, "normalize_route_proof"),
    } as object,
    receivedAt: now,
  });

  if (!nextGenStageAtLeast(stage, "normalize_route_proof")) {
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

  // Ensure attribution uses explicit campaign_id for exact matcher tiers.
  const normalizeInput = {
    ...raw,
    sa360_source_system: SOURCE_SYSTEM,
    sa360_route_key: routeKey,
    ...(trimOrUndefined(raw.campaign_id) ? {} : { campaign_id: campaignId }),
  };

  const normalized = normalizeLeadCaptureIoWebhookToLifecyclePayload(normalizeInput);
  // Prefer exact campaign_id over route-key-only attribution for Next-Gen.
  if (normalized.attribution) {
    normalized.attribution.campaign_id = campaignId;
  }
  if (formOrFunnelId && normalized.routing) {
    (normalized.routing as Record<string, unknown>).form_id = formOrFunnelId;
    (normalized.routing as Record<string, unknown>).funnel_id = formOrFunnelId;
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
    raw,
    SOURCE_PROVIDER,
    SOURCE_SYSTEM,
    routeKey,
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
      enrichmentMetadataJson: {
        intakeStage: stage,
        intakeMode: "leadcapture_nextgen_canary",
        providerFormId: formOrFunnelId,
        rejectedMatchType: routing.matchType,
        unmatchedReason: "loose_match_not_allowed",
      } as object,
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

  if (nextGenStageAtLeast(stage, "live_canary") && effectiveMatched) {
    const gate = await assertNextGenLiveCanaryAllowed({
      sourceLeadEventId: event.id,
      clientAccountId: routing.destinationClientAccountId ?? null,
      campaignId,
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
    sourceRouteKey: routeKey,
    sourceLeadId: leadId,
    normalizedLeadUid: sourceLeadUid,
    duplicate: false,
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
    nextAction: effectiveMatched
      ? shadowOutboxEnsured
        ? "Shadow fulfillment outbox ensured — review in Admin C.O.C."
        : "Matched — retained in global pool; delivery remains shadow-gated."
      : "Unmatched — sent to review; no fallback client assigned.",
  };
}
