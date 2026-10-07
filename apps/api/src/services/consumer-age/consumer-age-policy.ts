/**
 * Canonical consumer-age policy for commercial life-insurance fulfillment.
 *
 * CONSUMER AGE is the age of the person. It is never the age of the lead.
 * `LeadInventoryItem.generatedAt`, commerce age buckets, submission dates, and
 * `lead_date` feed LEAD age only and are never read here.
 *
 * Reuses the historical cell parser (`parseHistoricalConsumerAge`) and the
 * completed-whole-year DOB calculation (`completedWholeYearsAsOf`) so parsing
 * and plausible-value validation have one source of truth. This module owns the
 * explicit stored-location readers; `aged-inventory-import-consumer-age.ts` and
 * `buyer-lead-fields.ts` import them from here rather than re-implementing.
 */

import {
  completedWholeYearsAsOf,
  parseHistoricalConsumerAge,
  type ParsedConsumerAge,
} from "../aged-inventory-bulk/aged-inventory-bulk-consumer-age.js";
import { normalizeSourceFieldKey } from "../source-intake/source-field-alias.registry.js";

export { completedWholeYearsAsOf };

/** Maximum commercially sellable consumer age, inclusive. */
export const MAX_SELLABLE_CONSUMER_AGE = 86;

/** Stamped on commerce exclusions created by the consumer-age policy. */
export const CONSUMER_AGE_POLICY_VERSION = "consumer_age_policy_v1";

/** `commerceExcludedReason` for inventory permanently over the sellable age. */
export const CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON = "consumer_age_over_86";

/** Operator-facing category for inventory over the sellable age. */
export const CONSUMER_AGE_OVER_MAXIMUM_CATEGORY = "Dead — Age over 86";

/**
 * Operator-facing category for inventory with no resolvable age. Recoverable —
 * never commerce-excluded merely because enrichment is incomplete.
 */
export const CONSUMER_AGE_REQUIRED_CATEGORY = "Ineligible — Age required";

/** Explicit consumer-age cells. Never includes generatedAt/generated_at/ageDays. */
export const EXPLICIT_CONSUMER_AGE_KEYS = [
  "consumer_age",
  "consumerAge",
  "consumer_age_raw",
  "age",
  "dob_age_raw",
  "dobAgeRaw",
] as const;

/** Explicit date-of-birth cells. Mirrors the source-intake `date_of_birth` aliases. */
export const EXPLICIT_DATE_OF_BIRTH_KEYS = [
  "date_of_birth",
  "dateOfBirth",
  "dob",
  "birth_date",
  "birthDate",
] as const;

export type ConsumerAgeResolutionSource =
  | "normalized_consumer_age"
  | "normalized_dob"
  | "raw_consumer_age"
  | "raw_dob"
  | "metadata"
  | "enrichment";

export type ConsumerAgeResolutionStatus =
  | "eligible"
  | "missing"
  | "invalid"
  | "over_maximum_age";

export type ResolvedConsumerAge = {
  age: number | null;
  dateOfBirth: string | null;
  source: ConsumerAgeResolutionSource | null;
  exactFromDob: boolean;
  status: ConsumerAgeResolutionStatus;
};

export type ConsumerAgeResolverInput = {
  normalizedPayloadJson?: unknown;
  rawPayloadJson?: unknown;
  metadataJson?: unknown;
  enrichmentMetadataJson?: unknown;
  evaluatedAt?: Date;
};

