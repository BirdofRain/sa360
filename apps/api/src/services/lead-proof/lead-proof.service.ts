import type {
  LeadDuplicateStatus,
  LeadProofStatus,
  LeadVerificationStatus,
  Prisma,
} from "@prisma/client";
import { inferDirectDemoSourceLane } from "../lead-delivery/direct-demo-delivery.present.js";
import type { ExtractedProofArtifact } from "./lead-proof-artifact.types.js";
import { extractProofArtifacts } from "./proof-artifact-extractor.service.js";
import { applyProofRequirementPolicy } from "./proof-requirement-policy.registry.js";

type JsonObject = Prisma.InputJsonObject;

export type LeadProofPacket = {
  leadUid: string;
  sourceLeadId: string | null;
  sourceLane: string | null;
  sourcePlatform: string | null;
  sourceType: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  adId: string | null;
  adName: string | null;
  formId: string | null;
  formName: string | null;
  landingPageUrl: string | null;
  referrerUrl: string | null;
  consentText: string | null;
  consentVersion: string | null;
  consentCapturedAt: Date | null;
  privacyPolicyVersion: string | null;
  termsVersion: string | null;
  submittedAt: Date | null;
  ipAddress: string | null;
  userAgent: string | null;
  phoneRaw: string | null;
  phoneE164: string | null;
  email: string | null;
  proofStatus: LeadProofStatus;
  proofMissingReasons: string[];
  rawSourcePayload: JsonObject;
};

export type LeadSourceSnapshotPacket = {
  leadUid: string;
  sourceLane: string | null;
  sourcePlatform: string | null;
  sourceType: string | null;
  sourceLeadId: string | null;
  sourceAttributes: JsonObject | null;
  routingAttributes: JsonObject | null;
  rawPayload: JsonObject;
  capturedAt: Date;
};

export type LeadVerificationSeedPacket = {
  leadUid: string;
  verificationStatus: LeadVerificationStatus;
  duplicateStatus: LeadDuplicateStatus;
  phoneStatus: string | null;
  emailStatus: string | null;
  suppressionStatus: string | null;
  qualityScore: number | null;
  reasons: string[];
  checkedAt: Date | null;
};

export type LeadProofExtractSuccess = {
  ok: true;
  proofPacket: LeadProofPacket;
  sourceSnapshot: LeadSourceSnapshotPacket;
  verificationSeed: LeadVerificationSeedPacket;
  missingProofFields: string[];
  extractedArtifacts: ExtractedProofArtifact[];
};

export type LeadProofExtractFailure = {
  ok: false;
  errorCode: "INVALID_PAYLOAD" | "MISSING_LEAD_UID";
  errorSummary: string;
};

export type LeadProofExtractResult = LeadProofExtractSuccess | LeadProofExtractFailure;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDate(value: unknown): Date | null {
  const str = readString(value);
  if (!str) return null;
  const ms = Date.parse(str);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = readString(value);
    if (str) return str;
  }
  return null;
}

function firstDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const date = readDate(value);
    if (date) return date;
  }
  return null;
}

function sourceAttributesFromPayload(root: JsonObject): JsonObject | null {
  const routing = asObject(root.routing);
  const sourceIntake = routing ? asObject(routing.source_intake) : null;
  const attrs = sourceIntake ? asObject(sourceIntake.sourceAttributes) : null;
  return attrs ?? null;
}

function routingAttributesFromPayload(root: JsonObject): JsonObject | null {
  const routing = asObject(root.routing);
  return routing ?? null;
}

function determineProofStatus(input: {
  sourceLane: string | null;
  criticalMissingFields: string[];
  hasAnyProofSignal: boolean;
}): LeadProofStatus {
  if (!input.hasAnyProofSignal) {
    return "UNREVIEWED";
  }
  if (input.criticalMissingFields.length === 0 && input.sourceLane && input.sourceLane !== "unknown") {
    return "PROOF_ATTACHED";
  }
  if (input.criticalMissingFields.length >= 2) {
    return "PROOF_MISSING";
  }
  return "NEEDS_REVIEW";
}

