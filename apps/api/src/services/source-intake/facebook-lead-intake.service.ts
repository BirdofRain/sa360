import type { SourceLeadEventStatus } from "@prisma/client";
import { lifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import {
  createSourceLeadEvent,
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
};

const REVIEW_NEXT_ACTION = "Review and approve simulation in Admin C.O.C. (source-intake).";

/**
 * Facebook Lead Ads intake: persist raw SourceLeadEvent, normalize into the existing
 * lifecycle schema, then run the shared routing + duplicate + enrichment pipeline.
 * No GHL writes and no live delivery occur here (dry-run only).
 */
export async function processFacebookSourceLead(
  input: FacebookLeadIntakeInput
): Promise<FacebookLeadIntakeResult> {
  const now = new Date();
  const fields = input.fields;
  const leadgenId = fields.leadgenId.trim();
  const routeKey = resolveFacebookRouteKey(fields);

  const event = await createSourceLeadEvent({
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

  const normalized = normalizeFacebookLeadToLifecyclePayload(fields, {
    masterClientAccountId: input.masterClientAccountId,
  });
  const parsed = lifecycleEventSchema.safeParse(normalized);
  if (!parsed.success) {
    await updateSourceLeadEvent(event.id, {
      status: "needs_review",
      errorSummary: "Normalized Facebook lead failed lifecycle schema validation.",
      normalizedAt: now,
    });
    return {
      ok: true,
      provider: "facebook",
      sourceEventId: event.id,
      status: "needs_review",
      sourceRouteKey: routeKey,
      leadgenId,
      normalizedLeadUid: normalized.contact.lead_uid,
      matched: false,
      nextAction: REVIEW_NEXT_ACTION,
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
    input.rawPayloadJson,
    FACEBOOK_LEAD_PROVIDER,
    FACEBOOK_LEAD_SOURCE_SYSTEM,
    routeKey,
    leadgenId,
    false,
    now.toISOString(),
    now
  );

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
  };
}