type AgeCandidate = {
  parsed: ParsedConsumerAge;
  source: ConsumerAgeResolutionSource;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/**
 * Bags that may hold an explicit consumer answer. Deliberately an allowlist:
 * only canonical nests, source-attribute bags, and the historical Master bag are
 * inspected, so an unrelated nested date can never be read as a birthday.
 */
function candidateBags(source: unknown): Record<string, unknown>[] {
  const root = asRecord(source);
  if (!root) return [];
  const bags = [root];
  for (const key of [
    "lead_details",
    "contact",
    "master",
    "sourceAttributes",
    "custom_fields",
  ] as const) {
    const nested = asRecord(root[key]);
    if (nested) bags.push(nested);
  }
  const routing = asRecord(root.routing);
  const sourceIntake = routing ? asRecord(routing.source_intake) : null;
  if (sourceIntake) {
    for (const key of ["sourceAttributes", "custom_fields", "compliance"] as const) {
      const nested = asRecord(sourceIntake[key]);
      if (nested) bags.push(nested);
    }
  }
  return bags;
}

/**
 * Alias-insensitive cell lookup using the same key normalization as the
 * source-field alias registry, so `DOB`, `Date of Birth`, and `date-of-birth`
 * all resolve. Declared key order is preserved as precedence.
 */
function readCells(source: unknown, keys: readonly string[]): string[] {
  const precedence = new Map<string, number>();
  keys.forEach((key, index) => {
    const normalized = normalizeSourceFieldKey(key);
    if (normalized && !precedence.has(normalized)) precedence.set(normalized, index);
  });

  const values: string[] = [];
  for (const bag of candidateBags(source)) {
    const matches: Array<{ index: number; text: string }> = [];
    for (const [key, value] of Object.entries(bag)) {
      const index = precedence.get(normalizeSourceFieldKey(key));
      if (index == null) continue;
      const text = cellText(value);
      if (text) matches.push({ index, text });
    }
    matches.sort((a, b) => a.index - b.index);
    for (const match of matches) values.push(match.text);
  }
  return values;
}

/**
 * First usable parse from the given cells, plus whether any non-empty cell was
 * seen at all. The `sawValue` flag separates `missing` from `invalid`.
 */
function parseFirstUsable(
  cells: string[],
  evaluatedAt: Date
): { parsed: ParsedConsumerAge | null; sawValue: boolean } {
  let sawValue = false;
  for (const cell of cells) {
    sawValue = true;
    const parsed = parseHistoricalConsumerAge(cell, evaluatedAt);
    if (parsed.consumerAge != null) return { parsed, sawValue };
  }
  return { parsed: null, sawValue };
}

/** Explicit stored consumer age as a string, or null. Ignores lead age entirely. */
export function readExplicitStoredConsumerAge(
  source: unknown,
  evaluatedAt: Date
): string | null {
  const { parsed } = parseFirstUsable(
    [
      ...readCells(source, EXPLICIT_DATE_OF_BIRTH_KEYS),
      ...readCells(source, EXPLICIT_CONSUMER_AGE_KEYS),
    ],
    evaluatedAt
  );
  return parsed?.consumerAge == null ? null : String(parsed.consumerAge);
}

/** Canonical normalized consumer-age cell (`lead_details.consumer_age`, then flat). */
export function readNormalizedConsumerAgeCell(normalizedPayloadJson: unknown): string {
  const payload = asRecord(normalizedPayloadJson);
  if (!payload) return "";
  const leadDetails = asRecord(payload.lead_details);
  return cellText(leadDetails?.consumer_age) || cellText(payload.consumer_age);
}

/** Canonical normalized date-of-birth cell (`lead_details.date_of_birth`, then flat). */
export function readNormalizedDateOfBirthCell(normalizedPayloadJson: unknown): string {
  const payload = asRecord(normalizedPayloadJson);
  if (!payload) return "";
  const leadDetails = asRecord(payload.lead_details);
  return cellText(leadDetails?.date_of_birth) || cellText(payload.date_of_birth);
}

/**
 * Parse any explicit age-or-DOB cell into a canonical normalized pair.
 * A recognized DOB yields both an ISO `date_of_birth` and the completed
 * whole-year age as of `evaluatedAt`. A plausible integer age yields the age
 * only — a birthday is never fabricated from an age.
 */
export function normalizeConsumerAgeCell(
  raw: string | null | undefined,
  evaluatedAt: Date
): { consumerAge: string | null; dateOfBirth: string | null } {
  const parsed = parseHistoricalConsumerAge(raw ?? "", evaluatedAt);
  return {
    consumerAge: parsed.consumerAge == null ? null : String(parsed.consumerAge),
    dateOfBirth: parsed.dateOfBirth,
  };
}

function collectCandidates(
  input: ConsumerAgeResolverInput,
  evaluatedAt: Date
): { candidates: AgeCandidate[]; sawValue: boolean } {
  const candidates: AgeCandidate[] = [];
  let sawValue = false;

  const push = (cells: string[], source: ConsumerAgeResolutionSource) => {
    const result = parseFirstUsable(cells, evaluatedAt);
    if (result.sawValue) sawValue = true;
    if (result.parsed) candidates.push({ parsed: result.parsed, source });
  };

  const normalizedDob = readNormalizedDateOfBirthCell(input.normalizedPayloadJson);
  push(normalizedDob ? [normalizedDob] : [], "normalized_dob");
  const normalizedAge = readNormalizedConsumerAgeCell(input.normalizedPayloadJson);
  push(normalizedAge ? [normalizedAge] : [], "normalized_consumer_age");
  // Live intake parks survey answers under routing.source_intake.* until
  // normalization promotes them, so the normalized bag is scanned fully too.
  push(readCells(input.normalizedPayloadJson, EXPLICIT_DATE_OF_BIRTH_KEYS), "normalized_dob");
  push(
    readCells(input.normalizedPayloadJson, EXPLICIT_CONSUMER_AGE_KEYS),
    "normalized_consumer_age"
  );

  push(readCells(input.rawPayloadJson, EXPLICIT_DATE_OF_BIRTH_KEYS), "raw_dob");
  push(readCells(input.rawPayloadJson, EXPLICIT_CONSUMER_AGE_KEYS), "raw_consumer_age");

  push(
    [
      ...readCells(input.metadataJson, EXPLICIT_DATE_OF_BIRTH_KEYS),
      ...readCells(input.metadataJson, EXPLICIT_CONSUMER_AGE_KEYS),
    ],
    "metadata"
  );
  push(
    [
      ...readCells(input.enrichmentMetadataJson, EXPLICIT_DATE_OF_BIRTH_KEYS),
      ...readCells(input.enrichmentMetadataJson, EXPLICIT_CONSUMER_AGE_KEYS),
    ],
    "enrichment"
  );

  return { candidates, sawValue };
}

/**
 * One canonical fulfillment-safe consumer-age resolution.
 *
 * Precedence: an explicit recognized DOB anywhere wins — it is the only input
 * that stays correct as time passes — then an explicit stored age, in
 * normalized → raw → metadata → enrichment order. An explicit integer age with
 * no DOB is used exactly as stored; it is never incremented, because no
 * birthday is known.
 */
export function resolveConsumerAgeForFulfillment(
  input: ConsumerAgeResolverInput
): ResolvedConsumerAge {
  const evaluatedAt = input.evaluatedAt ?? new Date();
  const { candidates, sawValue } = collectCandidates(input, evaluatedAt);

  const chosen =
    candidates.find((candidate) => candidate.parsed.dateOfBirth != null) ?? candidates[0] ?? null;

  if (!chosen || chosen.parsed.consumerAge == null) {
    return {
      age: null,
      dateOfBirth: null,
      source: null,
      exactFromDob: false,
      status: sawValue ? "invalid" : "missing",
    };
  }

  const age = chosen.parsed.consumerAge;
  return {
    age,
    dateOfBirth: chosen.parsed.dateOfBirth,
    source: chosen.source,
    exactFromDob: chosen.parsed.dateOfBirth != null,
    status: age > MAX_SELLABLE_CONSUMER_AGE ? "over_maximum_age" : "eligible",
  };
}

export function isConsumerAgeFulfillable(resolved: ResolvedConsumerAge): boolean {
  return resolved.status === "eligible";
}

/** Operator-facing category for a resolution outcome. */
export function consumerAgePolicyCategory(resolved: ResolvedConsumerAge): string | null {
  if (resolved.status === "over_maximum_age") return CONSUMER_AGE_OVER_MAXIMUM_CATEGORY;
  if (resolved.status === "missing" || resolved.status === "invalid") {
    return CONSUMER_AGE_REQUIRED_CATEGORY;
  }
  return null;
}
