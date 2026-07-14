import type { LeadCaptureTrustCorrelationClassification } from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { fingerprintIdentityValue } from "../../lib/identity-fingerprint.js";
import {
  findSourceLeadEventById,
  findSourceLeadEventsByExternalEventUuid,
  findSourceLeadEventsByProviderLeadId,
  findSourceLeadEventsByRouteKeyForIdentityPreview,
  findSourceLeadEventsBySourceLeadUid,
} from "../../repositories/source-lead-event.repository.js";
import {
  LEADCAPTURE_TRUST_IDENTITY_MATCH_WINDOW_MS,
  LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
  LEADCAPTURE_TRUST_PILOT_SOURCE_LANE,
} from "./leadcapture-trust.constants.js";
import { validateSourceLeadEventPilotScope } from "./leadcapture-trust-scope.service.js";
import type { LeadCaptureTrustPacket } from "../leadcapture-data-api/leadcapture-trust-packet.js";

type SourceLeadEventRow = NonNullable<Awaited<ReturnType<typeof findSourceLeadEventById>>>;

function readExternalEventId(normalizedPayloadJson: unknown): string | null {
  if (!normalizedPayloadJson || typeof normalizedPayloadJson !== "object" || Array.isArray(normalizedPayloadJson)) {
    return null;
  }
  const event = (normalizedPayloadJson as Record<string, unknown>).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const eventUuid = (event as Record<string, unknown>).event_uuid;
  return typeof eventUuid === "string" && eventUuid.trim() ? eventUuid.trim() : null;
}

function readLeadUid(normalizedPayloadJson: unknown): string | null {
  if (!normalizedPayloadJson || typeof normalizedPayloadJson !== "object" || Array.isArray(normalizedPayloadJson)) {
    return null;
  }
  const payload = normalizedPayloadJson as Record<string, unknown>;
  const contact = payload.contact;
  if (contact && typeof contact === "object" && !Array.isArray(contact)) {
    const leadUid = (contact as Record<string, unknown>).lead_uid;
    if (typeof leadUid === "string" && leadUid.trim()) return leadUid.trim();
  }
  const leadUid = payload.lead_uid;
  return typeof leadUid === "string" && leadUid.trim() ? leadUid.trim() : null;
}

function validatePilotScope(input: {
  campaignId: string;
  event: SourceLeadEventRow;
}): LeadCaptureTrustCorrelationClassification | null {
  const blockers = validateSourceLeadEventPilotScope({
    campaignId: input.campaignId,
    sourceRouteKey: input.event.sourceRouteKey,
    clientAccountIdResolved: input.event.clientAccountIdResolved,
    sourceProvider: input.event.sourceProvider,
  });
  if (blockers.includes("campaign_mismatch")) return "campaign_mismatch";
  if (blockers.includes("client_mismatch")) return "client_mismatch";
  if (blockers.includes("source_lane_mismatch")) return "source_lane_mismatch";
  return null;
}

function identityMatches(
  event: SourceLeadEventRow,
  providerRecord: Record<string, unknown>
): boolean {
  const normalizedIdentity = readNormalizedLeadIdentity(event.normalizedPayloadJson);
  if (!normalizedIdentity) return false;

  const providerPhone = typeof providerRecord.phone === "string" ? providerRecord.phone : null;
  const providerEmail = typeof providerRecord.email === "string" ? providerRecord.email : null;

  const phoneMatch =
    normalizedIdentity.phoneE164 &&
    providerPhone &&
    fingerprintIdentityValue("phone", normalizedIdentity.phoneE164) ===
      fingerprintIdentityValue("phone", providerPhone);
  const emailMatch =
    normalizedIdentity.email &&
    providerEmail &&
    fingerprintIdentityValue("email", normalizedIdentity.email) ===
      fingerprintIdentityValue("email", providerEmail);

  return Boolean(phoneMatch || emailMatch);
}

function filterScopedEvents(
  events: SourceLeadEventRow[],
  campaignId: string
): SourceLeadEventRow[] {
  return events.filter((event) => !validatePilotScope({ campaignId, event }));
}

export type LeadCaptureTrustCorrelationResult = {
  classification: LeadCaptureTrustCorrelationClassification;
  matchedEvent: SourceLeadEventRow | null;
  blockers: string[];
};

