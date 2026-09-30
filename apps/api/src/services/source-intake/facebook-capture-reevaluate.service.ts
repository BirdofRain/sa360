import type { Prisma, SourceLeadEvent, SourceLeadEventStatus } from "@prisma/client";

import { prisma } from "../../lib/db.js";
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
      | "unsupported_transition"
      | "conflicting_historical_association"
      | "inventory_record_present",
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
  inventory: { tracked: false; mutated: false; saleEligible: false };
  delivery: { attempted: false; mutated: false };
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

function sameAssociation(
  event: SourceLeadEvent,
  next: FacebookFormAssociationResolution
): boolean {
  const stored = readStoredAssociation(event);
  const storedClient = event.clientAccountIdResolved ?? stored.clientAccountId;
  const nextClient = next.outcome === "associated" ? next.clientAccountId : null;
  return stored.outcome === next.outcome && storedClient === nextClient;
}

/**
 * Re-read Page ID + Form ID association for an existing Facebook event.
 * Does not create a lead, routing decision, inventory row, or delivery job.
 * A stored client is never replaced with a different client.
 */
export async function reevaluateFacebookCaptureAssociation(input: {
  sourceEventId: string;
  operatorNote?: string | null;
}): Promise<FacebookCaptureReevaluationResult> {
  const sourceEventId = input.sourceEventId.trim();
  if (!sourceEventId) {
    throw new FacebookCaptureReevaluationError("not_found", 404);
  }
  const lockKey = `fb-capture-reeval:${sourceEventId}`;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
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

    const parsed = parseZapierFacebookCapturePayload(event.rawPayloadJson);
    const pageId = parsed.ok ? parsed.fields.pageId : null;
    const formId = parsed.ok ? parsed.fields.formId : null;
    const formIdentityStatus = parsed.ok ? parsed.fields.formIdentityStatus : "missing";
    const association = await resolveFacebookFormAssociation(
      { pageId, formId, formIdentityStatus },
      tx
    );
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
      return {
        ok: true,
        sourceEventId: event.id,
        unchanged: true,
        status: event.status,
        submittedAt: readSubmittedAt(event),
        receivedAt: event.receivedAt.toISOString(),
        previous,
        association: {
          outcome: "associated",
          clientAccountId: event.clientAccountIdResolved,
          sourceFunnelId: null,
          pageId,
          formId,
          explanation:
            "The stored client association was preserved. Removing or missing form ownership does not rewrite historical events.",
        },
        inventory: { tracked: false, mutated: false, saleEligible: false },
        delivery: { attempted: false, mutated: false },
      };
    }
    if (sameAssociation(event, association)) {
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
        delivery: { attempted: false, mutated: false },
      };
    }

    const enrichment = asRecord(event.enrichmentMetadataJson) ?? {};
    const audit = Array.isArray(enrichment.associationAudit) ? enrichment.associationAudit : [];
    const entry = {
      at: new Date().toISOString(),
      action: "reevaluate_association",
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
      associationAudit: [...audit, entry].slice(-50) as Prisma.InputJsonArray,
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
    await tx.sourceLeadEvent.update({
      where: { id: event.id },
      data: {
        clientAccountIdResolved: nextClient ?? event.clientAccountIdResolved,
        enrichmentMetadataJson: nextEnrichment,
        ...(normalizedNext
          ? { normalizedPayloadJson: normalizedNext as Prisma.InputJsonValue }
          : {}),
      },
    });
    return {
      ok: true,
      sourceEventId: event.id,
      unchanged: false,
      status: event.status,
      submittedAt: readSubmittedAt(event),
      receivedAt: event.receivedAt.toISOString(),
      previous,
      association,
      inventory: { tracked: false, mutated: false, saleEligible: false },
      delivery: { attempted: false, mutated: false },
    };
  });
}

export function associationExplanationForOutcome(
  outcome: FacebookFormAssociationOutcome
): string {
  return FACEBOOK_ASSOCIATION_EXPLANATIONS[outcome];
}
