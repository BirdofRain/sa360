import {
  getLeadProofByLeadUid,
  getLeadProofWithArtifactsByLeadUid,
} from "../../repositories/lead-proof.repository.js";
import { prisma } from "../../lib/db.js";
import { getLeadCaptureDataApiLeadById } from "../leadcapture-data-api/leadcapture-data-api.client.js";
import type { LeadCaptureDataApiTransport } from "../leadcapture-data-api/leadcapture-data-api.types.js";
import {
  buildLeadCaptureTrustPacketFromApiRecord,
  presentLeadCaptureTrustPreviewSummary,
} from "../leadcapture-data-api/leadcapture-trust-packet.js";
import {
  applyCorrelationToPacket,
  correlateLeadCaptureTrustPacket,
} from "./leadcapture-trust-correlation.service.js";
import { mergeTrustSyncBlockers } from "./leadcapture-trust-scope.service.js";

export type LeadCaptureTrustPreviewError =
  | "invalid_campaign"
  | "trust_sync_disabled"
  | "provider_error"
  | "provider_lead_not_found"
  | "malformed_provider_record";

export type LeadCaptureTrustPreviewSuccess = {
  ok: true;
  preview: ReturnType<typeof presentLeadCaptureTrustPreviewSummary>;
  contentHash: string;
};

export type LeadCaptureTrustPreviewResult =
  | LeadCaptureTrustPreviewSuccess
  | { ok: false; error: LeadCaptureTrustPreviewError; blockers: string[]; providerErrorCode?: string };

export async function buildLeadCaptureTrustPilotPreview(input: {
  providerLeadId: string;
  campaignId: string;
  sourceLeadEventId?: string | null;
  transport?: LeadCaptureDataApiTransport;
}): Promise<LeadCaptureTrustPreviewResult> {
  const providerResult = await getLeadCaptureDataApiLeadById(input.providerLeadId, input.transport);
  if (!providerResult.ok) {
    const error =
      providerResult.code === "not_found" ? "provider_lead_not_found" : "provider_error";
    return {
      ok: false,
      error,
      blockers: [providerResult.message],
      providerErrorCode: providerResult.code,
    };
  }

  const packetBase = buildLeadCaptureTrustPacketFromApiRecord(providerResult.data);
  if (packetBase.identity.providerLeadId === "unknown") {
    return { ok: false, error: "malformed_provider_record", blockers: ["provider_lead_id_missing"] };
  }

  const blockers = mergeTrustSyncBlockers({
    campaignId: input.campaignId,
    providerCampaignId: packetBase.identity.providerCampaignId,
    providerFormId: packetBase.identity.providerFormId,
  });
  if (blockers.length > 0) {
    return { ok: false, error: "trust_sync_disabled", blockers };
  }

  const correlation = await correlateLeadCaptureTrustPacket({
    campaignId: input.campaignId,
    packet: packetBase,
    providerRecord: providerResult.data,
    explicitSourceLeadEventId: input.sourceLeadEventId,
  });
  const packet = applyCorrelationToPacket(packetBase, correlation);

  let proofRecordPresent = false;
  let sourceSnapshotPresent = false;
  let artifactCount = packet.trustEvidence.artifactCount;

  if (packet.correlation.sourceLeadUid) {
    const proof = await getLeadProofWithArtifactsByLeadUid(packet.correlation.sourceLeadUid);
    proofRecordPresent = Boolean(proof);
    artifactCount = proof?.proofArtifacts.length ?? artifactCount;
    sourceSnapshotPresent = Boolean(
      await prisma.leadSourceSnapshot.findUnique({ where: { leadUid: packet.correlation.sourceLeadUid } })
    );
  } else if (packet.correlation.sourceLeadEventId) {
    const event = await prisma.sourceLeadEvent.findUnique({
      where: { id: packet.correlation.sourceLeadEventId },
      select: { normalizedPayloadJson: true },
    });
    const leadUid =
      event?.normalizedPayloadJson &&
      typeof event.normalizedPayloadJson === "object" &&
      !Array.isArray(event.normalizedPayloadJson)
        ? ((event.normalizedPayloadJson as Record<string, unknown>).contact as Record<string, unknown> | undefined)
            ?.lead_uid
        : null;
    if (typeof leadUid === "string") {
      proofRecordPresent = Boolean(await getLeadProofByLeadUid(leadUid));
      sourceSnapshotPresent = Boolean(
        await prisma.leadSourceSnapshot.findUnique({ where: { leadUid } })
      );
    }
  }

  return {
    ok: true,
    preview: presentLeadCaptureTrustPreviewSummary({
      packet,
      proofRecordPresent,
      sourceSnapshotPresent,
      artifactCount,
    }),
    contentHash: packet.integrity.contentHash,
  };
}