export function extractLeadProofPacket(payload: unknown): LeadProofExtractResult {
  const root = asObject(payload);
  if (!root) {
    return {
      ok: false,
      errorCode: "INVALID_PAYLOAD",
      errorSummary: "Expected object payload for proof extraction.",
    };
  }

  const contact = asObject(root.contact);
  const attribution = asObject(root.attribution);
  const routing = asObject(root.routing);
  const sourceAttrs = sourceAttributesFromPayload(root);
  const consent = asObject(root.consent) ?? asObject(sourceAttrs?.consent);
  const proof = asObject(root.proof) ?? asObject(sourceAttrs?.proof);
  const lane = inferDirectDemoSourceLane(root);

  const leadUid = firstString(
    contact?.lead_uid,
    root.lead_uid,
    root.leadUid,
    sourceAttrs?.lead_uid,
    sourceAttrs?.leadUid
  );
  if (!leadUid) {
    return {
      ok: false,
      errorCode: "MISSING_LEAD_UID",
      errorSummary: "leadUid is required to persist proof packet records.",
    };
  }

  const sourceLeadId = firstString(
    root.source_lead_id,
    root.sourceLeadId,
    contact?.source_lead_id,
    attribution?.source_lead_id,
    sourceAttrs?.source_lead_id,
    sourceAttrs?.sourceLeadId
  );

  const sourcePlatform = firstString(
    attribution?.source_platform,
    attribution?.sourcePlatform,
    sourceAttrs?.source_platform,
    sourceAttrs?.sourcePlatform
  );
  const sourceType = firstString(
    attribution?.source_type,
    attribution?.sourceType,
    sourceAttrs?.source_type,
    sourceAttrs?.sourceType
  );

  const packetBase = {
    leadUid,
    sourceLeadId,
    sourceLane: lane.sourceLane,
    sourcePlatform,
    sourceType,
    campaignId: firstString(attribution?.campaign_id, sourceAttrs?.campaign_id),
    campaignName: firstString(attribution?.campaign_name, sourceAttrs?.campaign_name),
    adsetId: firstString(attribution?.adset_id, sourceAttrs?.adset_id),
    adsetName: firstString(attribution?.adset_name, sourceAttrs?.adset_name),
    adId: firstString(attribution?.ad_id, sourceAttrs?.ad_id),
    adName: firstString(attribution?.ad_name, sourceAttrs?.ad_name),
    formId: firstString(
      attribution?.form_id,
      routing?.form_id,
      routing?.lead_form_id,
      sourceAttrs?.form_id
    ),
    formName: firstString(attribution?.form_name, sourceAttrs?.form_name),
    landingPageUrl: firstString(
      root.landing_page_url,
      root.landingPageUrl,
      sourceAttrs?.landing_page_url,
      sourceAttrs?.landingPageUrl
    ),
    referrerUrl: firstString(
      root.referrer_url,
      root.referrerUrl,
      sourceAttrs?.referrer_url,
      sourceAttrs?.referrerUrl
    ),
    consentText: firstString(
      consent?.consent_text,
      consent?.consentText,
      root.consent_text,
      root.consentText,
      sourceAttrs?.consent_text,
      sourceAttrs?.consentText,
      proof?.consent_text,
      proof?.consentText
    ),
    consentVersion: firstString(
      consent?.consent_version,
      consent?.consentVersion,
      root.consent_version,
      root.consentVersion,
      sourceAttrs?.consent_version,
      sourceAttrs?.consentVersion
    ),
    consentCapturedAt: firstDate(
      consent?.captured_at,
      consent?.capturedAt,
      root.consent_captured_at,
      root.consentCapturedAt
    ),
    privacyPolicyVersion: firstString(
      consent?.privacy_policy_version,
      consent?.privacyPolicyVersion,
      root.privacy_policy_version,
      root.privacyPolicyVersion,
      sourceAttrs?.privacy_policy_version
    ),
    termsVersion: firstString(
      consent?.terms_version,
      consent?.termsVersion,
      root.terms_version,
      root.termsVersion,
      sourceAttrs?.terms_version
    ),
    submittedAt: firstDate(
      root.submitted_at,
      root.submittedAt,
      sourceAttrs?.submitted_at,
      sourceAttrs?.submittedAt
    ),
    ipAddress: firstString(root.ip_address, root.ipAddress, sourceAttrs?.ip_address, sourceAttrs?.ipAddress),
    userAgent: firstString(root.user_agent, root.userAgent, sourceAttrs?.user_agent, sourceAttrs?.userAgent),
    phoneRaw: firstString(contact?.phone, contact?.phone_digits, root.phone, sourceAttrs?.phone),
    phoneE164: firstString(contact?.phone_e164, root.phone_e164, sourceAttrs?.phone_e164),
    email: firstString(contact?.email, root.email, sourceAttrs?.email),
  };

  const missingProofFields: string[] = [];
  const criticalFields: Array<{ key: string; value: string | Date | null }> = [
    { key: "consentText", value: packetBase.consentText },
    { key: "consentVersion", value: packetBase.consentVersion },
    { key: "submittedAt", value: packetBase.submittedAt },
  ];
  for (const field of criticalFields) {
    if (!field.value) missingProofFields.push(field.key);
  }
  if (!packetBase.sourceLeadId) missingProofFields.push("sourceLeadId");
  if (!packetBase.sourcePlatform) missingProofFields.push("sourcePlatform");
  if (!packetBase.sourceType) missingProofFields.push("sourceType");
  if (!packetBase.formId && !packetBase.formName) missingProofFields.push("formReference");

  const hasAnyProofSignal = Boolean(
    packetBase.sourceLeadId ||
      packetBase.sourcePlatform ||
      packetBase.sourceType ||
      packetBase.consentText ||
      packetBase.consentVersion ||
      packetBase.submittedAt ||
      packetBase.ipAddress ||
      packetBase.userAgent ||
      packetBase.phoneE164 ||
      packetBase.email
  );
  const proofStatus = determineProofStatus({
    sourceLane: packetBase.sourceLane,
    criticalMissingFields: criticalFields.filter((f) => !f.value).map((f) => f.key),
    hasAnyProofSignal,
  });

  let proofMissingReasons = missingProofFields.map(
    (field) => `${field} missing for compliance review readiness.`
  );
  if (packetBase.sourceLane === "unknown") {
    proofMissingReasons.push("source lane unknown; operator review required before sellable.");
  }
  const extractedArtifacts = extractProofArtifacts({
    payload: root,
    sourceLane: packetBase.sourceLane,
  });
  const policyAdjusted = applyProofRequirementPolicy({
    sourceLane: packetBase.sourceLane,
    baselineStatus: proofStatus,
    baselineMissingReasons: proofMissingReasons,
    baselineMissingFields: missingProofFields,
    extractedArtifacts,
  });
  const adjustedProofStatus = policyAdjusted.proofStatus;
  const adjustedMissingProofFields = [...new Set(policyAdjusted.missingProofFields)];
  proofMissingReasons = [...new Set(policyAdjusted.proofMissingReasons)];
  if (adjustedProofStatus !== "PROOF_ATTACHED") {
    proofMissingReasons.push("proof required before sellable.");
  }

  const now = new Date();
  return {
    ok: true,
    proofPacket: {
      ...packetBase,
      proofStatus: adjustedProofStatus,
      proofMissingReasons,
      rawSourcePayload: root,
    },
    sourceSnapshot: {
      leadUid,
      sourceLane: packetBase.sourceLane,
      sourcePlatform: packetBase.sourcePlatform,
      sourceType: packetBase.sourceType,
      sourceLeadId: packetBase.sourceLeadId,
      sourceAttributes: sourceAttrs,
      routingAttributes: routingAttributesFromPayload(root),
      rawPayload: root,
      capturedAt: now,
    },
    verificationSeed: {
      leadUid,
      verificationStatus: "UNCHECKED",
      duplicateStatus: "UNCHECKED",
      phoneStatus: null,
      emailStatus: null,
      suppressionStatus: null,
      qualityScore: null,
      reasons:
        proofStatus === "PROOF_ATTACHED"
          ? []
          : ["verification status pending while proof packet is incomplete."],
      checkedAt: null,
    },
    missingProofFields: adjustedMissingProofFields,
    extractedArtifacts,
  };
}
