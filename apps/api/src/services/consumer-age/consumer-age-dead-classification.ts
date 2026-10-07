/**
 * The single consumer-age "commercially dead" lifecycle writer.
 *
 * A known consumer age above the maximum sellable age is a permanent defect:
 * such inventory must never appear operationally as available. This module is
 * the only place that turns that fact into a write, so the manual maintenance
 * CLI, the inventory creation/activation paths, and the recurring birthday
 * sweep all apply the identical rule. Callers must not re-implement it.
 *
 * Guarantees enforced here, not by callers:
 *   - Allocated inventory is never touched. Any `LeadAllocation` of any status,
 *     including a delivered historical package, makes the item untouchable.
 *   - `reserved` / `committed` / `fulfilled` items are never touched.
 *   - An already commerce-excluded item is left exactly as stamped.
 *   - Age is re-resolved while the row is locked, so a row whose age changed
 *     between selection and write is skipped rather than mis-stamped.
 *   - A missing or unusable age is NEVER dead. Incomplete enrichment is
 *     recoverable (`Ineligible — Age required`), not a permanent defect.
 *   - A canonical age that materially disagrees with an explicit date of birth
 *     is held, not stamped. The disagreement might be the date of birth that is
 *     wrong, and a permanent dead stamp is as automatic a mutation as rewriting
 *     the value. Reservation refuses the row either way, so holding costs
 *     nothing commercially and leaves the decision to a human.
 *
 * Errors are not swallowed. A failure inside a caller's lifecycle transaction
 * aborts that transaction in Postgres anyway, and inventory whose age could not
 * be checked must not become live.
 */

import type { LeadInventoryItemStatus, Prisma, PrismaClient } from "@prisma/client";

import {
  CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
  CONSUMER_AGE_POLICY_VERSION,
  readNormalizedConsumerAgeCell,
  resolveConsumerAgeForFulfillment,
  type ResolvedConsumerAge,
} from "./consumer-age-policy.js";

/** Statuses whose age must never be reclassified. */
export const CONSUMER_AGE_DEAD_BLOCKED_STATUSES = [
  "reserved",
  "committed",
  "fulfilled",
] as const satisfies readonly LeadInventoryItemStatus[];

export type ConsumerAgeDeadClassificationSkipReason =
  | "item_not_found"
  | "already_excluded"
  | "allocation_exists"
  | "blocked_status"
  | "age_no_longer_over_maximum"
  | "canonical_age_conflict"
  | "update_race";

export type ConsumerAgeDeadClassificationOutcome =
  | "classified"
  | ConsumerAgeDeadClassificationSkipReason;

/**
 * The lifecycle transaction surface this writer needs. Accepting the caller's
 * transaction client is deliberate: creation and activation must stamp the
 * exclusion inside the same authorized transaction that made the row live.
 */
export type ConsumerAgeLifecycleTx = Pick<
  PrismaClient,
  "$queryRaw" | "leadAllocation" | "leadInventoryItem"
>;

type LockedDeadRow = {
  id: string;
  status: string;
  commerceExcludedAt: Date | null;
  metadataJson: Prisma.JsonValue;
  normalizedPayloadJson: Prisma.JsonValue;
  rawPayloadJson: Prisma.JsonValue;
  enrichmentMetadataJson: Prisma.JsonValue;
};

/**
 * A stored canonical age that materially disagrees with an explicit date of
 * birth. The resolver prefers the date of birth, so canonical `55` against a
 * date of birth that resolves to `87` silently reclassifies the row. Neither an
 * automatic repair nor an automatic dead stamp may act on that disagreement.
 *
 * This is the single definition. The maintenance scan uses it to withhold the
 * row from both commit paths, and the lifecycle writer below uses it so the
 * creation, activation, review, sweep, and CLI call sites cannot bypass the
 * scan's judgement by invoking the writer directly.
 */
export function isCanonicalAgeConflictHold(
  normalizedPayloadJson: unknown,
  resolved: ResolvedConsumerAge
): boolean {
  if (resolved.dateOfBirth == null || resolved.age == null) return false;
  const canonicalAge = readNormalizedConsumerAgeCell(normalizedPayloadJson);
  return canonicalAge !== "" && canonicalAge !== String(resolved.age);
}

/** The exact stamp written for inventory over the maximum sellable age. */
export const CONSUMER_AGE_DEAD_EXCLUSION_STAMP = {
  status: "expired",
  commerceExcludedReason: CONSUMER_AGE_OVER_MAXIMUM_EXCLUSION_REASON,
  commerceExcludedBy: CONSUMER_AGE_POLICY_VERSION,
} as const;

