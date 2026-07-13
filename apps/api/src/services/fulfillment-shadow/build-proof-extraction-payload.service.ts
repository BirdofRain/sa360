import type { SourceLeadEvent } from "@prisma/client";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Build a webhook-shaped extraction payload from persisted SourceLeadEvent evidence only.
 * Does not call external providers.
 */
export function buildProofExtractionPayloadFromSourceLeadEvent(
  event: Pick<
    SourceLeadEvent,
    | "sourceLeadId"
    | "sourceLeadUid"
    | "sourceCampaignId"
    | "sourceCampaignName"
    | "sourceFunnelName"
    | "normalizedPayloadJson"
    | "rawPayloadJson"
    | "enrichmentMetadataJson"
    | "receivedAt"
  >
): unknown | null {
  const normalized = asObject(event.normalizedPayloadJson);
  if (!normalized) return null;

  const payload: Record<string, unknown> = { ...normalized };
  const contact = asObject(payload.contact) ?? {};
  const attribution = asObject(payload.attribution) ?? {};
  const routing = asObject(payload.routing) ?? {};

  if (event.sourceLeadId?.trim()) {
    payload.source_lead_id = event.sourceLeadId.trim();
    if (!attribution.source_lead_id) attribution.source_lead_id = event.sourceLeadId.trim();
  }
  if (event.sourceLeadUid?.trim() && !contact.lead_uid) {
    contact.lead_uid = event.sourceLeadUid.trim();
  }
  if (event.sourceCampaignId?.trim() && !attribution.campaign_id) {
    attribution.campaign_id = event.sourceCampaignId.trim();
  }
  if (event.sourceCampaignName?.trim() && !attribution.campaign_name) {
    attribution.campaign_name = event.sourceCampaignName.trim();
  }
  if (event.sourceFunnelName?.trim() && !routing.form_name) {
    routing.form_name = event.sourceFunnelName.trim();
  }

  const enrichment = asObject(event.enrichmentMetadataJson);
  const sourceAttrs = enrichment ? asObject(enrichment.sourceAttributes) : null;
  if (sourceAttrs) {
    const routingWithIntake = { ...routing };
    const existingIntake = asObject(routingWithIntake.source_intake) ?? {};
    routingWithIntake.source_intake = { ...existingIntake, ...sourceAttrs };
    payload.routing = routingWithIntake;
  } else if (Object.keys(routing).length > 0) {
    payload.routing = routing;
  }

  if (Object.keys(attribution).length > 0) payload.attribution = attribution;
  if (Object.keys(contact).length > 0) payload.contact = contact;

  if (!payload.submitted_at && !payload.submittedAt) {
    payload.submitted_at = event.receivedAt.toISOString();
  }

  const raw = asObject(event.rawPayloadJson);
  if (raw) {
    const rawLead = asObject(raw.lead);
    if (rawLead && !payload.proof) {
      const proofFromRaw = asObject(rawLead.proof);
      if (proofFromRaw) payload.proof = proofFromRaw;
    }
  }

  return payload;
}
