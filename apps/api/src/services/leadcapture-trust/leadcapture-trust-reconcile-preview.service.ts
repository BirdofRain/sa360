import { collectLeadCaptureTrustSyncBlockers } from "../../lib/leadcapture-data-api-env.js";
import { maskProviderLeadId } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import { listLeadCaptureDataApiLeads } from "../leadcapture-data-api/leadcapture-data-api.client.js";
import type { LeadCaptureDataApiTransport } from "../leadcapture-data-api/leadcapture-data-api.types.js";
import { buildLeadCaptureTrustPacketFromApiRecord } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import {
  applyCorrelationToPacket,
  correlateLeadCaptureTrustPacket,
} from "./leadcapture-trust-correlation.service.js";
import {
  LEADCAPTURE_TRUST_PILOT_FORM_ID,
  LEADCAPTURE_TRUST_RECONCILE_MAX_RECORDS,
} from "./leadcapture-trust.constants.js";

export type LeadCaptureTrustReconcilePreviewRow = {
  maskedProviderLeadId: string | null;
  correlationClassification: string;
  completenessStatus: string;
  proofRecordPresent: boolean;
  contentHashPrefix: string;
};

export type LeadCaptureTrustReconcilePreviewCounts = {
  providerLeadsRead: number;
  exactMatches: number;
  previewIdentityMatches: number;
  unmatched: number;
  ambiguous: number;
  campaignMismatch: number;
  alreadyAttached: number;
  providerEvidenceChanged: number;
  completeProof: number;
  needsReview: number;
  proofMissing: number;
  providerErrors: number;
};

export type LeadCaptureTrustReconcilePreviewResult =
  | {
      ok: true;
      campaignId: string;
      counts: LeadCaptureTrustReconcilePreviewCounts;
      rows: LeadCaptureTrustReconcilePreviewRow[];
      nextCursor: string | null;
      hasMore: boolean;
    }
  | { ok: false; error: "trust_sync_disabled" | "invalid_campaign" | "provider_error"; blockers: string[] };

export async function buildLeadCaptureTrustReconcilePreview(input: {
  campaignId: string;
  cursor?: string | null;
  limit?: number;
  transport?: LeadCaptureDataApiTransport;
}): Promise<LeadCaptureTrustReconcilePreviewResult> {
  const blockers = collectLeadCaptureTrustSyncBlockers({
    campaignId: input.campaignId,
    formId: LEADCAPTURE_TRUST_PILOT_FORM_ID,
  });
  if (blockers.length > 0) {
    return { ok: false, error: "trust_sync_disabled", blockers };
  }

  const limit = Math.min(input.limit ?? LEADCAPTURE_TRUST_RECONCILE_MAX_RECORDS, LEADCAPTURE_TRUST_RECONCILE_MAX_RECORDS);
  const page = await listLeadCaptureDataApiLeads(
    {
      since: input.cursor ?? null,
      limit,
      funnelId: LEADCAPTURE_TRUST_PILOT_FORM_ID,
    },
    input.transport
  );
  if (!page.ok) {
    return { ok: false, error: "provider_error", blockers: [page.message] };
  }

  const counts: LeadCaptureTrustReconcilePreviewCounts = {
    providerLeadsRead: 0,
    exactMatches: 0,
    previewIdentityMatches: 0,
    unmatched: 0,
    ambiguous: 0,
    campaignMismatch: 0,
    alreadyAttached: 0,
    providerEvidenceChanged: 0,
    completeProof: 0,
    needsReview: 0,
    proofMissing: 0,
    providerErrors: 0,
  };
  const rows: LeadCaptureTrustReconcilePreviewRow[] = [];

  for (const record of page.data.data) {
    counts.providerLeadsRead += 1;
    const packetBase = buildLeadCaptureTrustPacketFromApiRecord(record);
    const correlation = await correlateLeadCaptureTrustPacket({
      campaignId: input.campaignId,
      packet: packetBase,
      providerRecord: record,
    });
    const packet = applyCorrelationToPacket(packetBase, correlation);

    switch (packet.assessment.correlationClassification) {
      case "exact_match":
        counts.exactMatches += 1;
        break;
      case "preview_identity_match":
        counts.previewIdentityMatches += 1;
        break;
      case "ambiguous":
        counts.ambiguous += 1;
        break;
      case "campaign_mismatch":
        counts.campaignMismatch += 1;
        break;
      case "no_match":
        counts.unmatched += 1;
        break;
      default:
        counts.unmatched += 1;
    }

    if (packet.assessment.completenessStatus === "complete") counts.completeProof += 1;
    if (packet.assessment.completenessStatus === "incomplete" || packet.assessment.completenessStatus === "contradictory") {
      counts.needsReview += 1;
    }
    if (packet.assessment.completenessStatus === "missing_required") counts.proofMissing += 1;

    rows.push({
      maskedProviderLeadId: maskProviderLeadId(packet.identity.providerLeadId),
      correlationClassification: packet.assessment.correlationClassification,
      completenessStatus: packet.assessment.completenessStatus,
      proofRecordPresent: false,
      contentHashPrefix: packet.integrity.contentHash.slice(0, 12),
    });
  }

  return {
    ok: true,
    campaignId: input.campaignId,
    counts,
    rows,
    nextCursor: page.data.next_cursor,
    hasMore: page.data.has_more,
  };
}
