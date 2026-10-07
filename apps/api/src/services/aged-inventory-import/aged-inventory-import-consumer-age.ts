/**
 * Consumer age for aged CSV import.
 *
 * Person age is never derived from lead age (`generatedAt` / `generated_at`).
 * Historical wizard commits stored no age cell. Recovery reads only explicit
 * consumer-age / date-of-birth locations that a later or richer import kept.
 *
 * Parsing, location scanning, and the sellable-age policy live in
 * `consumer-age/consumer-age-policy.ts`. This module keeps the aged-import
 * facing API and the inventory backfill writer.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import {
  MAX_SELLABLE_CONSUMER_AGE,
  normalizeConsumerAgeCell,
  readExplicitStoredConsumerAge,
  readNormalizedConsumerAgeCell,
  readNormalizedDateOfBirthCell,
  resolveConsumerAgeForFulfillment,
  type ConsumerAgeResolutionSource,
} from "../consumer-age/consumer-age-policy.js";

export { readExplicitStoredConsumerAge };

export type StoredConsumerAgeLocation =
  | "normalized_payload"
  | "raw_payload"
  | "metadata_json"
  | "enrichment_metadata";

export type StoredConsumerAgeRecovery = {
  age: string | null;
  dateOfBirth: string | null;
  location: StoredConsumerAgeLocation | null;
  /** True when the resolved age is above the maximum sellable consumer age. */
  overMaximumAge: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function locationForSource(
  source: ConsumerAgeResolutionSource | null
): StoredConsumerAgeLocation | null {
  switch (source) {
    case "normalized_consumer_age":
    case "normalized_dob":
      return "normalized_payload";
    case "raw_consumer_age":
    case "raw_dob":
      return "raw_payload";
    case "metadata":
      return "metadata_json";
    case "enrichment":
      return "enrichment_metadata";
    default:
      return null;
  }
}

export function resolveAgedImportConsumerAge(
  raw: string | null | undefined,
  evaluatedAt: Date
): { consumerAge: string | null; consumerAgeRaw: string | null; dateOfBirth: string | null } {
  const consumerAgeRaw = raw?.trim() ? raw.trim() : null;
  if (!consumerAgeRaw) return { consumerAge: null, consumerAgeRaw: null, dateOfBirth: null };
  const normalized = normalizeConsumerAgeCell(consumerAgeRaw, evaluatedAt);
  return { ...normalized, consumerAgeRaw };
}

export function recoverStoredConsumerAge(
  input: {
    normalizedPayloadJson: unknown;
    rawPayloadJson: unknown;
    metadataJson: unknown;
    enrichmentMetadataJson: unknown;
  },
  evaluatedAt: Date
): StoredConsumerAgeRecovery {
  const resolved = resolveConsumerAgeForFulfillment({ ...input, evaluatedAt });
  return {
    age: resolved.age == null ? null : String(resolved.age),
    dateOfBirth: resolved.dateOfBirth,
    location: locationForSource(resolved.source),
    overMaximumAge: resolved.status === "over_maximum_age",
  };
}

/**
 * Write a recovered person age (and DOB when known) onto normalizedPayloadJson.
 * Blank canonical destinations only — a conflicting non-blank canonical value is
 * never overwritten.
 */
export function mergeRecoveredConsumerAge(
  normalizedPayloadJson: unknown,
  consumerAge: string,
  dateOfBirth: string | null = null
): Record<string, unknown> {
  const payload = asRecord(normalizedPayloadJson) ? { ...asRecord(normalizedPayloadJson)! } : {};
  const details = asRecord(payload.lead_details) ? { ...asRecord(payload.lead_details)! } : {};

  if (!readNormalizedConsumerAgeCell(payload)) {
    details.consumer_age = consumerAge;
    payload.consumer_age = consumerAge;
  }
  if (dateOfBirth && !readNormalizedDateOfBirthCell(payload)) {
    details.date_of_birth = dateOfBirth;
  }
  payload.lead_details = details;
  return payload;
}