export async function correlateLeadCaptureTrustPacket(input: {
  campaignId: string;
  packet: LeadCaptureTrustPacket;
  providerRecord: Record<string, unknown>;
  explicitSourceLeadEventId?: string | null;
}): Promise<LeadCaptureTrustCorrelationResult> {
  const blockers: string[] = [];
  const providerLeadId = input.packet.identity.providerLeadId.trim();

  if (input.explicitSourceLeadEventId?.trim()) {
    const explicit = await findSourceLeadEventById(input.explicitSourceLeadEventId.trim());
    if (!explicit) {
      return { classification: "no_match", matchedEvent: null, blockers: ["explicit_source_lead_not_found"] };
    }
    const scopeError = validatePilotScope({ campaignId: input.campaignId, event: explicit });
    if (scopeError) return { classification: scopeError, matchedEvent: null, blockers: [scopeError] };
    const exactById =
      explicit.sourceLeadId?.trim() === providerLeadId ||
      readExternalEventId(explicit.normalizedPayloadJson) === input.packet.correlation.externalEventId;
    if (!exactById) {
      return {
        classification: "ambiguous",
        matchedEvent: null,
        blockers: ["explicit_source_lead_id_mismatch"],
      };
    }
    return { classification: "exact_match", matchedEvent: explicit, blockers };
  }

  const byProviderLeadId = await findSourceLeadEventsByProviderLeadId(providerLeadId);
  const scopedProviderMatches = filterScopedEvents(byProviderLeadId, input.campaignId);
  if (scopedProviderMatches.length === 1) {
    return {
      classification: "exact_match",
      matchedEvent: scopedProviderMatches[0]!,
      blockers,
    };
  }
  if (scopedProviderMatches.length > 1) {
    return {
      classification: "ambiguous",
      matchedEvent: null,
      blockers: ["multiple_provider_lead_id_matches"],
    };
  }

  const externalEventId = input.packet.correlation.externalEventId;
  if (externalEventId) {
    const externalMatches = await findSourceLeadEventsByExternalEventUuid(externalEventId);
    const scopedExternal = filterScopedEvents(externalMatches, input.campaignId);
    if (scopedExternal.length === 1) {
      return { classification: "exact_match", matchedEvent: scopedExternal[0]!, blockers };
    }
    if (scopedExternal.length > 1) {
      return { classification: "ambiguous", matchedEvent: null, blockers: ["multiple_external_event_matches"] };
    }
  }

  const leadUidCandidates = [
    `leadcaptureio-leadcapture_io_legacy-${providerLeadId}`,
    `leadcaptureio-leadcapture_io_nextgen-${providerLeadId}`,
  ];
  for (const leadUid of leadUidCandidates) {
    const uidMatches = await findSourceLeadEventsBySourceLeadUid(leadUid);
    const scopedUidMatches = filterScopedEvents(uidMatches, input.campaignId);
    if (scopedUidMatches.length === 1) {
      return { classification: "exact_match", matchedEvent: scopedUidMatches[0]!, blockers };
    }
    if (scopedUidMatches.length > 1) {
      return { classification: "ambiguous", matchedEvent: null, blockers: ["multiple_source_lead_uid_matches"] };
    }
  }

  const submissionTimestamp = input.packet.trustEvidence.submissionTimestamp;
  if (submissionTimestamp) {
    const receivedAfter = new Date(submissionTimestamp.getTime() - LEADCAPTURE_TRUST_IDENTITY_MATCH_WINDOW_MS);
    const receivedBefore = new Date(submissionTimestamp.getTime() + LEADCAPTURE_TRUST_IDENTITY_MATCH_WINDOW_MS);
    const identityCandidates = await findSourceLeadEventsByRouteKeyForIdentityPreview({
      sourceRouteKey: input.campaignId,
      clientAccountId: LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID,
      receivedAfter,
      receivedBefore,
    });
    const identityMatchesList = identityCandidates.filter((event) =>
      identityMatches(event, input.providerRecord)
    );
    if (identityMatchesList.length === 1) {
      return {
        classification: "preview_identity_match",
        matchedEvent: identityMatchesList[0]!,
        blockers: ["preview_only_identity_match_requires_explicit_source_lead_event_id"],
      };
    }
    if (identityMatchesList.length > 1) {
      return { classification: "ambiguous", matchedEvent: null, blockers: ["multiple_identity_preview_matches"] };
    }
  }

  const mismatchedCampaign = byProviderLeadId.find(
    (event) => event.sourceRouteKey?.trim() !== input.campaignId.trim()
  );
  if (mismatchedCampaign) {
    return { classification: "campaign_mismatch", matchedEvent: null, blockers: ["provider_lead_campaign_mismatch"] };
  }

  const mismatchedClient = byProviderLeadId.find(
    (event) => event.clientAccountIdResolved?.trim() !== LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID
  );
  if (mismatchedClient) {
    return { classification: "client_mismatch", matchedEvent: null, blockers: ["provider_lead_client_mismatch"] };
  }

  return { classification: "no_match", matchedEvent: null, blockers: ["no_correlation_match"] };
}

export function applyCorrelationToPacket(
  packet: LeadCaptureTrustPacket,
  correlation: LeadCaptureTrustCorrelationResult
): LeadCaptureTrustPacket {
  const matched = correlation.matchedEvent;
  const blockers = [...correlation.blockers];
  let canAttach = false;

  if (correlation.classification === "exact_match" && matched) {
    canAttach = true;
  } else if (correlation.classification === "preview_identity_match") {
    canAttach = false;
    blockers.push("preview_only_identity_match_requires_explicit_source_lead_event_id");
  } else {
    canAttach = false;
    if (blockers.length === 0) blockers.push(correlation.classification);
  }

  return {
    ...packet,
    correlation: {
      sourceLeadEventId: matched?.id ?? null,
      sourceLeadUid: matched ? readLeadUid(matched.normalizedPayloadJson) : null,
      clientAccountId: matched?.clientAccountIdResolved ?? null,
      externalEventId: matched ? readExternalEventId(matched.normalizedPayloadJson) : packet.correlation.externalEventId,
    },
    assessment: {
      ...packet.assessment,
      correlationClassification: correlation.classification,
      canAttach,
      blockers: [...new Set([...packet.assessment.blockers, ...blockers])],
    },
  };
}
