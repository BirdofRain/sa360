import type { Prisma, SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";

import { isFacebookCaptureIntakeEnabled } from "./facebook-capture-gate.js";
import { isSettledCaptureOnlyFacebookEvent } from "./facebook-capture-provenance.js";
import {
  META_LEAD_ADS_INTAKE_METHOD,
  buildFacebookCaptureEnrichment,
  buildFacebookCaptureNormalizedPayload,
  captureFieldsFromFacebookLeadFields,
} from "./facebook-capture-record.js";
import {
  FACEBOOK_ASSOCIATION_EXPLANATIONS,
  captureNextAction,
  type FacebookFormAssociationOutcome,
} from "./facebook-form-association.js";
import {
  resolveFacebookFormAssociation,
  type FacebookFormAssociationResolution,
} from "./facebook-form-association.service.js";
import { buildFacebookLeadUid, type FacebookLeadFields } from "./facebook-lead-normalizer.js";

/**
 * Meta-first capture settle.
 *
 * Called by the meta-leadgen-fetch worker path after Graph (or a fixture body)
 * hydrated the lead and while routing is disabled. It finishes the canonical
 * Meta row the same way Zapier capture finishes a Zapier row: normalized
 * `sa360.facebook_capture.v1` payload, Page ID + Form ID association against
 * SourceFunnel, and capture-only enrichment. It never reads the master client
 * account, never requires GHL configuration, and never creates routing
 * decisions, inventory, outbox rows, or CAPI dispatch.
 *
 * Must run inside the canonical advisory-lock transaction for the leadgen_id
 * (`withCanonicalSourceLeadLock`) and must only use `tx`.
 */

export type MetaLeadCaptureResult = {
  ok: true;
  intakeMethod: typeof META_LEAD_ADS_INTAKE_METHOD;
  sourceEventId: string;
  status: SourceLeadEventStatus;
  leadgenId: string;
  normalizedLeadUid: string;
  /** `already_settled` when Zapier (or an earlier worker) finished the row first. */
  captureOutcome: "captured" | "already_settled";
  association: FacebookFormAssociationResolution;
  /** Source client decided by Page+Form association. Not a delivery destination. */
  sourceClientAccountId: string | null;
  nextAction: string;
};

export type SettleMetaLeadCaptureInput = {
  event: SourceLeadEvent;
  leadgenId: string;
  fields: FacebookLeadFields;
  /** Raw notification + envelope + token-free Graph body to retain on the row. */
  rawPayloadJson: Record<string, unknown>;
  /** metaLeadgenFetch observability patch written in the same update. */
  fetchMeta: Record<string, unknown>;
  now: Date;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function storedAssociation(event: SourceLeadEvent): FacebookFormAssociationResolution {
  const association = asRecord(asRecord(event.enrichmentMetadataJson)?.association);
  const outcome = association?.outcome;
  if (typeof outcome === "string") {
    return {
      outcome: outcome as FacebookFormAssociationOutcome,
      clientAccountId:
        typeof association?.clientAccountId === "string" ? association.clientAccountId : null,
      sourceFunnelId:
        typeof association?.sourceFunnelId === "string" ? association.sourceFunnelId : null,
      pageId: typeof association?.pageId === "string" ? association.pageId : null,
      formId: typeof association?.formId === "string" ? association.formId : null,
      explanation:
        typeof association?.explanation === "string"
          ? association.explanation
          : FACEBOOK_ASSOCIATION_EXPLANATIONS.not_evaluated,
    };
  }
  return {
    outcome: "not_evaluated",
    clientAccountId: event.clientAccountIdResolved,
    sourceFunnelId: null,
    pageId: null,
    formId: null,
    explanation: FACEBOOK_ASSOCIATION_EXPLANATIONS.not_evaluated,
  };
}

function presentSettled(
  event: SourceLeadEvent,
  leadgenId: string,
  captureOutcome: MetaLeadCaptureResult["captureOutcome"]
): MetaLeadCaptureResult {
  const association = storedAssociation(event);
  return {
    ok: true,
    intakeMethod: META_LEAD_ADS_INTAKE_METHOD,
    sourceEventId: event.id,
    status: event.status,
    leadgenId,
    normalizedLeadUid: event.sourceLeadUid ?? buildFacebookLeadUid(leadgenId),
    captureOutcome,
    association,
    sourceClientAccountId:
      association.outcome === "associated" ? association.clientAccountId : event.clientAccountIdResolved,
    nextAction: captureNextAction(association.outcome),
  };
}

export type SettleMetaLeadCaptureDeps = {
  captureIntakeEnabledImpl?: () => boolean;
  resolveAssociationImpl?: typeof resolveFacebookFormAssociation;
};

export async function settleMetaLeadCapture(
  input: SettleMetaLeadCaptureInput,
  tx: Prisma.TransactionClient,
  deps: SettleMetaLeadCaptureDeps = {}
): Promise<MetaLeadCaptureResult> {
  const { event, leadgenId } = input;
  if (isSettledCaptureOnlyFacebookEvent(event)) {
    return presentSettled(event, leadgenId, "already_settled");
  }

  const captureEnabled = (deps.captureIntakeEnabledImpl ?? isFacebookCaptureIntakeEnabled)();
  const resolveAssociation = deps.resolveAssociationImpl ?? resolveFacebookFormAssociation;
  const fields = captureFieldsFromFacebookLeadFields(input.fields);

  // Association is decided by Page ID + Form ID only. A master client account
  // is not consulted; an existing clientAccountIdResolved (set by an operator or
  // an earlier Zapier supplement) is preserved, never overwritten.
  const association: FacebookFormAssociationResolution = captureEnabled
    ? await resolveAssociation(
        { pageId: fields.pageId, formId: fields.formId, formIdentityStatus: fields.formIdentityStatus },
        tx
      )
    : {
        outcome: "association_disabled",
        clientAccountId: null,
        sourceFunnelId: null,
        pageId: fields.pageId,
        formId: fields.formId,
        explanation: FACEBOOK_ASSOCIATION_EXPLANATIONS.association_disabled,
      };

  const receivedAt = event.receivedAt.toISOString();
  const normalized = buildFacebookCaptureNormalizedPayload({
    fields,
    association,
    receivedAt,
    intakeMethod: META_LEAD_ADS_INTAKE_METHOD,
  });
  const existingEnrichment = asRecord(event.enrichmentMetadataJson) ?? {};
  const prevFetch = asRecord(existingEnrichment.metaLeadgenFetch) ?? {};
  const captureEnrichment = buildFacebookCaptureEnrichment({
    fields,
    association,
    receivedAt,
    intakeMethod: META_LEAD_ADS_INTAKE_METHOD,
    provenance: "meta",
  });
  const enrichment: Prisma.InputJsonObject = {
    ...(existingEnrichment as Prisma.InputJsonObject),
    ...captureEnrichment,
    metaLeadgenFetch: {
      liveDelivery: false,
      capiDispatched: false,
      ...prevFetch,
      ...(input.fetchMeta as Prisma.InputJsonObject),
    },
  };

  const resolvedClient =
    event.clientAccountIdResolved ??
    (association.outcome === "associated" ? association.clientAccountId : null);

  const updated = await tx.sourceLeadEvent.update({
    where: { id: event.id },
    data: {
      status: "normalized",
      rawPayloadJson: input.rawPayloadJson as Prisma.InputJsonValue,
      normalizedPayloadJson: normalized as Prisma.InputJsonValue,
      normalizedAt: event.normalizedAt ?? input.now,
      clientAccountIdResolved: resolvedClient,
      sourceCampaignId: event.sourceCampaignId ?? fields.campaignId,
      sourceCampaignName: event.sourceCampaignName ?? fields.campaignName,
      sourceFunnelName: event.sourceFunnelName ?? fields.formName,
      enrichmentMetadataJson: enrichment,
      // Captured leads are not failures. The association diagnostic is kept in
      // enrichment.association.explanation and surfaced by the presenters; the
      // webhook's "Meta Graph fetch in progress." placeholder is cleared.
      errorSummary: null,
    },
  });
  return presentSettled(updated, leadgenId, "captured");
}
