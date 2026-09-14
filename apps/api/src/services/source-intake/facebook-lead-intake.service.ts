import type { SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";
import { logger } from "../../lib/logger.js";
import { extractRoutingAttributionFromPayload } from "../../lib/routing-attribution-extract.js";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { listActiveCampaignRoutingRules } from "../../repositories/campaign-routing-rule.repository.js";
import {
  claimSourceLeadEventByCanonicalIdentity,
  findSourceLeadEventByCanonicalIdentity,
  findSourceLeadEventById,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import { findAmbiguousRoutingTie } from "../routing-matcher.service.js";
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
  /** Test seams. Production callers omit this. */
  deps?: FacebookLeadIntakeProcessDeps;
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
  | "routedAt"
  | "routingDryRunDecisionId"
  | "routingRuleIdResolved"
  | "clientAccountIdResolved"
  | "destinationLocationIdResolved"
  | "errorSummary"
>;

const FACEBOOK_LEAD_ROUTING_TERMINAL_STATUSES: ReadonlySet<SourceLeadEventStatus> = new Set([
  "routing_matched",
  "routing_unmatched",
  "duplicate_blocked",
  "needs_review",
  "approved",
  "delivered",
  "delivery_failed",
  "rejected",
]);

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

export function isFacebookLeadRoutingComplete(
  event: Pick<FacebookLeadReplayRow, "status" | "routingDryRunDecisionId"> & {
    routedAt?: Date | null;
  }
): boolean {
  if (event.routedAt) return true;
  if (event.routingDryRunDecisionId) return true;
  return FACEBOOK_LEAD_ROUTING_TERMINAL_STATUSES.has(event.status);
}

/**
 * Fully processed for webhook skip-enqueue / worker idempotent exit.
 * `normalized` without routing is complete only when routing is disabled.
 * `needs_review` after schema validation is terminal even without routedAt.
 */
export function isFacebookLeadFullyProcessed(
  event: Pick<FacebookLeadReplayRow, "status" | "normalizedAt" | "routingDryRunDecisionId"> & {
    routedAt?: Date | null;
  },
  routingEnabled: boolean
): boolean {
  if (event.status === "needs_review") return true;
  if (
    FACEBOOK_LEAD_ROUTING_TERMINAL_STATUSES.has(event.status) &&
    event.status !== "needs_review"
  ) {
    return true;
  }
  if (!event.normalizedAt && event.status !== "normalized") return false;
  if (!routingEnabled) return true;
  return isFacebookLeadRoutingComplete(event);
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

export type FacebookLeadIntakeProcessDeps = {
  claimCanonicalIdentityImpl?: typeof claimSourceLeadEventByCanonicalIdentity;
  findReplayImpl?: typeof findFacebookLeadReplayEvent;
  findByIdImpl?: typeof findSourceLeadEventById;
};

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
 * around find-or-create with a Postgres advisory lock. A claim/lock/transaction failure
 * must never fall back to an unguarded create — recover the existing row or fail so
 * Meta can retry. Graph fetch + normalize + shadow routing run on the meta-leadgen-fetch
 * worker under the same advisory lock so overlapping callbacks cannot duplicate Graph
 * or RoutingDryRunDecision on the successful path.
 */
export async function processFacebookSourceLead(
  input: FacebookLeadIntakeInput
): Promise<FacebookLeadIntakeResult> {
  const now = new Date();
  const fields = input.fields;
  const leadgenId = fields.leadgenId.trim();
  const routeKey = resolveFacebookRouteKey(fields);
  const routingEnabled = input.routingEnabled !== false;
  const claimCanonical =
    input.deps?.claimCanonicalIdentityImpl ?? claimSourceLeadEventByCanonicalIdentity;
  const findReplay = input.deps?.findReplayImpl ?? findFacebookLeadReplayEvent;
  const findById = input.deps?.findByIdImpl ?? findSourceLeadEventById;

  let event: FacebookLeadReplayRow | null = null;
  let resumeRoutingOnly = false;

  if (input.existingEventId) {
    event = await findById(input.existingEventId);
  }

  if (!event) {
    const existing = await findReplay(leadgenId);
    if (existing && isFacebookLeadFullyProcessed(existing, routingEnabled)) {
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
  } else if (isFacebookLeadFullyProcessed(event, routingEnabled)) {
    logger.info("facebook_intake.replay", {
      leadgenId,
      sourceEventId: event.id,
      status: event.status,
    });
    return presentReplay(event, leadgenId, routeKey);
  }

  if (!event) {
    try {
      const claimed = await claimCanonical({
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
      if (!claimed.created && isFacebookLeadFullyProcessed(claimed.event, routingEnabled)) {
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
      // Fail-safe: never create another canonical row. Recover the existing identity
      // if the claim actually committed, otherwise rethrow so Meta retries.
      const recovered = await findReplay(leadgenId);
      if (!recovered) {
        throw err;
      }
      event = recovered;
      if (isFacebookLeadFullyProcessed(recovered, routingEnabled)) {
        logger.info("facebook_intake.replay", {
          leadgenId,
          sourceEventId: recovered.id,
          status: recovered.status,
        });
        return presentReplay(recovered, leadgenId, routeKey);
      }
    }
  }

  if (!event) {
    throw new Error("facebook_intake.claim_failed: canonical event missing after fail-safe recovery");
  }

  const latest = await findById(event.id);
  if (latest && isFacebookLeadFullyProcessed(latest, routingEnabled) && latest.id === event.id) {
    logger.info("facebook_intake.replay", {
      leadgenId,
      sourceEventId: latest.id,
      status: latest.status,
    });
    return presentReplay(latest, leadgenId, routeKey);
  }

  if (
    latest &&
    routingEnabled &&
    latest.status === "normalized" &&
    latest.normalizedAt &&
    !isFacebookLeadRoutingComplete(latest)
  ) {
    resumeRoutingOnly = true;
    event = latest;
  }

  const normalized = normalizeFacebookLeadToLifecyclePayload(fields, {
    masterClientAccountId: input.masterClientAccountId,
  });
  const parsed = lifecycleEventSchema.safeParse(
    resumeRoutingOnly && latest?.normalizedPayloadJson
      ? latest.normalizedPayloadJson
      : normalized
  );
  if (!parsed.success) {
    await updateSourceLeadEvent(event.id, {
      status: "needs_review",
      errorSummary: "Normalized Facebook lead failed lifecycle schema validation.",
      normalizedAt: now,
      rawPayloadJson: input.rawPayloadJson as object,
    });
    return resultFromNeedsReview(event.id, routeKey, leadgenId, normalized.contact.lead_uid);
  }

  if (!resumeRoutingOnly) {
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
  }

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

  const rules = await listActiveCampaignRoutingRules(input.masterClientAccountId);
  const attribution = extractRoutingAttributionFromPayload(parsed.data);
  const ambiguous = findAmbiguousRoutingTie(rules, attribution, now);
  if (ambiguous) {
    await updateSourceLeadEvent(event.id, {
      status: "needs_review",
      routedAt: now,
      routingResultJson: {
        matched: false,
        reason: "Ambiguous routing match; manual review required",
        matchType: ambiguous.tier,
        candidateRuleIds: ambiguous.ruleIds,
      } as object,
      errorSummary: "Ambiguous routing match; manual review required.",
    });
    logger.info("facebook_intake.routing_ambiguous", {
      leadgenId,
      sourceEventId: event.id,
      tier: ambiguous.tier,
      candidateRuleIds: ambiguous.ruleIds,
    });
    return {
      ok: true,
      provider: "facebook",
      sourceEventId: event.id,
      status: "needs_review",
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
  // Do not call approveSourceLeadDelivery, enqueue LF2/GHL, or enqueueMetaDispatch.

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
