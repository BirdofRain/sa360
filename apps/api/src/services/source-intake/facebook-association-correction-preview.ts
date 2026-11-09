import { createHash } from "node:crypto";

/**
 * Read-only association-correction eligibility.
 * The preview id and digest describe a snapshot. They do not authorize a write.
 */

export const CORRECTION_PREVIEW_DECISIONS = ["eligible", "blocked", "excluded"] as const;
export type CorrectionPreviewDecision = (typeof CORRECTION_PREVIEW_DECISIONS)[number];

export const CORRECTION_PREVIEW_FILTERS = ["all", ...CORRECTION_PREVIEW_DECISIONS] as const;
export type CorrectionPreviewFilter = (typeof CORRECTION_PREVIEW_FILTERS)[number];

export const ALLOW_LIST_MAX = 100;
export const CANDIDATE_LIMIT = 500;
export const PREVIEW_TTL_MS = 15 * 60 * 1000;

const BLOCKERS = [
  "not_facebook_capture",
  "form_identity_mismatch",
  "funnel_mismatch",
  "ambiguous_owner",
  "not_capture_settled",
  "status_not_capture_settled",
  "outcome_not_unassociated",
  "client_already_resolved",
  "campaign_scope_present",
  "identity_less_excluded",
  "duplicate_canonical_identity",
  "settled_after_confirmation",
  "routing_decision_present",
  "delivery_timestamp_present",
  "fulfillment_relation_present",
  "sheets_relation_present",
  "ghl_outbox_present",
  "allocation_present",
  "onboarding_reference_present",
  "fulfillment_audit_present",
  "meta_dispatch_present",
  "bulk_import_reference",
  "already_reevaluated",
  "cleanup_marked",
  "relation_unverified",
] as const;

export type CorrectionBlocker = (typeof BLOCKERS)[number];

const INFORMATIONAL = [
  "intake_receipt",
  "delivery_not_recorded",
  "funnel_touched_after_confirmation",
] as const;

export type CorrectionInformational = (typeof INFORMATIONAL)[number];

const TERMINAL_DELIVERY_STATUSES = new Set([
  "delivered",
  "approved",
  "delivery_failed",
  "rejected",
]);

const QUIET_DELIVERY_OUTCOMES = new Set(["not_recorded", "not_attempted"]);

export type RelationFlags = {
  fulfillmentOutbox: boolean;
  allocation: boolean;
  inventory: boolean;
  eligibilityAssessment: boolean;
  deliveryNotification: boolean;
  buyerDeliveredIdentity: boolean;
  operatorReview: boolean;
  externalReceipt: boolean;
  exportViaAllocation: boolean;
  sheetsDeliveryJob: boolean;
  sheetsDispatchIntent: boolean;
  sheetsAdmission: boolean;
  sheetsDedupe: boolean;
  sheetsRelease: boolean;
  ghlOutbox: boolean;
  onboardingTest: boolean;
  onboardingAudit: boolean;
  verificationAudit: boolean;
  proofAudit: boolean;
  trustSyncAudit: boolean;
  checkpointAudit: boolean;
  bulkImport: boolean;
  routingDecision: boolean;
  deliveryPlan: boolean;
  duplicateRiskAssessment: boolean;
  lifecycleEvent: boolean;
  metaDispatch: boolean;
  failedDispatch: boolean;
  webhookLog: boolean;
};

export type AuditSummary = {
  count: number;
  lastAction: string | null;
  lastTimestamp: string | null;
  reevaluated: boolean;
  unverified: boolean;
};

export type CorrectionCandidate = {
  sourceEventId: string;
  sourceProvider: string;
  sourceSystem: string;
  pageId: string | null;
  formId: string | null;
  sourceLeadIdentityPresent: boolean;
  sourceLeadIdentityFingerprint: string;
  sourceLeadUidPresent: boolean;
  duplicateCanonical: boolean;
  captureOnly: boolean;
  captureSettled: boolean;
  status: string;
  storedAssociationOutcome: string | null;
  clientResolved: boolean;
  campaignPresent: boolean;
  receivedAt: string | null;
  normalizedAt: string | null;
  updatedAt: string;
  routingOnEvent: boolean;
  deliveryOnEvent: boolean;
  relationFlags: RelationFlags;
  audit: AuditSummary;
  cleanupMarked: boolean;
  intakeReceipt: boolean;
  deliveryQuiet: boolean;
};

