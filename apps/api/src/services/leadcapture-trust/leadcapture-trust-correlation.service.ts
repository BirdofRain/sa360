import type { LeadCaptureTrustCorrelationClassification } from "@prisma/client";

import {
  isLeadCaptureNextGenExactJoin,
  isLeadCaptureNumericLeadId,
  isLeadCaptureUuidLeadId,
} from "../../lib/leadcapture-lead-id.js";
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
} from "./leadcapture-trust.constants.js";
import { validateSourceLeadEventPilotScope } from "./leadcapture-trust-scope.service.js";
import type { LeadCaptureTrustPacket } from "../leadcapture-data-api/leadcapture-trust-packet.js";

type SourceLeadEventRow = NonNullable<Awaited<ReturnType<typeof findSourceLeadEventById>>>;

/** Non-enum string blocker — do not add a Prisma migration for this. */
export const LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER =
  "legacy_source_event_not_joinable_to_nextgen_data_api";

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

  const providerPhone =
    (typeof providerRecord.phone === "string" && providerRecord.phone) ||
    (typeof providerRecord.phone_number === "string" && providerRecord.phone_number) ||
    null;
  const providerEmail =
    (typeof providerRecord.email === "string" && providerRecord.email) ||
    (typeof providerRecord.email_address === "string" && providerRecord.email_address) ||
    null;

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

/**
 * Legacy numeric / legacy-lane SourceLeadEvents cannot join NextGen Data API UUID records.
 * No fabricated crosswalk; identity/time remains preview-only.
 */
export function isLegacySourceEventNotJoinableToNextGenDataApi(
  event: Pick<SourceLeadEventRow, "sourceSystem" | "sourceLeadId">,
  providerLeadId: string
): boolean {
  if (!isLeadCaptureUuidLeadId(providerLeadId)) return false;
  if (event.sourceSystem === "leadcapture_io_legacy") return true;
  if (isLeadCaptureNumericLeadId(event.sourceLeadId)) return true;
  if (!isLeadCaptureUuidLeadId(event.sourceLeadId)) return true;
  return false;
}

