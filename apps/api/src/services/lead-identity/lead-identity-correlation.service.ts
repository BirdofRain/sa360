import type { LeadDuplicateRiskAssessment } from "@prisma/client";
import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import type { RoutingAttributionInput } from "../../lib/routing-attribution-extract.js";
import {
  findByDisplayNameProximity,
  findByNormalizedEmail,
  findByNormalizedPhone,
} from "../../repositories/inbound-contact-index.repository.js";
import {
  createOrphanAppointmentAssessment,
  findAssessmentsByFacebookLeadId,
  findAssessmentsByFacebookSubmissionId,
  findDuplicateRiskByRoutingDecisionId,
  hasPriorLeadCreatedForIdentity,
  updateDuplicateRiskOperatorStatus,
  upsertDuplicateRiskForRoutingDecision,
} from "../../repositories/lead-duplicate-risk.repository.js";
import {
  applyOperatorOverrideToLiveBlock,
  evaluateDuplicateRisk,
  type DuplicateRiskLookupRow,
} from "./duplicate-risk.service.js";
import { extractLeadIdentitySnapshot } from "./lead-identity-extract.js";
import type {
  DuplicateRiskAssessmentItem,
  DuplicateRiskResult,
  LeadIdentitySnapshot,
  OperatorOverrideStatus,
} from "./lead-identity.types.js";

function indexRowToLookup(row: {
  leadUid: string | null;
  contactIdGhl: string | null;
  phoneE164: string;
  email: string | null;
  displayName: string | null;
  clientAccountId: string;
  subaccountIdGhl: string;
  lastSeenAt: Date;
}): DuplicateRiskLookupRow {
  return {
    leadUid: row.leadUid,
    contactIdGhl: row.contactIdGhl,
    phoneE164: row.phoneE164,
    email: row.email,
    displayName: row.displayName,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    lastSeenAt: row.lastSeenAt,
  };
}

function assessmentRowToLookup(row: LeadDuplicateRiskAssessment): DuplicateRiskLookupRow {
  return {
    leadUid: row.sourceLeadUid,
    contactIdGhl: null,
    phoneE164: row.normalizedPhone,
    email: row.normalizedEmail,
    displayName: row.fullName,
    clientAccountId: row.destinationClientAccountId ?? row.masterClientAccountId,
    subaccountIdGhl: row.destinationSubaccountIdGhl ?? "",
    lastSeenAt: row.evaluatedAt,
    sourceEventUuid: row.sourceEventUuid,
    facebookLeadId: row.facebookLeadId,
    facebookSubmissionId: row.facebookSubmissionId,
    receivedAt: row.evaluatedAt,
  };
}

function buildLookupHandlers(identity: LeadIdentitySnapshot) {
  const destClient = identity.destinationClientAccountId ?? identity.clientAccountId ?? "";
  const destSub = identity.destinationSubaccountIdGhl ?? "";

  return {
    byFacebookLeadId: async (id: string) => {
      const rows = await findAssessmentsByFacebookLeadId(id);
      return rows.map(assessmentRowToLookup);
    },
    byFacebookSubmissionId: async (id: string) => {
      const rows = await findAssessmentsByFacebookSubmissionId(id);
      return rows.map(assessmentRowToLookup);
    },
    byPhone: async (phone: string, clientAccountId: string, subaccountIdGhl: string) => {
      const row = await findByNormalizedPhone(phone, {
        clientAccountId,
        subaccountIdGhl,
      });
      return row ? indexRowToLookup(row) : null;
    },
    byEmail: async (email: string, clientAccountId: string, subaccountIdGhl: string) => {
      const row = await findByNormalizedEmail(email, {
        clientAccountId,
        subaccountIdGhl,
      });
      return row ? indexRowToLookup(row) : null;
    },
    byLeadUid: async (leadUid: string, clientAccountId: string) => {
      void clientAccountId;
      void leadUid;
      return null;
    },
    byNameCampaignProximity: async (snap: LeadIdentitySnapshot, windowMs: number) => {
      if (!snap.fullName || !destClient) return [];
      const since = new Date(Date.now() - windowMs);
      const rows = await findByDisplayNameProximity(snap.fullName, {
        clientAccountId: destClient,
        subaccountIdGhl: destSub,
        since,
      });
      return rows.map(indexRowToLookup);
    },
  };
}

export async function evaluateDuplicateRiskForIdentity(
  identity: LeadIdentitySnapshot,
  opts: {
    excludeLeadUid?: string | null;
    excludeEventUuid?: string | null;
    strictPossibleDuplicate?: boolean;
    priorLeadCreatedFound?: boolean;
  } = {}
): Promise<DuplicateRiskResult> {
  return evaluateDuplicateRisk({
    identity,
    excludeLeadUid: opts.excludeLeadUid,
    excludeEventUuid: opts.excludeEventUuid,
    strictPossibleDuplicate: opts.strictPossibleDuplicate,
    priorLeadCreatedFound: opts.priorLeadCreatedFound,
    lookup: buildLookupHandlers(identity),
  });
}