export type CohortEvaluation = {
  matches: boolean;
  ambiguous: boolean;
  reasons: CorrectionBlocker[];
  informational: CorrectionInformational[];
  funnelCreatedAt: string | null;
  funnelUpdatedAt: string | null;
  funnelTouchedAfterConfirmation: boolean;
  confirmedAtVersusFunnelCreatedAt: "before" | "equal" | "after" | "unknown";
};

export type ClassifiedCorrectionEvent = {
  sourceEventId: string;
  eligible: boolean;
  decision: CorrectionPreviewDecision;
  blockingReasons: string[];
  informationalReferences: string[];
  status: string;
  storedAssociationOutcome: string | null;
  clientAccountIdResolved: true | null;
  campaignIdPresent: boolean;
  sourceLeadIdentity: { present: boolean; fingerprintPrefix: string };
  receivedAt: string | null;
  normalizedAt: string | null;
  updatedAt: string;
  captureOnly: boolean;
  captureSettled: boolean;
  relationFlags: RelationFlags;
  auditSummary: { count: number; lastAction: string | null; lastTimestamp: string | null };
  fingerprint: string;
};

const SENSITIVE_KEYS = new Set([
  "rawpayloadjson",
  "normalizedpayloadjson",
  "email",
  "phone",
  "leadname",
  "sourceleadid",
  "token",
  "accesstoken",
  "password",
  "secret",
  "firstname",
  "lastname",
  "credential",
  "credentials",
  "attributionsnapshot",
  "requestbodyredacted",
]);

export function emptyRelationFlags(): RelationFlags {
  return {
    fulfillmentOutbox: false,
    allocation: false,
    inventory: false,
    eligibilityAssessment: false,
    deliveryNotification: false,
    buyerDeliveredIdentity: false,
    operatorReview: false,
    externalReceipt: false,
    exportViaAllocation: false,
    sheetsDeliveryJob: false,
    sheetsDispatchIntent: false,
    sheetsAdmission: false,
    sheetsDedupe: false,
    sheetsRelease: false,
    ghlOutbox: false,
    onboardingTest: false,
    onboardingAudit: false,
    verificationAudit: false,
    proofAudit: false,
    trustSyncAudit: false,
    checkpointAudit: false,
    bulkImport: false,
    routingDecision: false,
    deliveryPlan: false,
    duplicateRiskAssessment: false,
    lifecycleEvent: false,
    metaDispatch: false,
    failedDispatch: false,
    webhookLog: false,
  };
}

export function identityFingerprintPrefix(sourceLeadId: string | null | undefined): string {
  const trimmed = sourceLeadId?.trim() ?? "";
  if (!trimmed) return "";
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 12);
}