function nextGenExactJoinCandidates(
  events: SourceLeadEventRow[],
  providerLeadId: string
): { joinable: SourceLeadEventRow[]; legacyBlocked: boolean } {
  const joinable: SourceLeadEventRow[] = [];
  let legacyBlocked = false;
  for (const event of events) {
    if (!isLeadCaptureNextGenExactJoin(event.sourceLeadId, providerLeadId)) {
      continue;
    }
    if (isLegacySourceEventNotJoinableToNextGenDataApi(event, providerLeadId)) {
      legacyBlocked = true;
      continue;
    }
    joinable.push(event);
  }
  return { joinable, legacyBlocked };
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
  const providerIsUuid = isLeadCaptureUuidLeadId(providerLeadId);

  if (input.explicitSourceLeadEventId?.trim()) {
    const explicit = await findSourceLeadEventById(input.explicitSourceLeadEventId.trim());
    if (!explicit) {
      return { classification: "no_match", matchedEvent: null, blockers: ["explicit_source_lead_not_found"] };
    }
    const scopeError = validatePilotScope({ campaignId: input.campaignId, event: explicit });
    if (scopeError) return { classification: scopeError, matchedEvent: null, blockers: [scopeError] };

    if (
      providerIsUuid &&
      isLegacySourceEventNotJoinableToNextGenDataApi(explicit, providerLeadId)
    ) {
      return {
        classification: "no_match",
        matchedEvent: null,
        blockers: [LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER],
      };
    }

    const exactByLeadId = isLeadCaptureNextGenExactJoin(explicit.sourceLeadId, providerLeadId);
    if (!exactByLeadId) {
      return {
        classification: "ambiguous",
        matchedEvent: null,
        blockers: ["explicit_source_lead_id_mismatch"],
      };
    }
    return { classification: "exact_match", matchedEvent: explicit, blockers };
  }

  if (!providerIsUuid) {
    return {
      classification: "no_match",
      matchedEvent: null,
      blockers: ["nextgen_provider_lead_id_not_uuid"],
    };
  }

  const byProviderLeadId = await findSourceLeadEventsByProviderLeadId(providerLeadId);
  const scopedProviderMatches = filterScopedEvents(byProviderLeadId, input.campaignId);
  const { joinable: joinableProviderMatches, legacyBlocked: legacyProviderBlocked } =
    nextGenExactJoinCandidates(scopedProviderMatches, providerLeadId);
  if (joinableProviderMatches.length === 1) {
    return {
      classification: "exact_match",
      matchedEvent: joinableProviderMatches[0]!,
      blockers,
    };
  }
  if (joinableProviderMatches.length > 1) {
    return {
      classification: "ambiguous",
      matchedEvent: null,
      blockers: ["multiple_provider_lead_id_matches"],
    };
  }
  if (legacyProviderBlocked) {
    blockers.push(LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER);
  }

  const externalEventId = input.packet.correlation.externalEventId;
  if (externalEventId) {
    const externalMatches = await findSourceLeadEventsByExternalEventUuid(externalEventId);
    const scopedExternal = filterScopedEvents(externalMatches, input.campaignId);
    const { joinable: joinableExternal, legacyBlocked: legacyExternalBlocked } =
      nextGenExactJoinCandidates(scopedExternal, providerLeadId);
    if (joinableExternal.length === 1) {
      return { classification: "exact_match", matchedEvent: joinableExternal[0]!, blockers };
    }
    if (joinableExternal.length > 1) {
      return {
        classification: "ambiguous",
        matchedEvent: null,
        blockers: ["multiple_external_event_matches"],
      };
    }
    if (legacyExternalBlocked) {
      blockers.push(LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER);
    }
  }

  // NextGen UID only — never try the legacy prefix for a Data API UUID.
  const leadUid = `leadcaptureio-leadcapture_io_nextgen-${providerLeadId}`;
  const uidMatches = await findSourceLeadEventsBySourceLeadUid(leadUid);
  const scopedUidMatches = filterScopedEvents(uidMatches, input.campaignId);
  const { joinable: joinableUid, legacyBlocked: legacyUidBlocked } = nextGenExactJoinCandidates(
    scopedUidMatches,
    providerLeadId
  );
  if (joinableUid.length === 1) {
    return { classification: "exact_match", matchedEvent: joinableUid[0]!, blockers };
  }
  if (joinableUid.length > 1) {
    return {
      classification: "ambiguous",
      matchedEvent: null,
      blockers: ["multiple_source_lead_uid_matches"],
    };
  }
  if (legacyUidBlocked) {
    blockers.push(LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER);
  }

  const submissionTimestamp = input.packet.trustEvidence.submissionTimestamp;
  if (submissionTimestamp) {
    const receivedAfter = new Date(
      submissionTimestamp.getTime() - LEADCAPTURE_TRUST_IDENTITY_MATCH_WINDOW_MS
    );
    const receivedBefore = new Date(
      submissionTimestamp.getTime() + LEADCAPTURE_TRUST_IDENTITY_MATCH_WINDOW_MS
    );
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
      const matched = identityMatchesList[0]!;
      const identityBlockers = [
        "preview_only_identity_match_requires_explicit_source_lead_event_id",
      ];
      if (isLegacySourceEventNotJoinableToNextGenDataApi(matched, providerLeadId)) {
        identityBlockers.push(LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER);
      }
      return {
        classification: "preview_identity_match",
        matchedEvent: matched,
        blockers: identityBlockers,
      };
    }
    if (identityMatchesList.length > 1) {
      return {
        classification: "ambiguous",
        matchedEvent: null,
        blockers: ["multiple_identity_preview_matches"],
      };
    }
  }

  const mismatchedCampaign = byProviderLeadId.find(
    (event) => event.sourceRouteKey?.trim() !== input.campaignId.trim()
  );
  if (mismatchedCampaign) {
    return {
      classification: "campaign_mismatch",
      matchedEvent: null,
      blockers: ["provider_lead_campaign_mismatch"],
    };
  }

  const mismatchedClient = byProviderLeadId.find(
    (event) => event.clientAccountIdResolved?.trim() !== LEADCAPTURE_TRUST_PILOT_CLIENT_ACCOUNT_ID
  );
  if (mismatchedClient) {
    return {
      classification: "client_mismatch",
      matchedEvent: null,
      blockers: ["provider_lead_client_mismatch"],
    };
  }

  return {
    classification: "no_match",
    matchedEvent: null,
    blockers: blockers.length > 0 ? [...new Set(blockers)] : ["no_correlation_match"],
  };
}

export function applyCorrelationToPacket(
  packet: LeadCaptureTrustPacket,
  correlation: LeadCaptureTrustCorrelationResult
): LeadCaptureTrustPacket {
  const matched = correlation.matchedEvent;
  const blockers = [...correlation.blockers];
  let canAttach = false;
  const providerLeadId = packet.identity.providerLeadId.trim();

  if (correlation.classification === "exact_match" && matched) {
    if (
      isLeadCaptureNextGenExactJoin(matched.sourceLeadId, providerLeadId) &&
      !isLegacySourceEventNotJoinableToNextGenDataApi(matched, providerLeadId)
    ) {
      canAttach = true;
    } else {
      canAttach = false;
      blockers.push(LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER);
    }
  } else if (correlation.classification === "preview_identity_match") {
    canAttach = false;
    blockers.push("preview_only_identity_match_requires_explicit_source_lead_event_id");
    if (matched && isLegacySourceEventNotJoinableToNextGenDataApi(matched, providerLeadId)) {
      blockers.push(LEGACY_SOURCE_EVENT_NOT_JOINABLE_BLOCKER);
    }
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
      externalEventId: matched
        ? readExternalEventId(matched.normalizedPayloadJson)
        : packet.correlation.externalEventId,
    },
    assessment: {
      ...packet.assessment,
      correlationClassification: correlation.classification,
      canAttach,
      blockers: [...new Set([...packet.assessment.blockers, ...blockers])],
    },
  };
}
