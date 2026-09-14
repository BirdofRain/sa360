import type { SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";
import { logger } from "../../lib/logger.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  claimSourceLeadEventByCanonicalIdentity,
  createSourceLeadEvent,
  findSourceLeadEventByCanonicalIdentity,
  findSourceLeadEventById,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";
import {
  FACEBOOK_LEAD_PROVIDER,
  FACEBOOK_LEAD_SOURCE_SYSTEM,
  buildFacebookLeadUid,
  normalizeFacebookLeadToLifecyclePayload,
  resolveFacebookRouteKey,
  type FacebookLeadFields,
} from "./facebook-lead-normalizer.js";

export type FacebookLeadIntakeInput = {
  fields: FacebookLeadFields;
  /** Raw payload stored on the SourceLeadEvent (Graph response or test body; token-free). */
  rawPayloadJson: Record<string, unknown>;
  /** Routing input master account id (env-driven; never hardcoded in service logic). */
  masterClientAccountId: string;
  /** `lead_form` for live webhook leads, `webhook` for the synthetic test-lead endpoint. */
  sourceType?: "lead_form" | "webhook";
  webhookRequestLogId?: string;
  /** Reuse a received placeholder claimed by the webhook handler before Graph fetch. */
  existingEventId?: string;
  /** When false, normalize but skip routing dry-run. Defaults true for direct service callers. */
  routingEnabled?: boolean;
};

export type FacebookLeadIntakeResult = {
  ok: true;
  provider: "facebook";
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  leadgenId: string;
  normalizedLeadUid: string;
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  routingDryRunDecisionId?: string;
  nextAction: string;
  replayed: boolean;
};

const REVIEW_NEXT_ACTION = "Review and approve simulation in Admin C.O.C. (source-intake).";

const FACEBOOK_LEAD_PROCESSED_STATUSES: ReadonlySet<SourceLeadEventStatus> = new Set([
  "normalized",
  "routing_matched",
  "routing_unmatched",
  "duplicate_blocked",
  "needs_review",
  "approved",
  "delivered",
  "delivery_failed",
  "rejected",
]);

export type FacebookLeadReplayRow = Pick<
  SourceLeadEvent,
  | "id"
  | "status"
  | "sourceRouteKey"
  | "sourceLeadId"
  | "sourceLeadUid"
  | "normalizedAt"
  | "routingDryRunDecisionId"
  | "routingRuleIdResolved"
  | "clientAccountIdResolved"
  | "destinationLocationIdResolved"
  | "errorSummary"
>;

/**
 * True when this SourceLeadEvent already went through canonical normalize/routing.
 * `received` rows (intake disabled, Graph failure, in-flight claim) are not processed.
 */
export function isFacebookLeadCanonicalProcessed(
  event: Pick<FacebookLeadReplayRow, "status" | "normalizedAt">
): boolean {
  if (event.normalizedAt) return true;
  return FACEBOOK_LEAD_PROCESSED_STATUSES.has(event.status);
}

export async function findFacebookLeadReplayEvent(
  leadgenId: string
): Promise<FacebookLeadReplayRow | null> {
  const trimmed = leadgenId.trim();
  if (!trimmed) return null;
  return findSourceLeadEventByCanonicalIdentity(
    FACEBOOK_LEAD_PROVIDER,
    FACEBOOK_LEAD_SOURCE_SYSTEM,
    trimmed
  );
}

function presentReplay(
  event: FacebookLeadReplayRow,
  leadgenId: string,
  routeKey: string
): FacebookLeadIntakeResult {
  return {
    ok: true,
    provider: "facebook",
    sourceEventId: event.id,
    status: event.status,
    sourceRouteKey: event.sourceRouteKey ?? routeKey,
    leadgenId: event.sourceLeadId ?? leadgenId,
    normalizedLeadUid: event.sourceLeadUid ?? buildFacebookLeadUid(leadgenId),
    matched: Boolean(event.routingRuleIdResolved && event.clientAccountIdResolved),
    matchedRuleId: event.routingRuleIdResolved ?? undefined,
    destinationClientAccountId: event.clientAccountIdResolved ?? undefined,
    destinationLocationIdGhl: event.destinationLocationIdResolved ?? undefined,
    routingDryRunDecisionId: event.routingDryRunDecisionId ?? undefined,
    nextAction: "Idempotent replay — existing SourceLeadEvent returned.",
    replayed: true,
  };
}

function resultFromNeedsReview(
  eventId: string,
  routeKey: string,
  leadgenId: string,
  normalizedLeadUid: string
): FacebookLeadIntakeResult {
  return {
    ok: true,
    provider: "facebook",
    sourceEventId: eventId,
    status: "needs_review",
    sourceRouteKey: routeKey,
    leadgenId,
    normalizedLeadUid,
    matched: false,
    nextAction: REVIEW_NEXT_ACTION,
    replayed: false,
  };
}

/**
 * Facebook Lead Ads intake: persist raw SourceLeadEvent, normalize into the existing
 * lifecycle schema, then run the shared routing + duplicate + enrichment pipeline.
 * No GHL writes, no live delivery, and no LeadInventoryItem rows occur here (dry-run only).
 * Direct Meta Lead Ads are client-committed campaign leads, not general PPL supply.
 *
 * Replay: the same (facebook, meta_lead_ads, leadgen_id) identity returns the existing
 * canonical event without a second create / routing dry-run. Application-level only —
 * there is no unique index in this PR. Concurrent first-delivery requests are serialized
 * around find-or-create with a Postgres advisory lock; a remaining race exists if two
 * in-flight processors both pass the processed-state check before either writes
 * `normalizedAt`. A later unique index would close that gap.
 */
export async function processFacebookSourceLead(
  input: FacebookLeadIntakeInput
): Promise<FacebookLeadIntakeResult> {
  const now = new Date();
  const fields = input.fields;
  const leadgenId = fields.leadgenId.trim();
  const routeKey = resolveFacebookRouteKey(fields);
  const routingEnabled = input.routingEnabled !== false;

  let event: FacebookLeadReplayRow | null = null;

  if (input.existingEventId) {
    event = await findSourceLeadEventById(input.existingEventId);
  }

  if (!event) {
    const existing = await findFacebookLeadReplayEvent(leadgenId);
    if (existing && isFacebookLeadCanonicalProcessed(existing)) {
      logger.info("facebook_intake.replay", {
        leadgenId,
        sourceEventId: existing.id,
        status: existing.status,
      });
      return presentReplay(existing, leadgenId, routeKey);
    }
    if (existing) {
      event = existing;
    }
  } else if (isFacebookLeadCanonicalProcessed(event)) {
    logger.info("facebook_intake.replay", {
      leadgenId,
      sourceEventId: event.id,
      status: event.status,
    });
    return presentReplay(event, leadgenId, routeKey);
  }

  if (!event) {
    try {
      const claimed = await claimSourceLeadEventByCanonicalIdentity({
        sourceProvider: FACEBOOK_LEAD_PROVIDER,
        sourceSystem: FACEBOOK_LEAD_SOURCE_SYSTEM,
        sourceType: input.sourceType ?? "lead_form",
        sourceRouteKey: routeKey,
        sourceCampaignId: fields.campaignId?.trim() || null,
        sourceCampaignName: fields.campaignName?.trim() || null,
        sourceFunnelName: fields.formName?.trim() || null,
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        webhookRequestLogId: input.webhookRequestLogId ?? null,
        status: "received",
        rawPayloadJson: input.rawPayloadJson as object,
        receivedAt: now,
      });
      event = claimed.event;
      if (!claimed.created && isFacebookLeadCanonicalProcessed(claimed.event)) {
        logger.info("facebook_intake.replay", {
          leadgenId,
          sourceEventId: event.id,
          status: event.status,
        });
        return presentReplay(event, leadgenId, routeKey);
      }
    } catch (err) {
      logger.error("facebook_intake.claim_failed", {
        leadgenId,
        error: err instanceof Error ? err.message : String(err),
      });
      const created = await createSourceLeadEvent({
        sourceProvider: FACEBOOK_LEAD_PROVIDER,
        sourceSystem: FACEBOOK_LEAD_SOURCE_SYSTEM,
        sourceType: input.sourceType ?? "lead_form",
        sourceRouteKey: routeKey,
        sourceCampaignId: fields.campaignId?.trim() || null,
        sourceCampaignName: fields.campaignName?.trim() || null,
        sourceFunnelName: fields.formName?.trim() || null,
        sourceLeadId: leadgenId,
        sourceLeadUid: buildFacebookLeadUid(leadgenId),
        webhookRequestLogId: input.webhookRequestLogId ?? null,
        status: "received",
        rawPayloadJson: input.rawPayloadJson as object,
        receivedAt: now,
      });
      event = created;
    }
  }

  const latest = await findSourceLeadEventById(event.id);
  if (latest && isFacebookLeadCanonicalProcessed(latest) && latest.id === event.id) {
    logger.info("facebook_intake.replay", {
      leadgenId,
      sourceEventId: latest.id,
      status: latest.status,
    });
    return presentReplay(latest, leadgenId, routeKey);
  }

  const normalized = normalizeFacebookLeadToLifecyclePayload(fields, {
    masterClientAccountId: input.masterClientAccountId,
  });
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) {
    await updateSourceLeadEvent(event.id, {
      status: "needs_review",
      errorSummary: "Normalized Facebook lead failed lifecycle schema validation.",
      normalizedAt: now,
      rawPayloadJson: input.rawPayloadJson as object,
    });
    return resultFromNeedsReview(event.id, routeKey, leadgenId, normalized.contact.lead_uid);
  }

  await updateSourceLeadEvent(event.id, {
    status: "normalized",
    normalizedPayloadJson: parsed.data as object,
    normalizedAt: now,
    rawPayloadJson: input.rawPayloadJson as object,
    sourceRouteKey: routeKey,
    sourceCampaignId: fields.campaignId?.trim() || null,
    sourceCampaignName: fields.campaignName?.trim() || null,
    sourceFunnelName: fields.formName?.trim() || null,
    errorSummary: null,
  });

  if (!routingEnabled) {
    return {
      ok: true,
      provider: "facebook",
      sourceEventId: event.id,
      status: "normalized",
      sourceRouteKey: routeKey,
      leadgenId,
      normalizedLeadUid: parsed.data.contact.lead_uid,
      matched: false,
      nextAction: REVIEW_NEXT_ACTION,
      replayed: false,
    };
  }

  const { routing, status } = await persistRoutingAndDuplicate(
    event.id,
    parsed.data,
    input.rawPayloadJson,
    FACEBOOK_LEAD_PROVIDER,
    FACEBOOK_LEAD_SOURCE_SYSTEM,
    routeKey,
    leadgenId,
    false,
    now.toISOString(),
    now
  );

  // Direct Meta Lead Ads are client-committed campaign leads.
  // They are not general PPL supply and must not be inserted into LeadInventoryItem during Phase 1.
  // Do not call campaign inventory tracking here — Meta intake creates zero inventory rows.

  return {
    ok: true,
    provider: "facebook",
    sourceEventId: event.id,
    status,
    sourceRouteKey: routeKey,
    leadgenId,
    normalizedLeadUid: parsed.data.contact.lead_uid,
    matched: routing.matched,
    matchedRuleId: routing.matchedRuleId,
    destinationClientAccountId: routing.destinationClientAccountId,
    destinationLocationIdGhl: routing.destinationLocationIdGhl,
    routingDryRunDecisionId: routing.routingDryRunDecisionId,
    nextAction: REVIEW_NEXT_ACTION,
    replayed: false,
  };
}