export async function evaluateAndPersistDuplicateRiskForRoutingDecision(opts: {
  routingDryRunDecisionId: string;
  masterClientAccountId: string;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  sourceEventUuid: string | null;
  sourceLeadUid: string;
  payload: LifecycleEventSchema;
  attribution?: RoutingAttributionInput | null;
  eventReceivedAt?: Date | null;
}): Promise<DuplicateRiskResult> {
  const identity = extractLeadIdentitySnapshot(opts.payload, {
    destinationClientAccountId: opts.destinationClientAccountId,
    destinationSubaccountIdGhl: opts.destinationSubaccountIdGhl,
    attribution: opts.attribution,
    eventReceivedAt: opts.eventReceivedAt,
  });

  const priorLeadCreatedFound = await hasPriorLeadCreatedForIdentity({
    clientAccountId: opts.destinationClientAccountId ?? opts.masterClientAccountId,
    subaccountIdGhl: opts.destinationSubaccountIdGhl ?? undefined,
    leadUid: identity.sa360LeadUid,
    phoneE164: identity.normalizedPhone,
    email: identity.normalizedEmail,
  });

  const result = await evaluateDuplicateRiskForIdentity(identity, {
    excludeLeadUid: opts.sourceLeadUid,
    excludeEventUuid: opts.sourceEventUuid,
    priorLeadCreatedFound,
  });

  await upsertDuplicateRiskForRoutingDecision(opts.routingDryRunDecisionId, {
    masterClientAccountId: opts.masterClientAccountId,
    destinationClientAccountId: opts.destinationClientAccountId,
    destinationSubaccountIdGhl: opts.destinationSubaccountIdGhl,
    sourceEventUuid: opts.sourceEventUuid,
    sourceLeadUid: opts.sourceLeadUid,
    identityStatus: result.identityStatus,
    riskLevel: result.riskLevel,
    confidence: result.confidence,
    recommendedAction: result.recommendedAction,
    reasons: result.reasons,
    candidateMatches: result.candidateMatches,
    normalizedPhone: identity.normalizedPhone,
    normalizedEmail: identity.normalizedEmail,
    facebookLeadId: identity.facebookLeadId,
    facebookSubmissionId: identity.facebookSubmissionId,
    firstName: identity.firstName,
    lastName: identity.lastName,
    fullName: identity.fullName,
    evaluatedAt: new Date(),
  });

  return result;
}

export async function evaluateOrphanAppointmentFromPayload(
  payload: LifecycleEventSchema,
  eventReceivedAt: Date = new Date()
): Promise<DuplicateRiskResult | null> {
  const eventName = payload.event.event_name_internal;
  if (
    ![
      "appointment_set",
      "appointment_confirmed",
      "appointment_showed",
      "appointment_no_show",
      "appointment_cancelled",
      "appointment_rescheduled",
    ].includes(eventName)
  ) {
    return null;
  }

  const identity = extractLeadIdentitySnapshot(payload, { eventReceivedAt });
  const priorLeadCreatedFound = await hasPriorLeadCreatedForIdentity({
    clientAccountId: payload.client_account_id,
    subaccountIdGhl: payload.subaccount_id_ghl,
    leadUid: identity.sa360LeadUid,
    phoneE164: identity.normalizedPhone,
    email: identity.normalizedEmail,
  });

  if (priorLeadCreatedFound) return null;

  const result = await evaluateDuplicateRiskForIdentity(identity, {
    excludeLeadUid: identity.sa360LeadUid,
    excludeEventUuid: payload.event.event_uuid,
    priorLeadCreatedFound: false,
  });

  if (result.identityStatus !== "orphan_appointment" && result.riskLevel === "none") {
    return result;
  }

  await createOrphanAppointmentAssessment({
    masterClientAccountId: payload.client_account_id,
    destinationClientAccountId: payload.client_account_id,
    destinationSubaccountIdGhl: payload.subaccount_id_ghl ?? "",
    sourceEventUuid: payload.event.event_uuid,
    sourceLeadUid: identity.sa360LeadUid,
    lifecycleEventId: null,
    identityStatus: "orphan_appointment",
    riskLevel: result.riskLevel === "none" ? "possible_duplicate" : result.riskLevel,
    confidence: result.confidence === "none" ? "medium" : result.confidence,
    recommendedAction: result.recommendedAction,
    reasons: result.reasons.length
      ? result.reasons
      : ["Self-booked appointment without matched upstream lead_created."],
    candidateMatches: result.candidateMatches,
    normalizedPhone: identity.normalizedPhone,
    normalizedEmail: identity.normalizedEmail,
    facebookLeadId: identity.facebookLeadId,
    facebookSubmissionId: identity.facebookSubmissionId,
    firstName: identity.firstName,
    lastName: identity.lastName,
    fullName: identity.fullName,
    evaluatedAt: eventReceivedAt,
  });

  return result;
}

