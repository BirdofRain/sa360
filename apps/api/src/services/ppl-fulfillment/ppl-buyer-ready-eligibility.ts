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
 * Name field precedence matches the buyer CSV extractors.
 */

import {
  resolveConsumerAgeForFulfillment,
  type ResolvedConsumerAge,
} from "../consumer-age/consumer-age-policy.js";

export type PplBuyerReadyRejectionReason =
  | "first_name_too_short"
  | "last_name_too_short"
  | "first_name_multipart"
  | "last_name_multipart"
  | "consumer_age_missing"
  | "consumer_age_invalid"
  | "consumer_age_over_maximum";

export const PPL_BUYER_READY_AGE_REJECTION_REASONS = [
  "consumer_age_missing",
  "consumer_age_invalid",
  "consumer_age_over_maximum",
] as const satisfies readonly PplBuyerReadyRejectionReason[];

export type PplBuyerReadyEligibility =
  | {
      ok: true;
      firstName: string;
      lastName: string;
      consumerAge: string;
      resolvedAge: ResolvedConsumerAge;
    }
  | {
      ok: false;
      reasons: PplBuyerReadyRejectionReason[];
      resolvedAge: ResolvedConsumerAge;
    };

/** Extra stored payload locations a recoverable explicit age may still live in. */
export type PplBuyerReadyAgeSources = {
  rawPayloadJson?: unknown;
  metadataJson?: unknown;
  enrichmentMetadataJson?: unknown;
  evaluatedAt?: Date;
};

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

function nameTokenIssues(
  value: string,
  field: "first_name" | "last_name"
): PplBuyerReadyRejectionReason[] {
  if (value.length <= 1) {
    return [field === "first_name" ? "first_name_too_short" : "last_name_too_short"];
  }
  if (/\s/.test(value)) {
    return [field === "first_name" ? "first_name_multipart" : "last_name_multipart"];
  }
  return [];
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
  const reasons: PplBuyerReadyRejectionReason[] = [];

  reasons.push(...nameTokenIssues(firstName, "first_name"));
  reasons.push(...nameTokenIssues(lastName, "last_name"));
  const ageReason = consumerAgeRejectionReason(resolvedAge);
  if (ageReason) reasons.push(ageReason);

  if (reasons.length > 0) return { ok: false, reasons, resolvedAge };
  return {
    ok: true,
    firstName,
    lastName,
    consumerAge: String(resolvedAge.age),
    resolvedAge,
  };
}

export function isPplBuyerReadyLead(
  normalizedPayloadJson: unknown,
  ageSources: PplBuyerReadyAgeSources = {}
): boolean {
  return evaluatePplBuyerReadyEligibility(normalizedPayloadJson, ageSources).ok;
}