export function evaluateCohort(input: {
  funnel: {
    provider: string;
    providerFunnelId: string | null;
    associationStatus: string;
    originClientAccountId: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  expectedProviderFunnelId: string;
  originClientAccountId: string;
  confirmedAt: Date;
  otherConfirmedOriginCount: number;
}): CohortEvaluation {
  const reasons: CorrectionBlocker[] = [];
  const funnel = input.funnel;
  const matches = Boolean(
    funnel &&
      funnel.provider === "facebook" &&
      funnel.providerFunnelId === input.expectedProviderFunnelId &&
      funnel.associationStatus === "confirmed" &&
      funnel.originClientAccountId === input.originClientAccountId
  );
  if (!matches) reasons.push("funnel_mismatch");
  if (input.otherConfirmedOriginCount > 0) reasons.push("ambiguous_owner");

  const funnelCreatedAt = funnel ? funnel.createdAt.toISOString() : null;
  const funnelUpdatedAt = funnel ? funnel.updatedAt.toISOString() : null;
  const confirmedAtMs = input.confirmedAt.getTime();
  let confirmedAtVersusFunnelCreatedAt: CohortEvaluation["confirmedAtVersusFunnelCreatedAt"] = "unknown";
  if (funnel) {
    const createdMs = funnel.createdAt.getTime();
    if (confirmedAtMs < createdMs) confirmedAtVersusFunnelCreatedAt = "before";
    else if (confirmedAtMs > createdMs) confirmedAtVersusFunnelCreatedAt = "after";
    else confirmedAtVersusFunnelCreatedAt = "equal";
  }
  const funnelTouchedAfterConfirmation = Boolean(funnel && funnel.updatedAt.getTime() > confirmedAtMs);
  const informational: CorrectionInformational[] = [];
  if (funnelTouchedAfterConfirmation) informational.push("funnel_touched_after_confirmation");

  return {
    matches,
    ambiguous: input.otherConfirmedOriginCount > 0,
    reasons,
    informational,
    funnelCreatedAt,
    funnelUpdatedAt,
    funnelTouchedAfterConfirmation,
    confirmedAtVersusFunnelCreatedAt,
  };
}

function relationBlockers(flags: RelationFlags): CorrectionBlocker[] {
  const reasons: CorrectionBlocker[] = [];
  if (
    flags.fulfillmentOutbox ||
    flags.allocation ||
    flags.inventory ||
    flags.eligibilityAssessment ||
    flags.deliveryNotification ||
    flags.buyerDeliveredIdentity ||
    flags.operatorReview ||
    flags.externalReceipt
  ) {
    reasons.push("fulfillment_relation_present");
  }
  if (flags.allocation) reasons.push("allocation_present");
  if (
    flags.sheetsDeliveryJob ||
    flags.sheetsDispatchIntent ||
    flags.sheetsAdmission ||
    flags.sheetsDedupe ||
    flags.sheetsRelease
  ) {
    reasons.push("sheets_relation_present");
  }
  if (flags.ghlOutbox) reasons.push("ghl_outbox_present");
  if (flags.onboardingTest || flags.onboardingAudit) reasons.push("onboarding_reference_present");
  if (flags.verificationAudit || flags.proofAudit || flags.trustSyncAudit || flags.checkpointAudit) {
    reasons.push("fulfillment_audit_present");
  }
  if (flags.bulkImport) reasons.push("bulk_import_reference");
  if (flags.routingDecision || flags.duplicateRiskAssessment) reasons.push("routing_decision_present");
  if (flags.lifecycleEvent || flags.metaDispatch || flags.failedDispatch) reasons.push("meta_dispatch_present");
  return reasons;
}

export function classifyCorrectionCandidate(
  candidate: CorrectionCandidate,
  input: { pageId: string; formId: string; confirmedAt: Date; cohortReasons: CorrectionBlocker[] }
): ClassifiedCorrectionEvent {
  const blockers = new Set<CorrectionBlocker>(input.cohortReasons);
  if (candidate.sourceProvider !== "facebook" || candidate.sourceSystem !== "meta_lead_ads") {
    blockers.add("not_facebook_capture");
  }
  if (candidate.pageId !== input.pageId || candidate.formId !== input.formId) {
    blockers.add("form_identity_mismatch");
  }
  if (!candidate.captureOnly || !candidate.captureSettled) blockers.add("not_capture_settled");
  if (candidate.status !== "normalized") blockers.add("status_not_capture_settled");
  if (candidate.storedAssociationOutcome !== "unassociated") blockers.add("outcome_not_unassociated");
  if (candidate.clientResolved) blockers.add("client_already_resolved");
  if (candidate.campaignPresent) blockers.add("campaign_scope_present");
  if (!candidate.sourceLeadIdentityPresent) blockers.add("identity_less_excluded");
  else if (candidate.duplicateCanonical) blockers.add("duplicate_canonical_identity");
  const receivedMs = candidate.receivedAt ? Date.parse(candidate.receivedAt) : Number.NaN;
  const normalizedMs = candidate.normalizedAt ? Date.parse(candidate.normalizedAt) : Number.NaN;
  if (
    !Number.isFinite(receivedMs) ||
    !Number.isFinite(normalizedMs) ||
    receivedMs >= input.confirmedAt.getTime() ||
    normalizedMs >= input.confirmedAt.getTime()
  ) {
    blockers.add("settled_after_confirmation");
  }
  if (candidate.routingOnEvent || candidate.relationFlags.routingDecision || candidate.relationFlags.duplicateRiskAssessment) {
    blockers.add("routing_decision_present");
  }
  if (candidate.deliveryOnEvent || candidate.relationFlags.deliveryPlan) blockers.add("delivery_timestamp_present");
  if (TERMINAL_DELIVERY_STATUSES.has(candidate.status)) blockers.add("delivery_timestamp_present");
  for (const reason of relationBlockers(candidate.relationFlags)) blockers.add(reason);
  if (candidate.audit.reevaluated) blockers.add("already_reevaluated");
  if (candidate.audit.unverified) blockers.add("relation_unverified");
  if (candidate.cleanupMarked) blockers.add("cleanup_marked");
  if (!candidate.sourceLeadUidPresent) blockers.add("relation_unverified");

  const informational = new Set<CorrectionInformational>();
  if (candidate.intakeReceipt || candidate.relationFlags.webhookLog) informational.add("intake_receipt");
  if (candidate.deliveryQuiet && !blockers.has("delivery_timestamp_present")) {
    informational.add("delivery_not_recorded");
  }

  const blockingReasons = [...blockers].sort();
  const decision: CorrectionPreviewDecision = blockers.has("identity_less_excluded")
    ? "excluded"
    : blockingReasons.length > 0
      ? "blocked"
      : "eligible";
  const relationFlags = { ...candidate.relationFlags, exportViaAllocation: candidate.relationFlags.allocation };
  const classified: ClassifiedCorrectionEvent = {
    sourceEventId: candidate.sourceEventId,
    eligible: decision === "eligible",
    decision,
    blockingReasons,
    informationalReferences: [...informational].sort(),
    status: candidate.status,
    storedAssociationOutcome: candidate.storedAssociationOutcome,
    clientAccountIdResolved: candidate.clientResolved ? true : null,
    campaignIdPresent: candidate.campaignPresent,
    sourceLeadIdentity: {
      present: candidate.sourceLeadIdentityPresent,
      fingerprintPrefix: candidate.sourceLeadIdentityFingerprint,
    },
    receivedAt: candidate.receivedAt,
    normalizedAt: candidate.normalizedAt,
    updatedAt: candidate.updatedAt,
    captureOnly: candidate.captureOnly,
    captureSettled: candidate.captureSettled,
    relationFlags,
    auditSummary: {
      count: candidate.audit.count,
      lastAction: candidate.audit.lastAction,
      lastTimestamp: candidate.audit.lastTimestamp,
    },
    fingerprint: "",
  };
  classified.fingerprint = eventFingerprint(classified);
  return classified;
}

function eventFingerprint(event: ClassifiedCorrectionEvent): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        auditCount: event.auditSummary.count,
        decision: event.decision,
        id: event.sourceEventId,
        lastAction: event.auditSummary.lastAction,
        normalizedAt: event.normalizedAt,
        outcome: event.storedAssociationOutcome,
        reasons: event.blockingReasons,
        receivedAt: event.receivedAt,
        relations: event.relationFlags,
        updatedAt: event.updatedAt,
      })
    )
    .digest("hex")
    .slice(0, 16);
}

