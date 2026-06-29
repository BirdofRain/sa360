import type { SourceLeadEventStatus } from "@prisma/client";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import type { GoogleSheetLeadPayload } from "../../schemas/google-sheet-lead.schema.js";
import {
  createSourceLeadEvent,
  updateSourceLeadEvent,
} from "../../repositories/source-lead-event.repository.js";
import {
  lifecycleEventExists,
  saveLifecycleEvent,
  upsertLeadAttribution,
} from "../event-service.js";
import { upsertFromLifecyclePayload } from "../inbound-contact-index.service.js";
import { generateLeadDeliveryPlanForDecision } from "../lead-delivery-plan.service.js";
import { logger } from "../../lib/logger.js";
import { persistRoutingAndDuplicate } from "./source-intake-routing-persist.js";
import {
  GOOGLE_SHEET_LEAD_PROVIDER,
  GOOGLE_SHEET_LEAD_SOURCE_SYSTEM,
  buildGoogleSheetLeadUid,
  normalizeGoogleSheetLeadToLifecyclePayload,
  resolveGoogleSheetRouteKey,
} from "./google-sheet-lead-normalizer.js";

export type GoogleSheetLeadIntakeInput = {
  payload: GoogleSheetLeadPayload;
  webhookRequestLogId?: string;
};

/** Shadow when a delivery plan was generated; dry_run when routing matched nothing. */
export type GoogleSheetDeliveryMode = "shadow" | "dry_run" | "none";

export type GoogleSheetLeadIntakeResult = {
  ok: true;
  provider: "google_sheets";
  sourceEventId: string;
  status: SourceLeadEventStatus;
  sourceRouteKey: string;
  normalizedLeadUid: string;
  eventUuid: string;
  lifecycleEventStored: boolean;
  attributionUpserted: boolean;
  contactIndexUpserted: boolean;
  matched: boolean;
  matchedRule: {
    ruleId: string;
    destinationClientAccountId: string | null;
    destinationLocationIdGhl: string | null;
    matchType: string | null;
    reason: string;
  } | null;
  routingDryRunDecisionId: string | null;
  deliveryMode: GoogleSheetDeliveryMode;
  deliveryPlanId: string | null;
  /** True when the payload requested live routing; live delivery is always suppressed here. */
  liveDeliverySuppressed: boolean;
  nextAction: string;
};

const REVIEW_NEXT_ACTION =
  "Review and approve simulation in Admin C.O.C. (Google Sheet cutover rehearsal).";

function requestedRoutingMode(payload: GoogleSheetLeadPayload): string | undefined {
  const routing = (payload.routing ?? {}) as Record<string, unknown>;
  const mode = routing.routing_mode;
  return typeof mode === "string" ? mode.trim().toLowerCase() : undefined;
}

/**
 * Google Sheet cutover-rehearsal intake.
 *
 * Stores the raw envelope, creates the lifecycle ledger record, upserts attribution
 * and the inbound contact index, runs the routing matcher in shadow mode, and (when
 * matched) records a shadow delivery plan. No live GHL writes are ever performed here:
 * even when the payload requests `routing.routing_mode = "live"`, delivery is recorded
 * as a shadow/dry-run plan only. Promotion to live delivery remains an admin/canary flow.
 */
