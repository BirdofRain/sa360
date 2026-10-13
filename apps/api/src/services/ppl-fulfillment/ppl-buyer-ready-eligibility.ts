/**
 * PPL buyer-ready eligibility — delivery-quality rules applied before reservation.
 *
 * A candidate must not count toward requested/reserved quantity unless it
 * satisfies the current delivery-quality policy.
 *
 * Consumer age is REQUIRED for commercial life-insurance fulfillment. A lead
 * with no resolvable age, an unusable age, or a resolved age above
 * MAX_SELLABLE_CONSUMER_AGE is not buyer ready. This supersedes the temporary
 * policy that made missing consumer age informational only.
 *
 * Age is resolved by the canonical resolver, so an explicit age that still only
 * lives in rawPayloadJson / metadataJson / enrichmentMetadataJson counts.
 * generatedAt, lead age, commerce age buckets, and submission dates are never
 * consumer-age inputs.
 *
 * Commercial aged Trucker/Veteran fulfillment also requires a structurally
 * valid US NANP phone. Digits are never padded, truncated, guessed, or invented.
 *
 * Name field precedence matches the buyer CSV extractors. Digits in a name
 * are automatic rejections. Placeholders and suspicious tokens are flagged
 * for operator review and do not reject a short-but-legitimate name.
 */

import { isSupportedAgedCommerceNiche } from "@sa360/shared";

import { tryNormalizeStrictUsNanpE164 } from "../phone-e164.service.js";
import {
  resolveConsumerAgeForFulfillment,
  type ResolvedConsumerAge,
} from "../consumer-age/consumer-age-policy.js";

export type PplBuyerReadyPhoneRejectionReason =
  | "phone_missing"
  | "phone_truncated"
  | "phone_overlong"
  | "phone_structurally_invalid";

export type PplBuyerReadyRejectionReason =
  | "first_name_too_short"
  | "last_name_too_short"
  | "first_name_multipart"
  | "last_name_multipart"
  | "first_name_has_digits"
  | "last_name_has_digits"
  | PplBuyerReadyPhoneRejectionReason
  | "consumer_age_missing"
  | "consumer_age_invalid"
  | "consumer_age_over_maximum";

export type PplNameReviewFlag =
  | "placeholder_first_name"
  | "placeholder_last_name"
  | "suspicious_first_name"
  | "suspicious_last_name";

export const PPL_BUYER_READY_AGE_REJECTION_REASONS = [
  "consumer_age_missing",
  "consumer_age_invalid",
  "consumer_age_over_maximum",
] as const satisfies readonly PplBuyerReadyRejectionReason[];

export const PPL_BUYER_READY_PHONE_REJECTION_REASONS = [
  "phone_missing",
  "phone_truncated",
  "phone_overlong",
  "phone_structurally_invalid",
] as const satisfies readonly PplBuyerReadyRejectionReason[];

export type PplBuyerReadyEligibility =
  | {
      ok: true;
      firstName: string;
      lastName: string;
      consumerAge: string;
      resolvedAge: ResolvedConsumerAge;
      phoneE164: string;
      reviewFlags: PplNameReviewFlag[];
    }
  | {
      ok: false;
      reasons: PplBuyerReadyRejectionReason[];
      resolvedAge: ResolvedConsumerAge;
      phoneE164: string | null;
      reviewFlags: PplNameReviewFlag[];
    };

/** Extra stored payload locations a recoverable explicit age may still live in. */
export type PplBuyerReadyAgeSources = {
  rawPayloadJson?: unknown;
  metadataJson?: unknown;
  enrichmentMetadataJson?: unknown;
  evaluatedAt?: Date;
  /**
   * When set, strict US NANP phone quality applies only to life-insurance
   * commerce niches (vet / trucker / nurse). Omitted niche fails closed
   * (phone quality on) so unit tests and unknown callers stay commercial.
   */
  nicheKey?: string;
};