export function buildAgedInventoryNormalizedPayload(row: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phoneE164: string | null;
  state: string;
  generatedAt: Date;
  nicheKey: string;
  productType: string | null;
  consumerAge?: string | null;
  dateOfBirth?: string | null;
}): Prisma.JsonObject {
  const payload: Record<string, unknown> = {
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone_e164: row.phoneE164,
    state: row.state,
    generated_at: row.generatedAt.toISOString(),
    niche_key: row.nicheKey,
    product_type: row.productType,
  };
  const leadDetails: Record<string, unknown> = {};
  if (row.consumerAge) {
    payload.consumer_age = row.consumerAge;
    leadDetails.consumer_age = row.consumerAge;
  }
  if (row.dateOfBirth) leadDetails.date_of_birth = row.dateOfBirth;
  if (Object.keys(leadDetails).length > 0) payload.lead_details = leadDetails;
  return payload as Prisma.JsonObject;
}

export type StoredConsumerAgeBackfillOutcome = {
  updatedIds: string[];
  unchangedIds: string[];
  /** Canonical normalized age already present but different from the recovered value. */
  conflictIds: string[];
  /** Promoted ages above the maximum sellable consumer age. */
  overMaximumAgeIds: string[];
};

/**
 * Promote a recovered person age (and DOB when known) onto normalizedPayloadJson.
 * No-op when the canonical destination already holds a readable age or no stored
 * source age exists. Never creates inventory and never touches identity,
 * generatedAt, allocation ownership, or lead commerce age.
 */
export async function backfillStoredConsumerAges(
  itemIds: string[],
  db: PrismaClient,
  evaluatedAt: Date = new Date()
): Promise<StoredConsumerAgeBackfillOutcome> {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) {
    return { updatedIds: [], unchangedIds: [], conflictIds: [], overMaximumAgeIds: [] };
  }

  const rows = await db.leadInventoryItem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      metadataJson: true,
      sourceLeadEvent: {
        select: {
          id: true,
          normalizedPayloadJson: true,
          rawPayloadJson: true,
          enrichmentMetadataJson: true,
        },
      },
    },
  });

  const updatedIds: string[] = [];
  const unchangedIds: string[] = [];
  const conflictIds: string[] = [];
  const overMaximumAgeIds: string[] = [];

  for (const row of rows) {
    const event = row.sourceLeadEvent;
    const recovered = recoverStoredConsumerAge(
      {
        normalizedPayloadJson: event.normalizedPayloadJson,
        rawPayloadJson: event.rawPayloadJson,
        metadataJson: row.metadataJson,
        enrichmentMetadataJson: event.enrichmentMetadataJson,
      },
      evaluatedAt
    );
    if (!recovered.age) {
      unchangedIds.push(row.id);
      continue;
    }

    const canonicalAge = readNormalizedConsumerAgeCell(event.normalizedPayloadJson);
    const canonicalDob = readNormalizedDateOfBirthCell(event.normalizedPayloadJson);
    if (canonicalAge && canonicalAge !== recovered.age) conflictIds.push(row.id);

    const needsAge = !canonicalAge;
    const needsDob = Boolean(recovered.dateOfBirth) && !canonicalDob;
    if (!needsAge && !needsDob) {
      unchangedIds.push(row.id);
      continue;
    }

    const next = mergeRecoveredConsumerAge(
      event.normalizedPayloadJson,
      recovered.age,
      recovered.dateOfBirth
    );
    await db.sourceLeadEvent.update({
      where: { id: event.id },
      data: { normalizedPayloadJson: next as Prisma.InputJsonValue },
    });
    updatedIds.push(row.id);
    if (Number(recovered.age) > MAX_SELLABLE_CONSUMER_AGE) overMaximumAgeIds.push(row.id);
  }

  const seen = new Set(rows.map((row) => row.id));
  for (const id of ids) {
    if (!seen.has(id)) unchangedIds.push(id);
  }
  return { updatedIds, unchangedIds, conflictIds, overMaximumAgeIds };
}
