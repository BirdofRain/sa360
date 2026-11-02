/**
 * Intake-side promotion of explicit source age / date-of-birth answers into the
 * canonical normalized contract (`lead_details.consumer_age`,
 * `lead_details.date_of_birth`).
 *
 * Parsing and the replay reference live in `campaign-dob-age.ts`. A recognized
 * birthday yields a date-only DOB and, when a reference instant is supplied,
 * the derived consumer age. An explicit age never fabricates a birthday.
 * Source bags are not mutated. A supplied age that disagrees with the DOB is
 * kept and marked `consumer_age_conflict`.
 */

import {
  resolveCampaignDobAgeFromBags,
  type CampaignDobAgeFields,
  type CampaignDobAgeOptions,
} from "./campaign-dob-age.js";
import { resolveConsumerAgeForFulfillment } from "./consumer-age-policy.js";

export type IntakeConsumerAgeFields = CampaignDobAgeFields;

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Canonical age/DOB fields for the supplied source bags, in bag order.
 * Returns an empty object when no usable explicit value exists — callers must
 * not write placeholder values. Derived age is omitted when no reference
 * instant is supplied.
 */
export function resolveIntakeConsumerAgeFields(
  bags: unknown[],
  evaluatedAt: Date | CampaignDobAgeOptions = {}
): IntakeConsumerAgeFields {
  return resolveCampaignDobAgeFromBags(bags, evaluatedAt);
}

/**
 * Merge canonical age/DOB into an existing `lead_details` nest without
 * overwriting a non-blank canonical value already present. Provenance and a
 * visible conflict flag are filled when the bags support them.
 */
export function withIntakeConsumerAge(
  leadDetails: Record<string, unknown> | null | undefined,
  bags: unknown[],
  evaluatedAt: Date | CampaignDobAgeOptions = {}
): Record<string, unknown> {
  const details: Record<string, unknown> = { ...(leadDetails ?? {}) };
  const resolved = resolveIntakeConsumerAgeFields(bags, evaluatedAt);
  const hadAge = Boolean(cellText(details.consumer_age));
  for (const [key, value] of Object.entries(resolved)) {
    if (value == null) continue;
    if (key === "consumer_age_conflict") {
      details.consumer_age_conflict = true;
      continue;
    }
    if (key === "consumer_age_provenance" && hadAge && !cellText(details.consumer_age_provenance)) {
      details.consumer_age_provenance = "supplied";
      continue;
    }
    if (!cellText(details[key])) details[key] = value;
  }
  const storedAge = cellText(details.consumer_age);
  const derived = cellText(details.consumer_age_derived);
  if (storedAge && derived && storedAge !== derived) details.consumer_age_conflict = true;
  return details;
}

/**
 * Merge canonical age/DOB into `lead_details` using the full nested resolver on
 * each supplied normalized payload, in order. Promotes an over-maximum age too:
 * the value is true, and commercial classification happens in the age policy,
 * not at intake. Never overwrites a non-blank canonical value.
 */
export function withNormalizedPayloadConsumerAge(
  leadDetails: Record<string, unknown> | null | undefined,
  normalizedPayloads: unknown[],
  evaluatedAt: Date = new Date()
): Record<string, unknown> {
  const details: Record<string, unknown> = { ...(leadDetails ?? {}) };
  for (const payload of normalizedPayloads) {
    if (cellText(details.consumer_age) && cellText(details.date_of_birth)) break;
    const resolved = resolveConsumerAgeForFulfillment({
      normalizedPayloadJson: payload,
      evaluatedAt,
    });
    if (resolved.age == null) continue;
    if (!cellText(details.consumer_age)) details.consumer_age = String(resolved.age);
    if (resolved.dateOfBirth && !cellText(details.date_of_birth)) {
      details.date_of_birth = resolved.dateOfBirth;
    }
  }
  return details;
}