export function correctionPreviewDigest(input: {
  sourceFunnelId: string;
  originClientAccountId: string;
  pageId: string;
  formId: string;
  confirmedAt: string;
  eligible: Array<{ sourceEventId: string; fingerprint: string }>;
}): string {
  const eligible = [...input.eligible].sort((a, b) => a.sourceEventId.localeCompare(b.sourceEventId));
  return createHash("sha256")
    .update(
      canonicalJson({
        cohort: {
          confirmedAt: input.confirmedAt,
          formId: input.formId,
          originClientAccountId: input.originClientAccountId,
          pageId: input.pageId,
          sourceFunnelId: input.sourceFunnelId,
        },
        eligible,
        v: 1,
      })
    )
    .digest("hex");
}

export type CorrectionPreviewResponse = {
  ok: true;
  readOnly: true;
  writesPerformed: false;
  correctionEnabled: false;
  cohort: {
    sourceFunnelId: string;
    pageId: string;
    formId: string;
    originClientAccountId: string;
    providerFunnelId: string;
    confirmedAt: string;
    funnelCreatedAt: string | null;
    funnelUpdatedAt: string | null;
    funnelTouchedAfterConfirmation: boolean;
    confirmedAtVersusFunnelCreatedAt: CohortEvaluation["confirmedAtVersusFunnelCreatedAt"];
    informationalReferences: string[];
    provenance: {
      confirmedAtSource: "operator_supplied_cutoff";
      provesHistoricalOwnership: false;
      authorizesCorrection: false;
      statement: string;
    };
  };
  verification: { complete: boolean; code: "candidate_limit_exceeded" | null };
  preview: {
    previewId: string;
    digest: string;
    issuedAt: string;
    expiresAt: string;
    eligibleCount: number;
    blockedCount: number;
    excludedCount: number;
    authorizesExecution: false;
  };
  allowList: string[];
  events: {
    items: Array<Omit<ClassifiedCorrectionEvent, "fingerprint">>;
    total: number;
    limit: number;
    offset: number;
  };
};

const PROVENANCE_STATEMENT =
  "confirmedAt is an operator-supplied investigation cutoff. SourceFunnel has no stored confirmation timestamp. This preview compares that cutoff with the row clocks and with each event. It does not prove historical ownership and does not authorize a correction.";