export function shouldEnforceCommercialPhoneQuality(
  nicheKey: string | null | undefined
): boolean {
  if (nicheKey == null || !String(nicheKey).trim()) return true;
  return isSupportedAgedCommerceNiche(nicheKey);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readTrimmedString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

/** Same precedence as extractBuyerCsvFields first_name / last_name. */
export function readPplBuyerReadyNames(normalizedPayloadJson: unknown): {
  firstName: string;
  lastName: string;
} {
  const payload = asRecord(normalizedPayloadJson) ?? {};
  const contact = asRecord(payload.contact) ?? {};
  return {
    firstName: readTrimmedString(
      contact.first_name,
      contact.firstName,
      payload.first_name,
      payload.firstName
    ),
    lastName: readTrimmedString(
      contact.last_name,
      contact.lastName,
      payload.last_name,
      payload.lastName
    ),
  };
}

function readPhoneRaw(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}

/** Raw phone before strict NANP — never padded or invented. */
export function readPplBuyerReadyPhoneRaw(normalizedPayloadJson: unknown): string {
  const payload = asRecord(normalizedPayloadJson) ?? {};
  const contact = asRecord(payload.contact) ?? {};
  return readPhoneRaw(
    contact.phone_e164,
    contact.phoneE164,
    contact.phone,
    contact.phone_digits,
    payload.phone_e164,
    payload.phoneE164,
    payload.phone
  );
}

const PLACEHOLDER_NAME_TOKENS = new Set([
  "n/a",
  "na",
  "none",
  "unknown",
  "test",
  "asdf",
  "foo",
  "bar",
  "xxx",
  "yyy",
  "tbd",
  "null",
  "undefined",
  "buyer",
  "fname",
  "lname",
  "firstname",
  "lastname",
  "noname",
  "sample",
]);

const SUSPICIOUS_NAME_PATTERN = /^(.)\1{2,}$|^[^a-zA-Z''.-]+$/;

export function evaluatePplNameReviewFlags(
  firstName: string,
  lastName: string
): PplNameReviewFlag[] {
  const flags: PplNameReviewFlag[] = [];
  const firstKey = firstName.trim().toLowerCase();
  const lastKey = lastName.trim().toLowerCase();
  if (PLACEHOLDER_NAME_TOKENS.has(firstKey)) flags.push("placeholder_first_name");
  if (PLACEHOLDER_NAME_TOKENS.has(lastKey)) flags.push("placeholder_last_name");
  if (!flags.includes("placeholder_first_name") && SUSPICIOUS_NAME_PATTERN.test(firstName.trim())) {
    flags.push("suspicious_first_name");
  }
  if (!flags.includes("placeholder_last_name") && SUSPICIOUS_NAME_PATTERN.test(lastName.trim())) {
    flags.push("suspicious_last_name");
  }
  return flags;
}

function nameTokenIssues(
  value: string,
  field: "first_name" | "last_name"
): PplBuyerReadyRejectionReason[] {
  const reasons: PplBuyerReadyRejectionReason[] = [];
  if (value.length <= 1) {
    reasons.push(field === "first_name" ? "first_name_too_short" : "last_name_too_short");
  }
  if (/\s/.test(value)) {
    reasons.push(field === "first_name" ? "first_name_multipart" : "last_name_multipart");
  }
  if (/\d/.test(value)) {
    reasons.push(field === "first_name" ? "first_name_has_digits" : "last_name_has_digits");
  }
  return reasons;
}

function phoneRejectionReason(rawPhone: string): PplBuyerReadyPhoneRejectionReason | null {
  const result = tryNormalizeStrictUsNanpE164(rawPhone || null);
  if (result.ok) return null;
  if (result.reason === "phone_blank") return "phone_missing";
  return result.reason;
}

/** Age-policy rejection reason for a resolution, or null when the age passes. */
export function consumerAgeRejectionReason(
  resolved: ResolvedConsumerAge
): PplBuyerReadyRejectionReason | null {
  switch (resolved.status) {
    case "missing":
      return "consumer_age_missing";
    case "invalid":
      return "consumer_age_invalid";
    case "over_maximum_age":
      return "consumer_age_over_maximum";
    default:
      return null;
  }
}

export function evaluatePplBuyerReadyEligibility(
  normalizedPayloadJson: unknown,
  ageSources: PplBuyerReadyAgeSources = {}
): PplBuyerReadyEligibility {
  const resolvedAge = resolveConsumerAgeForFulfillment({
    normalizedPayloadJson,
    rawPayloadJson: ageSources.rawPayloadJson,
    metadataJson: ageSources.metadataJson,
    enrichmentMetadataJson: ageSources.enrichmentMetadataJson,
    evaluatedAt: ageSources.evaluatedAt,
  });
  const { firstName, lastName } = readPplBuyerReadyNames(normalizedPayloadJson);
  const rawPhone = readPplBuyerReadyPhoneRaw(normalizedPayloadJson);
  const reviewFlags = evaluatePplNameReviewFlags(firstName, lastName);
  const reasons: PplBuyerReadyRejectionReason[] = [];

  reasons.push(...nameTokenIssues(firstName, "first_name"));
  reasons.push(...nameTokenIssues(lastName, "last_name"));
  if (shouldEnforceCommercialPhoneQuality(ageSources.nicheKey)) {
    const phoneReason = phoneRejectionReason(rawPhone);
    if (phoneReason) reasons.push(phoneReason);
  }
  const ageReason = consumerAgeRejectionReason(resolvedAge);
  if (ageReason) reasons.push(ageReason);

  const phoneE164 = tryNormalizeStrictUsNanpE164(rawPhone || null);
  if (reasons.length > 0) {
    return {
      ok: false,
      reasons,
      resolvedAge,
      phoneE164: phoneE164.ok ? phoneE164.e164 : null,
      reviewFlags,
    };
  }
  return {
    ok: true,
    firstName,
    lastName,
    consumerAge: String(resolvedAge.age),
    resolvedAge,
    phoneE164: phoneE164.ok ? phoneE164.e164 : rawPhone,
    reviewFlags,
  };
}

export function isPplBuyerReadyLead(
  normalizedPayloadJson: unknown,
  ageSources: PplBuyerReadyAgeSources = {}
): boolean {
  return evaluatePplBuyerReadyEligibility(normalizedPayloadJson, ageSources).ok;
}
