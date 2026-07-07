import {
  getLeadProofWithArtifactsByLeadUid,
  getLeadVerificationResultByLeadUid,
} from "../../repositories/lead-proof.repository.js";
import {
  presentLeadProofPacket,
  type LeadProofPacketDto,
} from "./lead-proof.present.js";

export async function getLeadProofPacketForAdmin(
  leadUid: string
): Promise<LeadProofPacketDto | null> {
  const [proof, verification] = await Promise.all([
    getLeadProofWithArtifactsByLeadUid(leadUid),
    getLeadVerificationResultByLeadUid(leadUid),
  ]);
  return presentLeadProofPacket(proof, verification);
}
