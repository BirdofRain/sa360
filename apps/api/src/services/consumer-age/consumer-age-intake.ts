/**
 * Intake-side promotion of explicit source age / date-of-birth answers into the
 * canonical normalized contract (`lead_details.consumer_age`,
 * `lead_details.date_of_birth`).
 *
 * Alias matching reuses `normalizeSourceFieldKey` so `DOB`, `Date of Birth`, and
 * `birth-date` all resolve. A recognized birthday also yields the derived
 * consumer age; an explicit age never fabricates a birthday. Raw source values
 * and their provenance are left untouched — this only fills canonical fields.
 */

import { normalizeSourceFieldKey } from "../source-intake/source-field-alias.registry.js";
import {
  EXPLICIT_CONSUMER_AGE_KEYS,
  EXPLICIT_DATE_OF_BIRTH_KEYS,
  normalizeConsumerAgeCell,
  resolveConsumerAgeForFulfillment,
} from "./consumer-age-policy.js";

export type IntakeConsumerAgeFields = {
  consumer_age?: string;
  date_of_birth?: string;
};

const DOB_ALIASES = new Set(
  [...EXPLICIT_DATE_OF_BIRTH_KEYS, "Date of Birth", "Birth Date"].map(normalizeSourceFieldKey)
);
const AGE_ALIASES = new Set(
  [...EXPLICIT_CONSUMER_AGE_KEYS, "Age", "Consumer Age"].map(normalizeSourceFieldKey)
);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstMatchingCell(bags: unknown[], aliases: Set<string>): string {
  for (const bag of bags) {
    const record = asRecord(bag);
    if (!record) continue;
    for (const [key, value] of Object.entries(record)) {
      if (!aliases.has(normalizeSourceFieldKey(key))) continue;
      const text = cellText(value);
      if (text) return text;
    }
  }
  return "";
}

/**
 * Canonical age/DOB fields for the supplied source bags, in bag order.
 * Returns an empty object when no usable explicit value exists — callers must
 * not write placeholder values.
 */
export function resolveIntakeConsumerAgeFields(
  bags: unknown[],
  evaluatedAt: Date = new Date()
): IntakeConsumerAgeFields {
  const dobCell = firstMatchingCell(bags, DOB_ALIASES);
  if (dobCell) {
    const parsed = normalizeConsumerAgeCell(dobCell, evaluatedAt);
    if (parsed.dateOfBirth && parsed.consumerAge) {
      return { consumer_age: parsed.consumerAge, date_of_birth: parsed.dateOfBirth };
    }
  }

  const ageCell = firstMatchingCell(bags, AGE_ALIASES);
  if (ageCell) {
    const parsed = normalizeConsumerAgeCell(ageCell, evaluatedAt);
    if (parsed.consumerAge) {
      return {
        consumer_age: parsed.consumerAge,
        ...(parsed.dateOfBirth ? { date_of_birth: parsed.dateOfBirth } : {}),
      };
    }
  }

  return {};
}

/**
 * Merge canonical age/DOB into an existing `lead_details` nest without
 * overwriting a non-blank canonical value already present.
 */
export function withIntakeConsumerAge(
  leadDetails: Record<string, unknown> | null | undefined,
  bags: unknown[],
  evaluatedAt: Date = new Date()
): Record<string, unknown> {
  const details: Record<string, unknown> = { ...(leadDetails ?? {}) };
  const resolved = resolveIntakeConsumerAgeFields(bags, evaluatedAt);
  if (resolved.consumer_age && !cellText(details.consumer_age)) {
    details.consumer_age = resolved.consumer_age;
  }
  if (resolved.date_of_birth && !cellText(details.date_of_birth)) {
    details.date_of_birth = resolved.date_of_birth;
  }
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
