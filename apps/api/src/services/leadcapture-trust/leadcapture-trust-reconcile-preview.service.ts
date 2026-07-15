import { getLeadProofByLeadUid } from "../../repositories/lead-proof.repository.js";
import { maskProviderLeadId } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import { listLeadCaptureDataApiLeads } from "../leadcapture-data-api/leadcapture-data-api.client.js";
import type { LeadCaptureDataApiTransport } from "../leadcapture-data-api/leadcapture-data-api.types.js";
import { buildLeadCaptureTrustPacketFromApiRecord } from "../leadcapture-data-api/leadcapture-trust-packet.js";
import {
  hasProviderEvidenceChanged,
  isProviderEvidenceAlreadyAttached,
} from "./leadcapture-trust-attach.service.js";
import {
  applyCorrelationToPacket,
  correlateLeadCaptureTrustPacket,
} from "./leadcapture-trust-correlation.service.js";
import { mergeTrustSyncBlockers } from "./leadcapture-trust-scope.service.js";
import {
  LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID,
  LEADCAPTURE_TRUST_RECONCILE_MAX_RECORDS,
} from "./leadcapture-trust.constants.js";

export type LeadCaptureTrustReconcilePreviewRow = {
  maskedProviderLeadId: string | null;
  correlationClassification: string;
  completenessStatus: string;
  proofRecordPresent: boolean;
  alreadyAttached: boolean;
  providerEvidenceChanged: boolean;
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

function readLeadUidFromNormalized(normalizedPayloadJson: unknown): string | null {
  if (!normalizedPayloadJson || typeof normalizedPayloadJson !== "object" || Array.isArray(normalizedPayloadJson)) {
    return null;
  }
  const contact = (normalizedPayloadJson as Record<string, unknown>).contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const leadUid = (contact as Record<string, unknown>).lead_uid;
    if (typeof leadUid === "string" && leadUid.trim()) return leadUid.trim();
  }
  return null;
}

export async function buildLeadCaptureTrustReconcilePreview(input: {
  campaignId: string;
  cursor?: string | null;
  limit?: number;
  transport?: LeadCaptureDataApiTransport;
}): Promise<LeadCaptureTrustReconcilePreviewResult> {
  const blockers = mergeTrustSyncBlockers({
    campaignId: input.campaignId,
    providerCampaignId: input.campaignId,
    providerFormId: LEADCAPTURE_TRUST_PILOT_PROVIDER_FUNNEL_ID,
  });
  if (blockers.length > 0) {
    return { ok: false, error: "trust_sync_disabled", blockers };
  }

  const limit = Math.min(input.limit ?? LEADCAPTURE_TRUST_RECONCILE_MAX_RECORDS, LEADCAPTURE_TRUST_RECONCILE_MAX_RECORDS);
  const page = await listLeadCaptureDataApiLeads(
    {
      since: input.cursor ?? null,
      limit,
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
    try {
      const packetBase = buildLeadCaptureTrustPacketFromApiRecord(record);
      if (packetBase.identity.providerLeadId === "unknown") {
        counts.providerErrors += 1;
        rows.push({
          maskedProviderLeadId: null,
          correlationClassification: "no_match",
          completenessStatus: "missing_required",
          proofRecordPresent: false,
          alreadyAttached: false,
          providerEvidenceChanged: false,
          contentHashPrefix: "",
        });
        continue;
      }

      const rowScopeBlockers = mergeTrustSyncBlockers({
        campaignId: input.campaignId,
        providerCampaignId: packetBase.identity.providerCampaignId,
        providerFormId: packetBase.identity.providerFormId,
      });
      const rowScopeMismatch = rowScopeBlockers.some(
        (blocker) =>
          blocker.includes("campaign") ||
          blocker.includes("form") ||
          blocker === "provider_campaign_mismatch" ||
          blocker === "provider_form_mismatch"
      );

      const correlation = await correlateLeadCaptureTrustPacket({
        campaignId: input.campaignId,
        packet: packetBase,
        providerRecord: record,
      });
      const packet = applyCorrelationToPacket(packetBase, correlation);
      const rowClassification = rowScopeMismatch
        ? "campaign_mismatch"
        : packet.assessment.correlationClassification;

      if (rowScopeMismatch) {
        counts.campaignMismatch += 1;
      } else {
        switch (rowClassification) {
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
      }

      if (packet.assessment.completenessStatus === "complete") counts.completeProof += 1;
      if (
        packet.assessment.completenessStatus === "incomplete" ||
        packet.assessment.completenessStatus === "contradictory"
      ) {
        counts.needsReview += 1;
      }
      if (packet.assessment.completenessStatus === "missing_required") counts.proofMissing += 1;

      let proofRecordPresent = false;
      if (packet.correlation.sourceLeadUid) {
        proofRecordPresent = Boolean(await getLeadProofByLeadUid(packet.correlation.sourceLeadUid));
      } else if (correlation.matchedEvent) {
        const leadUid = readLeadUidFromNormalized(correlation.matchedEvent.normalizedPayloadJson);
        if (leadUid) proofRecordPresent = Boolean(await getLeadProofByLeadUid(leadUid));
      }

      const alreadyAttached = await isProviderEvidenceAlreadyAttached(
        packet.identity.providerLeadId,
        packet.integrity.contentHash
      );
      const providerEvidenceChanged = await hasProviderEvidenceChanged(
        packet.identity.providerLeadId,
        packet.integrity.contentHash
      );
      if (alreadyAttached) counts.alreadyAttached += 1;
      if (providerEvidenceChanged) counts.providerEvidenceChanged += 1;

      rows.push({
        maskedProviderLeadId: maskProviderLeadId(packet.identity.providerLeadId),
        correlationClassification: rowClassification,
        completenessStatus: packet.assessment.completenessStatus,
        proofRecordPresent,
        alreadyAttached,
        providerEvidenceChanged,
        contentHashPrefix: packet.integrity.contentHash.slice(0, 12),
      });
    } catch {
      counts.providerErrors += 1;
      rows.push({
        maskedProviderLeadId: null,
        correlationClassification: "no_match",
        completenessStatus: "missing_required",
        proofRecordPresent: false,
        alreadyAttached: false,
        providerEvidenceChanged: false,
        contentHashPrefix: "",
      });
    }
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
