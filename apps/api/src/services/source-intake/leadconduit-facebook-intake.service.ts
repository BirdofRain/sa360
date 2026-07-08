import type { Prisma, SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";
import {
  createSourceLeadEvent,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";
import {
  LEADCONDUIT_FACEBOOK_PROVIDER,
  LEADCONDUIT_FACEBOOK_SOURCE_SYSTEM,
  buildLeadConduitSourceLeadUid,
  canNormalizeLeadConduitFacebookPayload,
  extractLeadConduitFacebookFields,
  normalizeLeadConduitFacebookToLifecyclePayload,
  resolveLeadConduitReplayIdentity,
  resolveLeadConduitRouteKey,
} from "./leadconduit-facebook-normalizer.js";

type JsonObject = Prisma.JsonObject;

const TERMINAL_REPLAY_STATUSES: ReadonlySet<SourceLeadEventStatus> = new Set([
  "routing_matched",
  "routing_unmatched",
  "duplicate_blocked",
  "approved",
  "delivered",
  "delivery_failed",
  "rejected",
]);

export type LeadConduitFacebookIntakeInput = {
  rawPayload: Record<string, unknown>;
  webhookRequestLogId?: string;
  masterClientAccountId: string;
};

export type LeadConduitFacebookIntakeResult = {
  ok: true;
  provider: "facebook";
  sourceSystem: "external_vendor";
  sourceLane: "leadconduit_facebook";
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  sourceLeadId: string;
  normalizedLeadUid: string;
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  routingDryRunDecisionId?: string;
  replayed: boolean;
  nextAction: string;
};

type ReplayMergeResult = {
  effectiveRaw: Record<string, unknown>;
  conflictKeys: string[];
  addedKeys: string[];
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseRoutingResult(
  value: unknown
): {
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  routingDryRunDecisionId?: string;
} {
  const rec = asObject(value);
  return {
    matched: Boolean(rec?.matched),
    matchedRuleId: typeof rec?.matchedRuleId === "string" ? rec.matchedRuleId : undefined,
    destinationClientAccountId:
      typeof rec?.destinationClientAccountId === "string"
        ? rec.destinationClientAccountId
        : undefined,
    destinationLocationIdGhl:
      typeof rec?.destinationLocationIdGhl === "string"
        ? rec.destinationLocationIdGhl
        : undefined,
    routingDryRunDecisionId:
      typeof rec?.routingDryRunDecisionId === "string"
        ? rec.routingDryRunDecisionId
        : undefined,
  };
}

function buildResult(input: {
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  sourceLeadId: string;
  normalizedLeadUid: string;
  replayed: boolean;
  routingResultJson: unknown;
}): LeadConduitFacebookIntakeResult {
  const routing = parseRoutingResult(input.routingResultJson);
  return {
    ok: true,
    provider: LEADCONDUIT_FACEBOOK_PROVIDER,
    sourceSystem: LEADCONDUIT_FACEBOOK_SOURCE_SYSTEM,
    sourceLane: "leadconduit_facebook",
    sourceEventId: input.sourceEventId,
    status: input.status,
    sourceRouteKey: input.sourceRouteKey,
    sourceLeadId: input.sourceLeadId,
    normalizedLeadUid: input.normalizedLeadUid,
    matched: routing.matched,
    matchedRuleId: routing.matchedRuleId,
    destinationClientAccountId: routing.destinationClientAccountId,
    destinationLocationIdGhl: routing.destinationLocationIdGhl,
    routingDryRunDecisionId: routing.routingDryRunDecisionId,
    replayed: input.replayed,
    nextAction: "Review and approve delivery in Admin C.O.C.",
  };
}

function mergeReplayPayload(
  firstRawPayload: Record<string, unknown>,
  incomingRawPayload: Record<string, unknown>
): ReplayMergeResult {
  const effectiveRaw = { ...firstRawPayload };
  const addedKeys: string[] = [];
  const conflictKeys: string[] = [];

  for (const [key, incoming] of Object.entries(incomingRawPayload)) {
    if (!(key in effectiveRaw)) {
      effectiveRaw[key] = incoming;
      addedKeys.push(key);
      continue;
    }
    const existing = effectiveRaw[key];
    if (JSON.stringify(existing) !== JSON.stringify(incoming)) {
      conflictKeys.push(key);
    }
  }

  return { effectiveRaw, addedKeys, conflictKeys };
}

async function findReplayEvent(sourceLeadUid: string): Promise<SourceLeadEvent | null> {
  return prisma.sourceLeadEvent.findFirst({
    where: {
      sourceProvider: LEADCONDUIT_FACEBOOK_PROVIDER,
      sourceSystem: LEADCONDUIT_FACEBOOK_SOURCE_SYSTEM,
      sourceLeadUid,
    },
    orderBy: { receivedAt: "asc" },
  });
}

export type LeadConduitFacebookIntakeDeps = {
  findReplayEventImpl: (sourceLeadUid: string) => Promise<SourceLeadEvent | null>;
  createSourceLeadEventImpl: typeof createSourceLeadEvent;
  updateSourceLeadEventImpl: typeof updateSourceLeadEvent;
  persistRoutingAndDuplicateImpl: typeof persistRoutingAndDuplicate;
};

const defaultLeadConduitFacebookIntakeDeps: LeadConduitFacebookIntakeDeps = {
  findReplayEventImpl: findReplayEvent,
  createSourceLeadEventImpl: createSourceLeadEvent,
  updateSourceLeadEventImpl: updateSourceLeadEvent,
  persistRoutingAndDuplicateImpl: persistRoutingAndDuplicate,
};

/**
 * LeadConduit Facebook intake adapter.
 *
 * Converts vendor payloads into the existing canonical source-intake pipeline and
 * guards replay by stable delivery identity without introducing schema changes.
 */
export async function processLeadConduitFacebookIntake(
  input: LeadConduitFacebookIntakeInput,
  deps: LeadConduitFacebookIntakeDeps = defaultLeadConduitFacebookIntakeDeps
): Promise<LeadConduitFacebookIntakeResult> {
  if (!canNormalizeLeadConduitFacebookPayload(input.rawPayload)) {
    throw new Error("invalid_leadconduit_facebook_payload");
  }

  const now = new Date();
  const fields = extractLeadConduitFacebookFields(input.rawPayload);
  const replayIdentity = resolveLeadConduitReplayIdentity(input.rawPayload, fields);
  const sourceLeadUid = buildLeadConduitSourceLeadUid(replayIdentity);
  const sourceRouteKey = resolveLeadConduitRouteKey(fields);
  const normalizedLeadUid = `leadconduit-facebook-${fields.sourceLeadId}`;

  const existingReplayEvent = await deps.findReplayEventImpl(sourceLeadUid);
  if (existingReplayEvent && TERMINAL_REPLAY_STATUSES.has(existingReplayEvent.status)) {
    return buildResult({
      sourceEventId: existingReplayEvent.id,
      status: existingReplayEvent.status,
      sourceRouteKey: existingReplayEvent.sourceRouteKey ?? sourceRouteKey,
      sourceLeadId: existingReplayEvent.sourceLeadId ?? fields.sourceLeadId,
      normalizedLeadUid,
      replayed: true,
      routingResultJson: existingReplayEvent.routingResultJson,
    });
  }

  let eventId = existingReplayEvent?.id;
  let rawPayloadForNormalization = input.rawPayload;
  if (existingReplayEvent) {
    const firstRawPayload = asObject(existingReplayEvent.rawPayloadJson) ?? {};
    const replayMerge = mergeReplayPayload(firstRawPayload, input.rawPayload);
    rawPayloadForNormalization = replayMerge.effectiveRaw;

    if (replayMerge.conflictKeys.length > 0) {
      logger.warn("source_intake.leadconduit_facebook.replay_conflict", {
        sourceEventId: existingReplayEvent.id,
        replayBasis: replayIdentity.replayBasis,
        replayKey: replayIdentity.replayKey,
        conflictKeys: replayMerge.conflictKeys,
      });
    }
    if (replayMerge.addedKeys.length > 0) {
      logger.info("source_intake.leadconduit_facebook.replay_enriched", {
        sourceEventId: existingReplayEvent.id,
        replayBasis: replayIdentity.replayBasis,
        replayKey: replayIdentity.replayKey,
        addedKeys: replayMerge.addedKeys,
      });
    }
  }

  if (!eventId) {
    const created = await deps.createSourceLeadEventImpl({
      sourceProvider: LEADCONDUIT_FACEBOOK_PROVIDER,
      sourceSystem: LEADCONDUIT_FACEBOOK_SOURCE_SYSTEM,
      sourceType: "webhook",
      sourceRouteKey,
      sourceCampaignId: fields.campaignId ?? null,
      sourceCampaignName: fields.campaignName ?? null,
      sourceFunnelName: fields.formName ?? null,
      sourceLeadId: fields.sourceLeadId,
      sourceLeadUid,
      webhookRequestLogId: input.webhookRequestLogId ?? null,
      status: "received",
      rawPayloadJson: input.rawPayload as JsonObject,
      receivedAt: now,
    });
    eventId = created.id;
  }

  const normalized = normalizeLeadConduitFacebookToLifecyclePayload(rawPayloadForNormalization, {
    masterClientAccountId: input.masterClientAccountId,
    replayIdentity,
  });
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) {
    await deps.updateSourceLeadEventImpl(eventId, {
      status: "needs_review",
      errorSummary: "Normalized LeadConduit Facebook payload failed lifecycle schema validation.",
      normalizedAt: now,
    });
    return buildResult({
      sourceEventId: eventId,
      status: "needs_review",
      sourceRouteKey,
      sourceLeadId: fields.sourceLeadId,
      normalizedLeadUid: normalized.contact.lead_uid,
      replayed: Boolean(existingReplayEvent),
      routingResultJson: existingReplayEvent?.routingResultJson ?? null,
    });
  }

  await deps.updateSourceLeadEventImpl(eventId, {
    status: "normalized",
    normalizedPayloadJson: parsed.data as JsonObject,
    normalizedAt: now,
  });

  const { routing, status } = await deps.persistRoutingAndDuplicateImpl(
    eventId,
    parsed.data,
    rawPayloadForNormalization,
    LEADCONDUIT_FACEBOOK_PROVIDER,
    LEADCONDUIT_FACEBOOK_SOURCE_SYSTEM,
    sourceRouteKey,
    fields.sourceLeadId,
    false,
    now.toISOString(),
    now
  );

  return {
    ok: true,
    provider: LEADCONDUIT_FACEBOOK_PROVIDER,
    sourceSystem: LEADCONDUIT_FACEBOOK_SOURCE_SYSTEM,
    sourceLane: "leadconduit_facebook",
    sourceEventId: eventId,
    status,
    sourceRouteKey,
    sourceLeadId: fields.sourceLeadId,
    normalizedLeadUid: parsed.data.contact.lead_uid,
    matched: routing.matched,
    matchedRuleId: routing.matchedRuleId,
    destinationClientAccountId: routing.destinationClientAccountId,
    destinationLocationIdGhl: routing.destinationLocationIdGhl,
    routingDryRunDecisionId: routing.routingDryRunDecisionId,
    replayed: Boolean(existingReplayEvent),
    nextAction: "Review and approve delivery in Admin C.O.C.",
  };
}
