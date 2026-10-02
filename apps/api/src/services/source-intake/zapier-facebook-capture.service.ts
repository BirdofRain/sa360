import type { Prisma, SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";

import {
  findSourceLeadEventByCanonicalIdentity,
  withCanonicalSourceLeadLock,
} from "../../repositories/source-lead-event.repository.js";
import {
  FACEBOOK_LEAD_PROVIDER,
  FACEBOOK_LEAD_SOURCE_SYSTEM,
  buildFacebookLeadUid,
} from "./facebook-lead-normalizer.js";
import {
  FACEBOOK_ASSOCIATION_EXPLANATIONS,
  captureNextAction,
  type FacebookFormAssociationOutcome,
} from "./facebook-form-association.js";
import {
  resolveFacebookFormAssociation,
  type FacebookFormAssociationResolution,
} from "./facebook-form-association.service.js";
import { ZAPIER_FACEBOOK_INTAKE_METHOD, isSettledCaptureOnlyFacebookEvent } from "./facebook-capture-provenance.js";
import {
  FACEBOOK_CAPTURE_INVENTORY_NOT_TRACKED,
  buildFacebookCaptureEnrichment,
  buildFacebookCaptureNormalizedPayload,
} from "./facebook-capture-record.js";
import { assertFacebookCaptureIntakeEnabled } from "./facebook-capture-gate.js";
import {
  parseZapierFacebookCapturePayload,
  type ZapierFacebookCaptureFields,
} from "./zapier-facebook-capture-payload.js";

export class ZapierFacebookCaptureError extends Error {
  constructor(
    readonly code: "invalid_payload" | "unsafe_facebook_id",
    message: string
  ) {
    super(message);
    this.name = "ZapierFacebookCaptureError";
  }
}

export type FacebookHistoricalDeliveryOutcome =
  | "delivered"
  | "delivery_failed"
  | "approved"
  | "not_recorded";

export type FacebookSaleEligibility = false | "not_evaluated";

export type ZapierFacebookCaptureResult = {
  ok: true;
  provider: "facebook";
  /** Intake method of this HTTP request. Not the event's original provenance. */
  intakeMethod: "zapier_facebook";
  sourceEventId: string;
  replayed: boolean;
  /** True when this request filled contact data onto an existing incomplete Meta row. */
  supplementedExistingEvent: boolean;
  submittedAt: string | null;
  receivedAt: string;
  provenance: {
    thisRequest: "zapier_facebook";
    originalIntakeMethod: string | null;
    originalSourceSystem: string;
  };
  capture: {
    outcome: "captured";
    status: SourceLeadEventStatus;
    leadgenId: string;
    pageId: string | null;
    formId: string | null;
    normalizedLeadUid: string;
  };
  association: FacebookFormAssociationResolution;
  inventory: {
    tracked: boolean;
    mutated: false;
    saleEligible: FacebookSaleEligibility;
    reason: string;
  };
  delivery: {
    thisRequestAttempted: false;
    thisRequestReason: "capture_only_intake_does_not_deliver";
    historicalOutcome: FacebookHistoricalDeliveryOutcome;
    historicalDeliveredAt: string | null;
  };
  nextAction: string;
};

const INVENTORY_NOT_TRACKED = FACEBOOK_CAPTURE_INVENTORY_NOT_TRACKED;
const INVENTORY_EXISTING_UNCHANGED = "existing_inventory_item_not_modified";

function buildNormalizedPayload(
  fields: ZapierFacebookCaptureFields,
  association: FacebookFormAssociationResolution,
  receivedAt: string
): Record<string, unknown> {
  return buildFacebookCaptureNormalizedPayload({
    fields,
    association,
    receivedAt,
    intakeMethod: ZAPIER_FACEBOOK_INTAKE_METHOD,
  });
}

function buildEnrichment(input: {
  fields: ZapierFacebookCaptureFields;
  association: FacebookFormAssociationResolution;
  receivedAt: string;
  audit?: unknown[];
}): Prisma.InputJsonObject {
  return buildFacebookCaptureEnrichment({
    ...input,
    intakeMethod: ZAPIER_FACEBOOK_INTAKE_METHOD,
    provenance: "zapier",
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function storedAssociation(event: SourceLeadEvent): FacebookFormAssociationResolution {
  const association = asRecord(asRecord(event.enrichmentMetadataJson)?.association);
  const outcome = association?.outcome;
  if (isSettledCaptureOnlyFacebookEvent(event) && typeof outcome === "string") {
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

function storedSubmittedAt(event: SourceLeadEvent): string | null {
  const enrichment = asRecord(event.enrichmentMetadataJson);
  if (typeof enrichment?.submittedAt === "string") return enrichment.submittedAt;
  const normalized = asRecord(event.normalizedPayloadJson);
  const source = asRecord(normalized?.source);
  return typeof source?.submitted_at === "string" ? source.submitted_at : null;
}

function historicalDelivery(event: SourceLeadEvent): ZapierFacebookCaptureResult["delivery"] {
  let historicalOutcome: FacebookHistoricalDeliveryOutcome = "not_recorded";
  if (event.deliveredAt || event.status === "delivered") historicalOutcome = "delivered";
  else if (event.status === "delivery_failed") historicalOutcome = "delivery_failed";
  else if (event.approvedAt || event.status === "approved") historicalOutcome = "approved";
  return {
    thisRequestAttempted: false,
    thisRequestReason: "capture_only_intake_does_not_deliver",
    historicalOutcome,
    historicalDeliveredAt: event.deliveredAt ? event.deliveredAt.toISOString() : null,
  };
}

function originalIntakeMethod(event: SourceLeadEvent): string | null {
  const enrichment = asRecord(event.enrichmentMetadataJson);
  if (typeof enrichment?.originalIntakeMethod === "string") return enrichment.originalIntakeMethod;
  if (typeof enrichment?.intakeMethod === "string") return enrichment.intakeMethod;
  if (event.sourceSystem === FACEBOOK_LEAD_SOURCE_SYSTEM && !isSettledCaptureOnlyFacebookEvent(event)) {
    return "meta_lead_ads";
  }
  return null;
}

async function inventorySnapshot(
  sourceEventId: string,
  db: Prisma.TransactionClient
): Promise<ZapierFacebookCaptureResult["inventory"]> {
  const item = await db.leadInventoryItem.findUnique({
    where: { sourceLeadEventId: sourceEventId },
    select: { id: true },
  });
  if (item) {
    return {
      tracked: true,
      mutated: false,
      saleEligible: "not_evaluated",
      reason: INVENTORY_EXISTING_UNCHANGED,
    };
  }
  return { tracked: false, saleEligible: false, mutated: false, reason: INVENTORY_NOT_TRACKED };
}

async function presentEvent(
  event: SourceLeadEvent,
  replayed: boolean,
  supplementedExistingEvent: boolean,
  db: Prisma.TransactionClient
): Promise<ZapierFacebookCaptureResult> {
  const association = storedAssociation(event);
  return {
    ok: true,
    provider: "facebook",
    intakeMethod: ZAPIER_FACEBOOK_INTAKE_METHOD,
    sourceEventId: event.id,
    replayed,
    supplementedExistingEvent,
    submittedAt: storedSubmittedAt(event),
    receivedAt: event.receivedAt.toISOString(),
    provenance: {
      thisRequest: ZAPIER_FACEBOOK_INTAKE_METHOD,
      originalIntakeMethod: originalIntakeMethod(event),
      originalSourceSystem: event.sourceSystem,
    },
    capture: {
      outcome: "captured",
      status: event.status,
      leadgenId: event.sourceLeadId ?? "",
      pageId: association.pageId,
      formId: association.formId,
      normalizedLeadUid: event.sourceLeadUid ?? buildFacebookLeadUid(event.sourceLeadId ?? ""),
    },
    association,
    inventory: await inventorySnapshot(event.id, db),
    delivery: historicalDelivery(event),
    nextAction: captureNextAction(association.outcome),
  };
}

const FINALIZED_META_STATUSES: ReadonlySet<SourceLeadEventStatus> = new Set([
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
 * A raw Meta row can accept Zapier contact data when Graph has not hydrated it
 * and nothing has routed, approved, delivered, or inventoried it.
 */
export async function isIncompleteMetaRawEvent(
  event: SourceLeadEvent,
  db: Prisma.TransactionClient
): Promise<boolean> {
  if (event.sourceProvider !== FACEBOOK_LEAD_PROVIDER) return false;
  if (event.sourceSystem !== FACEBOOK_LEAD_SOURCE_SYSTEM) return false;
  if (event.status !== "received") return false;
  if (isSettledCaptureOnlyFacebookEvent(event)) return false;
  if (FINALIZED_META_STATUSES.has(event.status)) return false;
  if (event.normalizedAt || event.routedAt || event.approvedAt || event.deliveredAt) return false;
  if (event.routingDryRunDecisionId) return false;
  const [inventory, fulfillment, allocation] = await Promise.all([
    db.leadInventoryItem.findUnique({ where: { sourceLeadEventId: event.id }, select: { id: true } }),
    db.fulfillmentOutbox.findFirst({ where: { sourceLeadEventId: event.id }, select: { id: true } }),
    db.leadAllocation.findFirst({ where: { sourceLeadEventId: event.id }, select: { id: true } }),
  ]);
  return !inventory && !fulfillment && !allocation;
}

async function supplementIncompleteMetaEvent(
  event: SourceLeadEvent,
  fields: ZapierFacebookCaptureFields,
  rawPayload: Record<string, unknown>,
  db: Prisma.TransactionClient
): Promise<ZapierFacebookCaptureResult> {
  const preservedSubmittedAt = storedSubmittedAt(event) ?? fields.submittedAt;
  const fieldsForNormalize = { ...fields, submittedAt: preservedSubmittedAt };
  const association = event.clientAccountIdResolved
    ? {
        outcome: "not_evaluated" as const,
        clientAccountId: event.clientAccountIdResolved,
        sourceFunnelId: null,
        pageId: fields.pageId,
        formId: fields.formId,
        explanation: FACEBOOK_ASSOCIATION_EXPLANATIONS.not_evaluated,
      }
    : await resolveFacebookFormAssociation(
        {
          pageId: fields.pageId,
          formId: fields.formId,
          formIdentityStatus: fields.formIdentityStatus,
        },
        db
      );
  const existingEnrichment = asRecord(event.enrichmentMetadataJson) ?? {};
  const normalized = buildNormalizedPayload(fieldsForNormalize, association, event.receivedAt.toISOString());
  const enrichment: Prisma.InputJsonObject = {
    ...(existingEnrichment as Prisma.InputJsonObject),
    captureOnly: true,
    captureSettled: true,
    intakeStage: "capture_only",
    originalIntakeMethod:
      typeof existingEnrichment.intakeMethod === "string"
        ? existingEnrichment.intakeMethod
        : "meta_lead_ads",
    supplementedByIntakeMethod: ZAPIER_FACEBOOK_INTAKE_METHOD,
    submittedAt: preservedSubmittedAt,
    receivedAt: event.receivedAt.toISOString(),
    zapierSupplement: {
      at: new Date().toISOString(),
      pageId: fields.pageId,
      formId: fields.formId,
      rawPayload: rawPayload as Prisma.InputJsonValue,
    },
    association: {
      outcome: association.outcome,
      clientAccountId: association.outcome === "associated" ? association.clientAccountId : event.clientAccountIdResolved,
      sourceFunnelId: association.sourceFunnelId,
      pageId: association.pageId,
      formId: association.formId,
      explanation: association.explanation,
    },
    inventory: {
      thisRequestTracked: false,
      historicalTracked: false,
      saleEligible: false,
      mutated: false,
      reason: INVENTORY_NOT_TRACKED,
    },
    delivery: {
      thisRequestAttempted: false,
      historicalOutcome: "not_recorded",
    },
  };
  const updated = await db.sourceLeadEvent.update({
    where: { id: event.id },
    data: {
      status: "normalized",
      normalizedPayloadJson: normalized as Prisma.InputJsonValue,
      normalizedAt: event.normalizedAt ?? new Date(),
      clientAccountIdResolved:
        event.clientAccountIdResolved ??
        (association.outcome === "associated" ? association.clientAccountId : null),
      sourceCampaignId: event.sourceCampaignId ?? fields.campaignId,
      sourceCampaignName: event.sourceCampaignName ?? fields.campaignName,
      sourceFunnelName: event.sourceFunnelName ?? fields.formName,
      enrichmentMetadataJson: enrichment,
    },
  });
  return presentEvent(updated, false, true, db);
}

/**
 * Capture-only Zapier Facebook intake.
 *
 * Does not read a master client account, GHL destination, or routing rules.
 * Does not create inventory, routing decisions, or delivery jobs.
 * An incomplete Meta raw row for the same leadgen_id is completed in place.
 * Finalized Meta rows are returned unchanged.
 */
export async function processZapierFacebookCapture(input: {
  rawPayload: Record<string, unknown>;
  webhookRequestLogId?: string;
}): Promise<ZapierFacebookCaptureResult> {
  assertFacebookCaptureIntakeEnabled();
  const parsed = parseZapierFacebookCapturePayload(input.rawPayload);
  if (!parsed.ok) {
    throw new ZapierFacebookCaptureError(parsed.error, parsed.message);
  }
  const fields = parsed.fields;
  const now = new Date();

  return withCanonicalSourceLeadLock(
    FACEBOOK_LEAD_PROVIDER,
    FACEBOOK_LEAD_SOURCE_SYSTEM,
    fields.leadgenId,
    async (tx) => {
      const existing = await findSourceLeadEventByCanonicalIdentity(
        FACEBOOK_LEAD_PROVIDER,
        FACEBOOK_LEAD_SOURCE_SYSTEM,
        fields.leadgenId,
        tx
      );
      if (existing) {
        if (await isIncompleteMetaRawEvent(existing, tx)) {
          return supplementIncompleteMetaEvent(existing, fields, input.rawPayload, tx);
        }
        return presentEvent(existing, true, false, tx);
      }

      const association = await resolveFacebookFormAssociation(
        {
          pageId: fields.pageId,
          formId: fields.formId,
          formIdentityStatus: fields.formIdentityStatus,
        },
        tx
      );
      const receivedAt = now;
      const normalized = buildNormalizedPayload(fields, association, receivedAt.toISOString());
      const enrichment = buildEnrichment({
        fields,
        association,
        receivedAt: receivedAt.toISOString(),
      });
      const event = await tx.sourceLeadEvent.create({
        data: {
          sourceProvider: FACEBOOK_LEAD_PROVIDER,
          sourceSystem: FACEBOOK_LEAD_SOURCE_SYSTEM,
          sourceType: "webhook",
          sourceRouteKey: fields.formId ?? `leadgen_${fields.leadgenId}`,
          sourceCampaignId: fields.campaignId,
          sourceCampaignName: fields.campaignName,
          sourceFunnelName: fields.formName,
          sourceLeadId: fields.leadgenId,
          sourceLeadUid: buildFacebookLeadUid(fields.leadgenId),
          clientAccountIdResolved:
            association.outcome === "associated" ? association.clientAccountId : null,
          status: "normalized",
          rawPayloadJson: input.rawPayload as Prisma.InputJsonValue,
          normalizedPayloadJson: normalized as Prisma.InputJsonValue,
          normalizedAt: now,
          receivedAt,
          webhookRequestLogId: input.webhookRequestLogId ?? null,
          enrichmentMetadataJson: enrichment,
          errorSummary: null,
        },
      });
      return presentEvent(event, false, false, tx);
    }
  );
}