export function presentDuplicateRiskAssessment(
  row: LeadDuplicateRiskAssessment
): DuplicateRiskAssessmentItem {
  const reasons = Array.isArray(row.reasons) ? (row.reasons as string[]) : [];
  const candidateMatches = Array.isArray(row.candidateMatches)
    ? (row.candidateMatches as DuplicateRiskAssessmentItem["candidateMatches"])
    : [];

  const base: DuplicateRiskResult = {
    riskLevel: row.riskLevel as DuplicateRiskResult["riskLevel"],
    confidence: row.confidence as DuplicateRiskResult["confidence"],
    reasons,
    candidateMatches,
    recommendedAction: row.recommendedAction ?? "",
    identityStatus: row.identityStatus as DuplicateRiskResult["identityStatus"],
    blocksLiveDelivery:
      row.riskLevel === "likely_duplicate" ||
      row.riskLevel === "source_duplicate" ||
      row.identityStatus === "orphan_appointment",
    isWarningOnly: row.riskLevel === "possible_duplicate",
  };

  const blocksLiveDelivery = applyOperatorOverrideToLiveBlock(
    base,
    row.operatorOverrideStatus
  );

  return {
    ...base,
    blocksLiveDelivery,
    id: row.id,
    masterClientAccountId: row.masterClientAccountId,
    destinationClientAccountId: row.destinationClientAccountId,
    destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
    sourceEventUuid: row.sourceEventUuid,
    sourceLeadUid: row.sourceLeadUid,
    routingDryRunDecisionId: row.routingDryRunDecisionId,
    leadDeliveryPlanId: row.leadDeliveryPlanId,
    operatorOverrideStatus: row.operatorOverrideStatus as OperatorOverrideStatus | null,
    operatorNotes: row.operatorNotes,
    operatorUpdatedAt: row.operatorUpdatedAt?.toISOString() ?? null,
    operatorUpdatedBy: row.operatorUpdatedBy,
    evaluatedAt: row.evaluatedAt.toISOString(),
    identitySnapshot: {
      sa360LeadUid: row.sourceLeadUid,
      masterContactIdGhl: null,
      clientContactIdGhl: null,
      facebookLeadId: row.facebookLeadId,
      facebookSubmissionId: row.facebookSubmissionId,
      appointmentId: null,
      normalizedPhone: row.normalizedPhone,
      normalizedEmail: row.normalizedEmail,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: row.fullName,
      clientAccountId: row.masterClientAccountId,
      destinationClientAccountId: row.destinationClientAccountId,
      destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
      campaignId: null,
      utmCampaign: null,
      nicheKey: null,
      sourceType: null,
      eventNameInternal: null,
      eventReceivedAt: row.evaluatedAt,
    },
  };
}

export async function getDuplicateRiskForRoutingDecision(
  routingDryRunDecisionId: string
): Promise<DuplicateRiskAssessmentItem | null> {
  const row = await findDuplicateRiskByRoutingDecisionId(routingDryRunDecisionId);
  if (!row) return null;
  return presentDuplicateRiskAssessment(row);
}

export async function patchDuplicateRiskOperatorReview(
  assessmentId: string,
  body: {
    operatorOverrideStatus: OperatorOverrideStatus;
    operatorNotes?: string | null;
    operatorUpdatedBy?: string | null;
  }
): Promise<DuplicateRiskAssessmentItem | null> {
  const identityStatus =
    body.operatorOverrideStatus === "same_person"
      ? "linked"
      : body.operatorOverrideStatus === "separate_person"
        ? "separate_person"
        : "ignored_test";

  const row = await updateDuplicateRiskOperatorStatus(assessmentId, {
    operatorOverrideStatus: body.operatorOverrideStatus,
    operatorNotes: body.operatorNotes,
    operatorUpdatedBy: body.operatorUpdatedBy,
    identityStatus,
  });
  if (!row) return null;
  return presentDuplicateRiskAssessment(row);
}

export function mergeDuplicateRiskIntoReadiness<T extends {
  canDeliverLive: boolean;
  blockers: string[];
  warnings: string[];
}>(
  assessment: DuplicateRiskAssessmentItem | null | undefined,
  readiness: T
): T {
  if (!assessment) return readiness;
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];
  const warnings = Array.isArray(readiness.warnings) ? readiness.warnings : [];
  if (!assessment.blocksLiveDelivery) {
    if (assessment.isWarningOnly) {
      return {
        ...readiness,
        warnings: [
          ...warnings,
          `Duplicate risk (${assessment.riskLevel}): ${assessment.recommendedAction}`,
        ],
      };
    }
    return readiness;
  }
  return {
    ...readiness,
    canDeliverLive: false,
    blockers: [
      ...blockers,
      `Duplicate risk (${assessment.riskLevel}) blocks live delivery: ${assessment.recommendedAction}`,
    ],
  };
}