/**
 * Classify one unallocated inventory item as commercially dead when its
 * canonical consumer age is above the maximum sellable age.
 *
 * Runs inside the caller's transaction and takes a row lock on the item, so it
 * is safe to call from an inventory creation or activation transaction that has
 * just made the row live. Idempotent: a second call returns `already_excluded`
 * and writes nothing.
 */
export async function classifyConsumerAgeOverMaximum(
  tx: ConsumerAgeLifecycleTx,
  itemId: string,
  evaluatedAt: Date
): Promise<ConsumerAgeDeadClassificationOutcome> {
  const locked = await tx.$queryRaw<LockedDeadRow[]>`
    SELECT
      i.id,
      i.status::text AS status,
      i."commerceExcludedAt",
      i."metadataJson",
      e."normalizedPayloadJson",
      e."rawPayloadJson",
      e."enrichmentMetadataJson"
    FROM "LeadInventoryItem" i
    JOIN "SourceLeadEvent" e ON e.id = i."sourceLeadEventId"
    WHERE i.id = ${itemId}
    FOR UPDATE OF i
  `;
  const row = locked[0];
  if (!row) return "item_not_found";
  if (row.commerceExcludedAt != null) return "already_excluded";
  if ((CONSUMER_AGE_DEAD_BLOCKED_STATUSES as readonly string[]).includes(row.status)) {
    return "blocked_status";
  }

  const allocationCount = await tx.leadAllocation.count({
    where: { leadInventoryItemId: itemId },
  });
  if (allocationCount > 0) return "allocation_exists";

  const resolved = resolveConsumerAgeForFulfillment({
    normalizedPayloadJson: row.normalizedPayloadJson,
    rawPayloadJson: row.rawPayloadJson,
    metadataJson: row.metadataJson,
    enrichmentMetadataJson: row.enrichmentMetadataJson,
    evaluatedAt,
  });
  // A missing or unusable age is recoverable, never dead.
  if (resolved.status !== "over_maximum_age") return "age_no_longer_over_maximum";
  if (isCanonicalAgeConflictHold(row.normalizedPayloadJson, resolved)) {
    return "canonical_age_conflict";
  }

  const now = new Date();
  const updated = await tx.leadInventoryItem.updateMany({
    where: {
      id: itemId,
      commerceExcludedAt: null,
      status: { notIn: [...CONSUMER_AGE_DEAD_BLOCKED_STATUSES] },
    },
    data: {
      status: CONSUMER_AGE_DEAD_EXCLUSION_STAMP.status,
      expiredAt: now,
      commerceExcludedAt: now,
      commerceExcludedReason: CONSUMER_AGE_DEAD_EXCLUSION_STAMP.commerceExcludedReason,
      commerceExcludedBy: CONSUMER_AGE_DEAD_EXCLUSION_STAMP.commerceExcludedBy,
    },
  });
  if (updated.count !== 1) return "update_race";
  return "classified";
}

/** Same rule, in its own transaction. Used when no lifecycle transaction is open. */
export async function classifyConsumerAgeOverMaximumTransactionally(
  db: PrismaClient,
  itemId: string,
  evaluatedAt: Date
): Promise<ConsumerAgeDeadClassificationOutcome> {
  return db.$transaction((tx) =>
    classifyConsumerAgeOverMaximum(tx as unknown as ConsumerAgeLifecycleTx, itemId, evaluatedAt)
  );
}

export type ConsumerAgeDeadClassificationBatch = {
  classifiedIds: string[];
  skipped: Array<{ id: string; reason: ConsumerAgeDeadClassificationSkipReason }>;
};

/** One independent transaction per item, so one contended row cannot stall a batch. */
export async function classifyConsumerAgeOverMaximumBatch(
  db: PrismaClient,
  itemIds: readonly string[],
  evaluatedAt: Date
): Promise<ConsumerAgeDeadClassificationBatch> {
  const classifiedIds: string[] = [];
  const skipped: ConsumerAgeDeadClassificationBatch["skipped"] = [];
  for (const itemId of itemIds) {
    const outcome = await classifyConsumerAgeOverMaximumTransactionally(db, itemId, evaluatedAt);
    if (outcome === "classified") classifiedIds.push(itemId);
    else skipped.push({ id: itemId, reason: outcome });
  }
  return { classifiedIds, skipped };
}