export function assembleCorrectionPreview(input: {
  sourceFunnelId: string;
  pageId: string;
  formId: string;
  originClientAccountId: string;
  providerFunnelId: string;
  confirmedAt: string;
  cohort: CohortEvaluation;
  events: ClassifiedCorrectionEvent[];
  verificationCode: "candidate_limit_exceeded" | null;
  decision: CorrectionPreviewFilter;
  limit: number;
  offset: number;
  includeAllowList: boolean;
  issuedAt: Date;
}): CorrectionPreviewResponse {
  const complete = input.verificationCode === null;
  const events = complete ? input.events : [];
  const eligible = events.filter((event) => event.decision === "eligible");
  const blockedCount = events.filter((event) => event.decision === "blocked").length;
  const excludedCount = events.filter((event) => event.decision === "excluded").length;
  const digest = correctionPreviewDigest({
    sourceFunnelId: input.sourceFunnelId,
    originClientAccountId: input.originClientAccountId,
    pageId: input.pageId,
    formId: input.formId,
    confirmedAt: input.confirmedAt,
    eligible: complete ? eligible.map((event) => ({ sourceEventId: event.sourceEventId, fingerprint: event.fingerprint })) : [],
  });
  const issuedAt = input.issuedAt.toISOString();
  const filtered = events.filter((event) => input.decision === "all" || event.decision === input.decision);
  const page = filtered.slice(input.offset, input.offset + input.limit).map(presentEvent);
  const allowList =
    complete && input.includeAllowList && eligible.length <= ALLOW_LIST_MAX
      ? eligible.map((event) => event.sourceEventId).sort()
      : [];
  return {
    ok: true,
    readOnly: true,
    writesPerformed: false,
    correctionEnabled: false,
    cohort: {
      sourceFunnelId: input.sourceFunnelId,
      pageId: input.pageId,
      formId: input.formId,
      originClientAccountId: input.originClientAccountId,
      providerFunnelId: input.providerFunnelId,
      confirmedAt: input.confirmedAt,
      funnelCreatedAt: input.cohort.funnelCreatedAt,
      funnelUpdatedAt: input.cohort.funnelUpdatedAt,
      funnelTouchedAfterConfirmation: input.cohort.funnelTouchedAfterConfirmation,
      confirmedAtVersusFunnelCreatedAt: input.cohort.confirmedAtVersusFunnelCreatedAt,
      informationalReferences: input.cohort.informational,
      provenance: {
        confirmedAtSource: "operator_supplied_cutoff",
        provesHistoricalOwnership: false,
        authorizesCorrection: false,
        statement: PROVENANCE_STATEMENT,
      },
    },
    verification: { complete, code: input.verificationCode },
    preview: {
      previewId: `${digest.slice(0, 16)}.${input.issuedAt.getTime()}`,
      digest,
      issuedAt,
      expiresAt: new Date(input.issuedAt.getTime() + PREVIEW_TTL_MS).toISOString(),
      eligibleCount: eligible.length,
      blockedCount,
      excludedCount,
      authorizesExecution: false,
    },
    allowList,
    events: { items: page, total: filtered.length, limit: input.limit, offset: input.offset },
  };
}

function presentEvent(event: ClassifiedCorrectionEvent): Omit<ClassifiedCorrectionEvent, "fingerprint"> {
  const { fingerprint: _fingerprint, ...rest } = event;
  return rest;
}

export function assertPreviewHasNoSensitiveKeys(value: unknown): void {
  const found = findSensitiveKey(value);
  if (found) {
    throw new Error(`association_correction_preview_sensitive_key:${found}`);
  }
}

function findSensitiveKey(value: unknown, depth = 0): string | null {
  if (depth > 8 || !value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSensitiveKey(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) return key;
    const found = findSensitiveKey(entry, depth + 1);
    if (found) return found;
  }
  return null;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([key, entry]) => [key, sortValue(entry)]));
}

export function isQuietDelivery(attempted: string | null, historical: string | null): boolean {
  return attempted === "false" && (historical === null || QUIET_DELIVERY_OUTCOMES.has(historical));
}

export function isDeliveryMarker(input: {
  deliveredAt: boolean;
  approvedAt: boolean;
  deliveryResult: boolean;
  attempted: string | null;
  historical: string | null;
}): boolean {
  if (input.deliveredAt || input.approvedAt || input.deliveryResult) return true;
  if (input.attempted === "true") return true;
  if (input.historical && !QUIET_DELIVERY_OUTCOMES.has(input.historical)) return true;
  return false;
}
