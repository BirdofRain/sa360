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
import { ZAPIER_FACEBOOK_INTAKE_METHOD, isSettledZapierFacebookCapture } from "./facebook-capture-provenance.js";
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

export type ZapierFacebookCaptureResult = {
  ok: true;
  provider: "facebook";
  intakeMethod: "zapier_facebook";
  sourceEventId: string;
  replayed: boolean;
  submittedAt: string | null;
  receivedAt: string;
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
    saleEligible: false;
    mutated: false;
    reason: string;
  };
  delivery: {
    attempted: false;
    status: "not_attempted";
    reason: "capture_only_intake_does_not_deliver";
  };
  nextAction: string;
};

const INVENTORY_NOT_TRACKED = "capture_only_facebook_intake_does_not_track_inventory";
const INVENTORY_EXISTING_UNCHANGED = "existing_inventory_item_not_modified";

function omitEmpty(entries: Array<[string, string | null | undefined]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return out;
}

function buildNormalizedPayload(
  fields: ZapierFacebookCaptureFields,
  association: FacebookFormAssociationResolution,
  receivedAt: string
): Record<string, unknown> {
  return {
    schema_version: "sa360.facebook_capture.v1",
    contact: omitEmpty([
      ["lead_uid", buildFacebookLeadUid(fields.leadgenId)],
      ["first_name", fields.firstName],
      ["last_name", fields.lastName],
      ["email", fields.email],
      ["phone", fields.phone],
      ["phone_e164", fields.phoneE164],
      ["state", fields.state],
      ["zip", fields.postalCode],
    ]),
    source: {
      provider: FACEBOOK_LEAD_PROVIDER,
      source_system: FACEBOOK_LEAD_SOURCE_SYSTEM,
      intake_method: ZAPIER_FACEBOOK_INTAKE_METHOD,
      leadgen_id: fields.leadgenId,
      ...omitEmpty([
        ["page_id", fields.pageId],
        ["form_id", fields.formId],
        ["form_name", fields.formName],
        ["campaign_id", fields.campaignId],
        ["campaign_name", fields.campaignName],
        ["adset_id", fields.adsetId],
        ["adset_name", fields.adsetName],
        ["ad_id", fields.adId],
        ["ad_name", fields.adName],
      ]),
      ...(fields.submittedAt ? { submitted_at: fields.submittedAt } : {}),
      received_at: receivedAt,
    },
    association: {
      outcome: association.outcome,
      client_account_id: association.clientAccountId,
      source_funnel_id: association.sourceFunnelId,
      page_id: association.pageId,
      form_id: association.formId,
    },
  };
}

function buildEnrichment(input: {
  fields: ZapierFacebookCaptureFields;
  association: FacebookFormAssociationResolution;
  receivedAt: string;
  audit?: unknown[];
}): Prisma.InputJsonObject {
  return {
    intakeMethod: ZAPIER_FACEBOOK_INTAKE_METHOD,
    intakeProvenance: "zapier",
    captureOnly: true,
    captureSettled: true,
    intakeStage: "capture_only",
    submittedAt: input.fields.submittedAt,
    receivedAt: input.receivedAt,
    association: {
      outcome: input.association.outcome,
      clientAccountId: input.association.clientAccountId,
      sourceFunnelId: input.association.sourceFunnelId,
      pageId: input.association.pageId,
      formId: input.association.formId,
      explanation: input.association.explanation,
    },
    inventory: {
      tracked: false,
      saleEligible: false,
      mutated: false,
      reason: INVENTORY_NOT_TRACKED,
    },
    delivery: {
      attempted: false,
      status: "not_attempted",
    },
    associationAudit: (input.audit ?? []) as Prisma.InputJsonValue,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function storedAssociation(event: SourceLeadEvent): FacebookFormAssociationResolution {
  if (isSettledZapierFacebookCapture(event)) {
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
  }
  return {
    outcome: "not_evaluated",
    clientAccountId: null,
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
      saleEligible: false,
      mutated: false,
      reason: INVENTORY_EXISTING_UNCHANGED,
    };
  }
  return { tracked: false, saleEligible: false, mutated: false, reason: INVENTORY_NOT_TRACKED };
}

async function presentEvent(
  event: SourceLeadEvent,
  replayed: boolean,
  db: Prisma.TransactionClient
): Promise<ZapierFacebookCaptureResult> {
  const association = storedAssociation(event);
  return {
    ok: true,
    provider: "facebook",
    intakeMethod: ZAPIER_FACEBOOK_INTAKE_METHOD,
    sourceEventId: event.id,
    replayed,
    submittedAt: storedSubmittedAt(event),
    receivedAt: event.receivedAt.toISOString(),
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
    delivery: {
      attempted: false,
      status: "not_attempted",
      reason: "capture_only_intake_does_not_deliver",
    },
    nextAction: captureNextAction(association.outcome),
  };
}

/**
 * Capture-only Zapier Facebook intake.
 *
 * Does not read a master client account, GHL destination, or routing rules.
 * Does not create inventory, routing decisions, or delivery jobs.
 * Retries share the canonical Facebook leadgen identity inside one advisory lock.
 */
export async function processZapierFacebookCapture(input: {
  rawPayload: Record<string, unknown>;
  webhookRequestLogId?: string;
}): Promise<ZapierFacebookCaptureResult> {
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
        return presentEvent(existing, true, tx);
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
      return presentEvent(event, false, tx);
    }
  );
}
