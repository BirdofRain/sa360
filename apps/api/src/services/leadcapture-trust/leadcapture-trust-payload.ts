import type { Prisma } from "@prisma/client";

import type { LeadCaptureDataApiLeadRecord } from "../leadcapture-data-api/leadcapture-data-api.types.js";
import type { LeadCaptureTrustPacket } from "../leadcapture-data-api/leadcapture-trust-packet.js";

const CONTACT_PII_KEYS = new Set([
  "email",
  "phone",
  "phone_number",
  "phone_raw",
  "phone_e164",
  "name",
  "first_name",
  "last_name",
  "full_name",
  "address",
  "street",
  "city",
  "zip",
  "zip_code",
  "postal_code",
  "ssn",
  "dob",
  "date_of_birth",
]);

const TRUST_ANSWER_KEY_PATTERN =
  /(consent|tcpa|disclosure|compliance|verification|trustedform|verfi|jornaya|leadproof|integrity)/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function extractCanonicalTrustAnswers(record: LeadCaptureDataApiLeadRecord): Record<string, string> {
  const answers: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    if (key.endsWith("_question")) continue;
    if (CONTACT_PII_KEYS.has(key.toLowerCase())) continue;
    const questionKey = `${key}_question`;
    const question = readString(record[questionKey]);
    const answer = readString(value) ?? (typeof value === "boolean" ? String(value) : null);
    if (question && answer && TRUST_ANSWER_KEY_PATTERN.test(`${key}|${question}`)) {
      answers[question] = answer;
    }
  }

  const nestedAnswers = asRecord(record.answers);
  if (nestedAnswers) {
    for (const [key, value] of Object.entries(nestedAnswers)) {
      if (CONTACT_PII_KEYS.has(key.toLowerCase())) continue;
      const answer = readString(value) ?? (typeof value === "boolean" ? String(value) : null);
      if (answer && TRUST_ANSWER_KEY_PATTERN.test(key)) {
        answers[key] = answer;
      }
    }
  }

  return answers;
}

export function buildRestrictedTrustVaultPayload(input: {
  packet: LeadCaptureTrustPacket;
  record: LeadCaptureDataApiLeadRecord;
  integrityHash: string | null;
}): Prisma.InputJsonObject {
  return {
    provider: "leadcapture_io",
    provider_lead_id: input.packet.identity.providerLeadId,
    provider_submission_id: input.packet.identity.providerSubmissionId,
    provider_campaign_id: input.packet.identity.providerCampaignId,
    provider_form_id: input.packet.identity.providerFormId,
    external_event_id: input.packet.correlation.externalEventId,
    disclosure_text: input.packet.trustEvidence.disclosureText,
    disclosure_version: input.packet.trustEvidence.disclosureVersion,
    disclosure_accepted: input.packet.trustEvidence.disclosureAccepted,
    consent_timestamp: input.packet.trustEvidence.consentTimestamp?.toISOString() ?? null,
    submission_timestamp: input.packet.trustEvidence.submissionTimestamp?.toISOString() ?? null,
    source_url: input.packet.trustEvidence.sourceUrl,
    ip_address: input.packet.trustEvidence.ipAddress,
    user_agent: input.packet.trustEvidence.userAgent,
    certificate_id: input.packet.trustEvidence.certificateId,
    certificate_provider: input.packet.trustEvidence.certificateProvider,
    integrity_hash: input.integrityHash,
    provider_verification_status: input.packet.trustEvidence.providerVerificationStatus,
    provider_version: input.packet.integrity.providerVersion,
    source_updated_at: input.packet.integrity.sourceUpdatedAt?.toISOString() ?? null,
    trust_answers: extractCanonicalTrustAnswers(input.record),
    content_hash: input.packet.integrity.contentHash,
  } as Prisma.InputJsonObject;
}

const NESTED_PII_CONTAINER_KEYS = new Set(["contact", "applicant", "session", "metadata"]);

function isPiiKey(key: string): boolean {
  const lowerKey = key.toLowerCase();
  if (CONTACT_PII_KEYS.has(lowerKey)) return true;
  if (lowerKey.endsWith("_email") || lowerKey.endsWith("_phone")) return true;
  if (lowerKey.includes("email") || lowerKey.includes("phone")) return true;
  return false;
}

function redactValue(key: string, value: unknown): unknown {
  const lowerKey = key.toLowerCase();
  if (NESTED_PII_CONTAINER_KEYS.has(lowerKey)) return undefined;
  if (isPiiKey(lowerKey)) return undefined;
  if (lowerKey.includes("disclosure") || lowerKey.includes("consent_text") || lowerKey === "tcpa_consent_text") {
    return undefined;
  }
  if (lowerKey === "ip_address" || lowerKey === "ip" || lowerKey === "user_agent" || lowerKey === "useragent") {
    return undefined;
  }
  if (lowerKey === "deliveries" && Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item !== "object" || item === null) return item;
      const delivery = item as Record<string, unknown>;
      const redactedDelivery: Record<string, unknown> = {};
      for (const [deliveryKey, deliveryValue] of Object.entries(delivery)) {
        const next =
          deliveryKey === "response"
            ? redactObject(asRecord(deliveryValue) ?? {})
            : redactValue(deliveryKey, deliveryValue);
        if (next !== undefined) redactedDelivery[deliveryKey] = next;
      }
      return redactedDelivery;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "object" && item !== null ? redactObject(item as Record<string, unknown>) : item));
  }
  if (typeof value === "object" && value !== null) {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = redactValue(key, child);
    if (next !== undefined) redacted[key] = next;
  }
  return redacted;
}

export function redactProviderRecordForAdminSummary(record: Record<string, unknown>): Record<string, unknown> {
  return redactObject(record);
}

export function containsRawPii(value: unknown): boolean {
  const serialized = JSON.stringify(value).toLowerCase();
  return (
    serialized.includes("@example.com") ||
    serialized.includes("+1555") ||
    serialized.includes("redacted@") ||
    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(serialized) ||
    /\+1\d{10}/.test(serialized)
  );
}

export function containsPlaceholderEvidence(value: unknown): boolean {
  const serialized = JSON.stringify(value);
  return serialized.includes("[RESTRICTED]") || serialized.includes("[REDACTED]");
}