export async function processGoogleSheetSourceLead(
  input: GoogleSheetLeadIntakeInput
): Promise<GoogleSheetLeadIntakeResult> {
  const now = new Date();
  const payload = input.payload;
  const routeKey = resolveGoogleSheetRouteKey(payload);
  const leadUid = buildGoogleSheetLeadUid(payload);
  const liveDeliverySuppressed = requestedRoutingMode(payload) === "live";

  const event = await createSourceLeadEvent({
    sourceProvider: GOOGLE_SHEET_LEAD_PROVIDER,
    sourceSystem: GOOGLE_SHEET_LEAD_SOURCE_SYSTEM,
    sourceType: "api_import",
    sourceRouteKey: routeKey,
    sourceCampaignId: payload.attribution?.campaign_id?.trim() || null,
    sourceCampaignName: payload.attribution?.campaign_name?.trim() || null,
    sourceLeadId: leadUid,
    sourceLeadUid: leadUid,
    webhookRequestLogId: input.webhookRequestLogId ?? null,
    status: "received",
    rawPayloadJson: payload as object,
    receivedAt: now,
  });

  const normalized = normalizeGoogleSheetLeadToLifecyclePayload(payload);
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) {
    await updateSourceLeadEvent(event.id, {
      status: "needs_review",
      errorSummary: "Normalized Google Sheet lead failed lifecycle schema validation.",
      normalizedAt: now,
    });
    return {
      ok: true,
      provider: "google_sheets",
      sourceEventId: event.id,
      status: "needs_review",
      sourceRouteKey: routeKey,
      normalizedLeadUid: normalized.contact.lead_uid,
      eventUuid: normalized.event.event_uuid,
      lifecycleEventStored: false,
      attributionUpserted: false,
      contactIndexUpserted: false,
      matched: false,
      matchedRule: null,
      routingDryRunDecisionId: null,
      deliveryMode: "none",
      deliveryPlanId: null,
      liveDeliverySuppressed,
      nextAction: REVIEW_NEXT_ACTION,
    };
  }

  const lifecyclePayload = parsed.data;
  const eventUuid = lifecyclePayload.event.event_uuid;

  await updateSourceLeadEvent(event.id, {
    status: "normalized",
    normalizedPayloadJson: lifecyclePayload as object,
    normalizedAt: now,
  });

  // Lifecycle ledger record (idempotent on event_uuid for retried sheet rows).
  let lifecycleEventStored = false;
  try {
    if (!(await lifecycleEventExists(eventUuid))) {
      await saveLifecycleEvent(lifecyclePayload);
      lifecycleEventStored = true;
    }
  } catch (err) {
    logger.warn("source_intake.google_sheet.lifecycle_event_failed", {
      eventUuid,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let attributionUpserted = false;
  try {
    await upsertLeadAttribution(lifecyclePayload);
    attributionUpserted = true;
  } catch (err) {
    logger.warn("source_intake.google_sheet.attribution_upsert_failed", {
      eventUuid,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Upsert / search the inbound contact index when a phone (or email) identity exists.
  const hasContactableIdentity = Boolean(
    lifecyclePayload.contact.phone_e164 ||
      lifecyclePayload.contact.phone ||
      lifecyclePayload.contact.email
  );
  let contactIndexUpserted = false;
  if (hasContactableIdentity) {
    try {
      contactIndexUpserted = await upsertFromLifecyclePayload(lifecyclePayload, {
        eventUuid,
      });
    } catch (err) {
      logger.warn("source_intake.google_sheet.contact_index_failed", {
        eventUuid,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Shared routing dry-run (shadow) + duplicate-risk + enrichment persistence.
  const { routing, status } = await persistRoutingAndDuplicate(
    event.id,
    lifecyclePayload,
    payload as Record<string, unknown>,
    GOOGLE_SHEET_LEAD_PROVIDER,
    GOOGLE_SHEET_LEAD_SOURCE_SYSTEM,
    routeKey,
    leadUid,
    false,
    now.toISOString(),
    now
  );

  let deliveryMode: GoogleSheetDeliveryMode = "dry_run";
  let deliveryPlanId: string | null = null;
  let matchedRule: GoogleSheetLeadIntakeResult["matchedRule"] = null;

  if (routing.matched && routing.routingDryRunDecisionId) {
    matchedRule = {
      ruleId: routing.matchedRuleId ?? "",
      destinationClientAccountId: routing.destinationClientAccountId ?? null,
      destinationLocationIdGhl: routing.destinationLocationIdGhl ?? null,
      matchType: routing.matchType ?? null,
      reason: routing.reason,
    };

    try {
      const planResult = await generateLeadDeliveryPlanForDecision(
        routing.routingDryRunDecisionId,
        {
          leadIdentity: {
            contactIdGhl: lifecyclePayload.contact.contact_id_ghl ?? null,
            firstName: lifecyclePayload.contact.first_name ?? null,
            lastName: lifecyclePayload.contact.last_name ?? null,
            displayName:
              [lifecyclePayload.contact.first_name, lifecyclePayload.contact.last_name]
                .filter(Boolean)
                .join(" ")
                .trim() || null,
            phoneE164: lifecyclePayload.contact.phone_e164 ?? null,
            email: lifecyclePayload.contact.email ?? null,
          },
        }
      );
      if ("plan" in planResult) {
        deliveryPlanId = planResult.plan.id;
        deliveryMode = "shadow";
      }
    } catch (err) {
      logger.warn("source_intake.google_sheet.delivery_plan_failed", {
        eventUuid,
        routingDryRunDecisionId: routing.routingDryRunDecisionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (liveDeliverySuppressed) {
    logger.warn("source_intake.google_sheet.live_delivery_suppressed", {
      eventUuid,
      routeKey,
      note: "routing.routing_mode=live requested; cutover rehearsal records shadow plan only.",
    });
  }

  return {
    ok: true,
    provider: "google_sheets",
    sourceEventId: event.id,
    status,
    sourceRouteKey: routeKey,
    normalizedLeadUid: lifecyclePayload.contact.lead_uid,
    eventUuid,
    lifecycleEventStored,
    attributionUpserted,
    contactIndexUpserted,
    matched: routing.matched,
    matchedRule,
    routingDryRunDecisionId: routing.routingDryRunDecisionId ?? null,
    deliveryMode,
    deliveryPlanId,
    liveDeliverySuppressed,
    nextAction: REVIEW_NEXT_ACTION,
  };
}
