import type { Prisma, SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { buildCanonicalSourceLeadLockKey } from "../../repositories/source-lead-event.repository.js";
import { assertFacebookCaptureIntakeEnabled } from "./facebook-capture-gate.js";
import { isSettledCaptureOnlyFacebookEvent } from "./facebook-capture-provenance.js";
import {
  FACEBOOK_ASSOCIATION_EXPLANATIONS,
  type FacebookFormAssociationOutcome,
} from "./facebook-form-association.js";
import {
  resolveFacebookFormAssociation,
  type FacebookFormAssociationResolution,
} from "./facebook-form-association.service.js";
import { parseZapierFacebookCapturePayload } from "./zapier-facebook-capture-payload.js";

const UNSUPPORTED_STATUSES: ReadonlySet<SourceLeadEventStatus> = new Set([
  "delivered",
  "approved",
  "delivery_failed",
  "rejected",
]);

export class FacebookCaptureReevaluationError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "not_facebook_event"
      | "unsupported_capture_record"
      | "unsupported_transition"
      | "conflicting_historical_association"
      | "inventory_record_present"
      | "concurrent_state_change",
    readonly httpStatus: number
  ) {
    super(code);
    this.name = "FacebookCaptureReevaluationError";
  }
}

export type FacebookCaptureReevaluationResult = {
  ok: true;
  sourceEventId: string;
  unchanged: boolean;
  status: SourceLeadEventStatus;
  submittedAt: string | null;
  receivedAt: string;
  previous: {
    status: SourceLeadEventStatus;
    clientAccountIdResolved: string | null;
    associationOutcome: string | null;
    routingDryRunDecisionId: string | null;
  };
  association: FacebookFormAssociationResolution;
  inventory: { tracked: false; mutated: false; saleEligible: false | "not_evaluated" };
  delivery: {
    thisRequestAttempted: false;
    historicalOutcome: "delivered" | "delivery_failed" | "approved" | "not_recorded";
    historicalDeliveredAt: string | null;
  };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStoredAssociation(event: SourceLeadEvent): {
  outcome: string | null;
  clientAccountId: string | null;
} {
  const association = asRecord(asRecord(event.enrichmentMetadataJson)?.association);
  return {
    outcome: typeof association?.outcome === "string" ? association.outcome : null,
    clientAccountId:
      typeof association?.clientAccountId === "string" ? association.clientAccountId : null,
  };
}

function readSubmittedAt(event: SourceLeadEvent): string | null {
  const enrichment = asRecord(event.enrichmentMetadataJson);
  if (typeof enrichment?.submittedAt === "string") return enrichment.submittedAt;
  const source = asRecord(asRecord(event.normalizedPayloadJson)?.source);
  return typeof source?.submitted_at === "string" ? source.submitted_at : null;
}

/**
 * Append-only association history stored on the event. Older entries are kept.
 * Audit client ids are historical identities and must not be rewritten on rekey.
 */
export function appendAssociationAudit(existing: unknown, entry: Record<string, unknown>): unknown[] {
  const audit = Array.isArray(existing) ? existing : [];
  return [...audit, entry];
}

function historicalDelivery(event: SourceLeadEvent): FacebookCaptureReevaluationResult["delivery"] {
  let historicalOutcome: FacebookCaptureReevaluationResult["delivery"]["historicalOutcome"] =
    "not_recorded";
  if (event.deliveredAt || event.status === "delivered") historicalOutcome = "delivered";
  else if (event.status === "delivery_failed") historicalOutcome = "delivery_failed";
  else if (event.approvedAt || event.status === "approved") historicalOutcome = "approved";
  return {
    thisRequestAttempted: false,
    historicalOutcome,
    historicalDeliveredAt: event.deliveredAt ? event.deliveredAt.toISOString() : null,
  };
}
function sameAssociation(
  event: SourceLeadEvent,
  next: FacebookFormAssociationResolution
): boolean {
  const stored = readStoredAssociation(event);
  const storedClient = event.clientAccountIdResolved ?? stored.clientAccountId;
  const nextClient = next.outcome === "associated" ? next.clientAccountId : null;
  return stored.outcome === next.outcome && storedClient === nextClient;
}

function captureFormIdentity(event: SourceLeadEvent): {
  pageId: string | null;
  formId: string | null;
  formIdentityStatus: "present" | "missing" | "invalid";
} {
  const enrichment = asRecord(event.enrichmentMetadataJson) ?? {};
  const supplement = asRecord(enrichment.zapierSupplement);
  const source = asRecord(asRecord(event.normalizedPayloadJson)?.source);
  const stored = asRecord(enrichment.association);
  const pageId =
    (typeof source?.page_id === "string" && source.page_id) ||
    (typeof stored?.pageId === "string" && stored.pageId) ||
    (typeof supplement?.pageId === "string" && supplement.pageId) ||
    null;
  const formId =
    (typeof source?.form_id === "string" && source.form_id) ||
    (typeof stored?.formId === "string" && stored.formId) ||
    (typeof supplement?.formId === "string" && supplement.formId) ||
    null;
  if (pageId && formId) return { pageId, formId, formIdentityStatus: "present" };
  if (enrichment.intakeMethod === "zapier_facebook" && !supplement) {
    const parsed = parseZapierFacebookCapturePayload(event.rawPayloadJson);
    if (!parsed.ok) return { pageId: null, formId: null, formIdentityStatus: "missing" };
    return {
      pageId: parsed.fields.pageId,
      formId: parsed.fields.formId,
      formIdentityStatus: parsed.fields.formIdentityStatus,
    };
  }
  return { pageId, formId, formIdentityStatus: pageId || formId ? "invalid" : "missing" };
}

function unchangedResult(
  event: SourceLeadEvent,
  previous: FacebookCaptureReevaluationResult["previous"],
  association: FacebookFormAssociationResolution
): FacebookCaptureReevaluationResult {
  return {
    ok: true,
    sourceEventId: event.id,
    unchanged: true,
    status: event.status,
    submittedAt: readSubmittedAt(event),
    receivedAt: event.receivedAt.toISOString(),
    previous,
    association,
    inventory: { tracked: false, mutated: false, saleEligible: false },
    delivery: historicalDelivery(event),
  };
}

/**
 * Re-read Page ID + Form ID association for a capture-only Facebook event.
 * Direct Meta and LeadConduit rows are rejected unchanged.
 * The canonical lead lock plus a row lock and a conditional update keep
 * approval, delivery, and inventory writers from landing between the check
 * and the write. Association audit entries are append-only.
 */
export async function reevaluateFacebookCaptureAssociation(input: {
  sourceEventId: string;
  operatorNote?: string | null;
  actor?: string | null;
  requestId?: string | null;
}): Promise<FacebookCaptureReevaluationResult> {
  assertFacebookCaptureIntakeEnabled();
  const sourceEventId = input.sourceEventId.trim();
  if (!sourceEventId) {
    throw new FacebookCaptureReevaluationError("not_found", 404);
  }
  const preview = await prisma.sourceLeadEvent.findUnique({
    where: { id: sourceEventId },
    select: { id: true, sourceProvider: true, sourceSystem: true, sourceLeadId: true },
  });
  if (!preview) throw new FacebookCaptureReevaluationError("not_found", 404);
  if (preview.sourceProvider !== "facebook") {
    throw new FacebookCaptureReevaluationError("not_facebook_event", 409);
  }
  if (preview.sourceSystem !== "meta_lead_ads" || !preview.sourceLeadId) {
    throw new FacebookCaptureReevaluationError("unsupported_capture_record", 409);
  }

  const run = async (tx: Prisma.TransactionClient): Promise<FacebookCaptureReevaluationResult> => {
    await tx.$queryRaw`SELECT id FROM "SourceLeadEvent" WHERE id = ${sourceEventId} FOR UPDATE`;
    const event = await tx.sourceLeadEvent.findUnique({
      where: { id: sourceEventId },
      include: {
        leadInventoryItem: { select: { id: true } },
        fulfillmentOutboxItems: { select: { id: true }, take: 1 },
        leadAllocations: { select: { id: true }, take: 1 },
      },
    });
    if (!event) throw new FacebookCaptureReevaluationError("not_found", 404);
    if (event.sourceProvider !== "facebook") {
      throw new FacebookCaptureReevaluationError("not_facebook_event", 409);
    }
    if (!isSettledCaptureOnlyFacebookEvent(event) || event.sourceSystem !== "meta_lead_ads") {
      throw new FacebookCaptureReevaluationError("unsupported_capture_record", 409);
    }
    if (
      UNSUPPORTED_STATUSES.has(event.status) ||
      event.deliveredAt ||
      event.approvedAt ||
      event.fulfillmentOutboxItems.length > 0 ||
      event.leadAllocations.length > 0
    ) {
      throw new FacebookCaptureReevaluationError("unsupported_transition", 409);
    }
    if (event.leadInventoryItem) {
      throw new FacebookCaptureReevaluationError("inventory_record_present", 409);
    }

    const identity = captureFormIdentity(event);
    const association = await resolveFacebookFormAssociation(identity, tx);
    const previous = {
      status: event.status,
      clientAccountIdResolved: event.clientAccountIdResolved,
      associationOutcome: readStoredAssociation(event).outcome,
      routingDryRunDecisionId: event.routingDryRunDecisionId,
    };
    const nextClient = association.outcome === "associated" ? association.clientAccountId : null;
    if (
      event.clientAccountIdResolved &&
      nextClient &&
      event.clientAccountIdResolved !== nextClient
    ) {
      throw new FacebookCaptureReevaluationError("conflicting_historical_association", 409);
    }
    if (event.clientAccountIdResolved && !nextClient) {
      return unchangedResult(event, previous, {
        outcome: "associated",
        clientAccountId: event.clientAccountIdResolved,
        sourceFunnelId: null,
        pageId: identity.pageId,
        formId: identity.formId,
        explanation:
          "The stored client association was preserved. Removing or missing form ownership does not rewrite historical events.",
      });
    }
    if (sameAssociation(event, association)) {
      return unchangedResult(event, previous, association);
    }

    const enrichment = asRecord(event.enrichmentMetadataJson) ?? {};
    const entry = {
      at: new Date().toISOString(),
      action: "reevaluate_association",
      actor: input.actor?.trim() || null,
      requestId: input.requestId?.trim() || null,
      operatorNote: input.operatorNote?.trim() || null,
      previous,
      next: {
        outcome: association.outcome,
        clientAccountId: nextClient,
        sourceFunnelId: association.sourceFunnelId,
      },
    };
    const nextEnrichment: Prisma.InputJsonObject = {
      ...(enrichment as Prisma.InputJsonObject),
      association: {
        outcome: association.outcome,
        clientAccountId: nextClient,
        sourceFunnelId: association.sourceFunnelId,
        pageId: association.pageId,
        formId: association.formId,
        explanation: association.explanation,
      },
      associationAudit: appendAssociationAudit(enrichment.associationAudit, entry) as Prisma.InputJsonArray,
    };
    const normalized = asRecord(event.normalizedPayloadJson);
    const normalizedNext = normalized
      ? {
          ...normalized,
          association: {
            outcome: association.outcome,
            client_account_id: nextClient,
            source_funnel_id: association.sourceFunnelId,
            page_id: association.pageId,
            form_id: association.formId,
          },
        }
      : undefined;
    const updated = await tx.sourceLeadEvent.updateMany({
      where: {
        id: event.id,
        status: event.status,
        deliveredAt: null,
        approvedAt: null,
        routingDryRunDecisionId: event.routingDryRunDecisionId,
      },
      data: {
        clientAccountIdResolved: nextClient ?? event.clientAccountIdResolved,
        enrichmentMetadataJson: nextEnrichment,
        ...(normalizedNext
          ? { normalizedPayloadJson: normalizedNext as Prisma.InputJsonValue }
          : {}),
      },
    });
    if (updated.count !== 1) {
      throw new FacebookCaptureReevaluationError("concurrent_state_change", 409);
    }
    return {
      ok: true as const,
      sourceEventId: event.id,
      unchanged: false,
      status: event.status,
      submittedAt: readSubmittedAt(event),
      receivedAt: event.receivedAt.toISOString(),
      previous,
      association,
      inventory: { tracked: false, mutated: false as const, saleEligible: false as const },
      delivery: historicalDelivery(event),
    };
  };

  const lockKey = buildCanonicalSourceLeadLockKey(
    preview.sourceProvider,
    preview.sourceSystem,
    preview.sourceLeadId
  );
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    return run(tx);
  });
}

export function associationExplanationForOutcome(
  outcome: FacebookFormAssociationOutcome
): string {
  return FACEBOOK_ASSOCIATION_EXPLANATIONS[outcome];
}
