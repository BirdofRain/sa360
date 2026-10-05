/**
 * Consumer age for aged CSV import.
 *
 * Person age is never derived from lead age (`generatedAt` / `generated_at`).
 * Historical wizard commits stored no age cell. Recovery reads only explicit
 * consumer-age locations that a later or richer import may have kept.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { readBuyerCsvV3ZipAndAge } from "../ppl-fulfillment/buyer-lead-fields.js";
import { parseHistoricalConsumerAge } from "../aged-inventory-bulk/aged-inventory-bulk-consumer-age.js";

const EXPLICIT_AGE_KEYS = [
  "consumer_age",
  "consumerAge",
  "consumer_age_raw",
  "age",
  "dob_age_raw",
  "dobAgeRaw",
] as const;

export type StoredConsumerAgeLocation =
  | "normalized_payload"
  | "raw_payload"
  | "metadata_json"
  | "enrichment_metadata";

export type StoredConsumerAgeRecovery = {
  age: string | null;
  location: StoredConsumerAgeLocation | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function resolveAgedImportConsumerAge(
  raw: string | null | undefined,
  evaluatedAt: Date
): { consumerAge: string | null; consumerAgeRaw: string | null } {
  const consumerAgeRaw = raw?.trim() ? raw.trim() : null;
  if (!consumerAgeRaw) return { consumerAge: null, consumerAgeRaw: null };
  const parsed = parseHistoricalConsumerAge(consumerAgeRaw, evaluatedAt);
  if (parsed.consumerAge == null) return { consumerAge: null, consumerAgeRaw };
  return { consumerAge: String(parsed.consumerAge), consumerAgeRaw };
}

function ageFromExplicitValue(value: unknown, evaluatedAt: Date): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = parseHistoricalConsumerAge(String(value), evaluatedAt);
    return parsed.consumerAge == null ? null : String(parsed.consumerAge);
  }
  if (typeof value !== "string") return null;
  const parsed = parseHistoricalConsumerAge(value, evaluatedAt);
  return parsed.consumerAge == null ? null : String(parsed.consumerAge);
}

/** Explicit consumer-age cells only. Ignores generatedAt, generated_at, and ageDays. */
export function readExplicitStoredConsumerAge(
  source: unknown,
  evaluatedAt: Date
): string | null {
  const record = asRecord(source);
  if (!record) return null;
  const candidates: unknown[] = [];
  for (const key of EXPLICIT_AGE_KEYS) {
    if (key in record) candidates.push(record[key]);
  }
  const details = asRecord(record.lead_details);
  if (details) {
    for (const key of ["consumer_age", "consumerAge", "age"] as const) {
      if (key in details) candidates.push(details[key]);
    }
  }
  const master = asRecord(record.master);
  if (master && "dob_age_raw" in master) candidates.push(master.dob_age_raw);

  for (const candidate of candidates) {
    const age = ageFromExplicitValue(candidate, evaluatedAt);
    if (age) return age;
  }
  return null;
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
  const normalizedAge = readBuyerCsvV3ZipAndAge(input.normalizedPayloadJson).age;
  if (normalizedAge) return { age: normalizedAge, location: "normalized_payload" };

  const rawAge = readExplicitStoredConsumerAge(input.rawPayloadJson, evaluatedAt);
  if (rawAge) return { age: rawAge, location: "raw_payload" };

  const metadataAge = readExplicitStoredConsumerAge(input.metadataJson, evaluatedAt);
  if (metadataAge) return { age: metadataAge, location: "metadata_json" };

  const enrichmentAge = readExplicitStoredConsumerAge(input.enrichmentMetadataJson, evaluatedAt);
  if (enrichmentAge) return { age: enrichmentAge, location: "enrichment_metadata" };

  return { age: null, location: null };
}

export function mergeRecoveredConsumerAge(
  normalizedPayloadJson: unknown,
  consumerAge: string
): Record<string, unknown> {
  const payload = asRecord(normalizedPayloadJson) ? { ...asRecord(normalizedPayloadJson)! } : {};
  if (readBuyerCsvV3ZipAndAge(payload).age) return payload;
  const details = asRecord(payload.lead_details) ? { ...asRecord(payload.lead_details)! } : {};
  details.consumer_age = consumerAge;
  payload.lead_details = details;
  payload.consumer_age = consumerAge;
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
  if (row.consumerAge) {
    payload.consumer_age = row.consumerAge;
    payload.lead_details = { consumer_age: row.consumerAge };
  }
  return payload as Prisma.JsonObject;
}

/**
 * Write a recovered person age onto normalizedPayloadJson.
 * No-op when the row already has a readable age or no stored source age exists.
 */
export async function backfillStoredConsumerAges(
  itemIds: string[],
  db: PrismaClient,
  evaluatedAt: Date = new Date()
): Promise<{ updatedIds: string[]; unchangedIds: string[] }> {
  const ids = [...new Set(itemIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return { updatedIds: [], unchangedIds: [] };

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
    if (!recovered.age || recovered.location === "normalized_payload") {
      unchangedIds.push(row.id);
      continue;
    }
    const next = mergeRecoveredConsumerAge(event.normalizedPayloadJson, recovered.age);
    await db.sourceLeadEvent.update({
      where: { id: event.id },
      data: { normalizedPayloadJson: next as Prisma.InputJsonValue },
    });
    updatedIds.push(row.id);
  }

  const seen = new Set(rows.map((row) => row.id));
  for (const id of ids) {
    if (!seen.has(id)) unchangedIds.push(id);
  }
  return { updatedIds, unchangedIds };
}
