/**
 * Recurring consumer-age birthday sweep.
 *
 * A date-of-birth lead that is age 86 today is age 87 tomorrow, so inventory
 * that was legitimately sellable when it was activated can cross the maximum
 * sellable age while sitting unallocated. This sweep re-resolves those rows and
 * stamps the ones that crossed as commercially dead.
 *
 * It owns no business rules. Candidate selection, the bounded resumable scan,
 * and the lifecycle write are the same ones the manual CLI uses — this module
 * only supplies the schedule-safe defaults (DOB-only candidates, a small batch
 * size, the operator identity, the environment guard). The manual CLI remains
 * available and is unaffected.
 *
 * Reservation is still the final safety gate: fulfillment re-validates age at
 * reservation, commit, and release regardless of what this sweep has seen.
 */

import type { PrismaClient } from "@prisma/client";

import { prisma as defaultPrisma } from "../../lib/db.js";
import {
  getConsumerAgeBirthdaySweepBatchSize,
  getConsumerAgeBirthdaySweepExpectedDbHost,
  getConsumerAgeBirthdaySweepMaxScanRows,
  isConsumerAgeBirthdaySweepEnabled,
} from "../../lib/consumer-age-birthday-sweep-env.js";
import {
  CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
  commitConsumerAgeOverMaximumClassification,
  type ConsumerAgeCommitRefusalCode,
  type ConsumerAgeDeadClassificationSkipReason,
  type ConsumerAgeMaintenanceCoverage,
  type ConsumerAgeMaintenanceCursor,
  type ConsumerAgeMaintenanceScopeInput,
} from "./consumer-age-inventory-maintenance.service.js";

export const CONSUMER_AGE_BIRTHDAY_SWEEP_SCHEMA = "consumer_age_birthday_sweep_v1" as const;

/** Recorded as the writing operator so swept rows are auditable. */
export const CONSUMER_AGE_BIRTHDAY_SWEEP_OPERATOR = "consumer_age_birthday_sweep" as const;

export type ConsumerAgeBirthdaySweepInput = {
  /** Resume point from the previous invocation's `nextCursor`. */
  cursor?: { afterGeneratedAt: Date | string; afterId: string } | null;
  /** Rows this invocation may write. Defaults to the configured batch size. */
  batchSize?: number;
  /** Rows this invocation may read. Defaults to the configured scan ceiling. */
  maxScanRows?: number;
  evaluatedAt?: Date;
  /** Overridable for tests; defaults to the process `DATABASE_URL`. */
  databaseUrl?: string;
  /** Overridable for tests; defaults to the configured authorized host. */
  expectedDbHost?: string;
};

export type ConsumerAgeBirthdaySweepResult = {
  schema: typeof CONSUMER_AGE_BIRTHDAY_SWEEP_SCHEMA;
  outcome: "DISABLED" | "CLASSIFIED" | "NOOP" | "REFUSED" | "FAILED";
  ok: boolean;
  enabled: boolean;
  writesAttempted: boolean;
  reasonCode?: ConsumerAgeCommitRefusalCode | "sweep_disabled" | "expected_db_host_required";
  reason?: string;
  evaluatedAt?: string;
  dbHostVerified?: string;
  batchSize?: number;
  maxScanRows?: number;
  /** Authoritative completion signal. `partial` means more work remains. */
  coverage?: ConsumerAgeMaintenanceCoverage;
  /** Non-null exactly when `coverage` is `partial`. Chain it on the next run. */
  nextCursor?: ConsumerAgeMaintenanceCursor | null;
  rowsScanned?: number;
  matchingRows?: number;
  candidatesInScannedWindow?: number;
  candidatesWritten?: number;
  /** Aggregate skip reasons only — enough to audit without emitting row data. */
  skippedByReason?: Partial<Record<ConsumerAgeDeadClassificationSkipReason, number>>;
  classifiedIds?: string[];
};

function refused(
  reasonCode: NonNullable<ConsumerAgeBirthdaySweepResult["reasonCode"]>,
  reason: string,
  enabled: boolean
): ConsumerAgeBirthdaySweepResult {
  return {
    schema: CONSUMER_AGE_BIRTHDAY_SWEEP_SCHEMA,
    outcome: reasonCode === "sweep_disabled" ? "DISABLED" : "REFUSED",
    ok: reasonCode === "sweep_disabled",
    enabled,
    writesAttempted: false,
    reasonCode,
    reason,
  };
}

/**
 * Run one bounded sweep batch.
 *
 * Refuses unless the sweep flag is on and the target database host matches the
 * configured authorization, so an accidentally pointed `DATABASE_URL` cannot be
 * written to. Disabled is a successful no-op, not a failure: the schedule must
 * be able to exist while the flag is off.
 */
export async function runConsumerAgeBirthdaySweep(
  input: ConsumerAgeBirthdaySweepInput = {},
  db: PrismaClient = defaultPrisma
): Promise<ConsumerAgeBirthdaySweepResult> {
  const enabled = isConsumerAgeBirthdaySweepEnabled();
  if (!enabled) {
    return refused("sweep_disabled", "consumer_age_birthday_sweep_disabled", false);
  }

  const expectedDbHost = input.expectedDbHost ?? getConsumerAgeBirthdaySweepExpectedDbHost();
  if (!expectedDbHost) {
    return refused(
      "expected_db_host_required",
      "SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_EXPECTED_DB_HOST_required",
      true
    );
  }

  const batchSize = input.batchSize ?? getConsumerAgeBirthdaySweepBatchSize();
  const maxScanRows = input.maxScanRows ?? getConsumerAgeBirthdaySweepMaxScanRows();
  const evaluatedAt = input.evaluatedAt ?? new Date();

  // Date-of-birth candidates only: a stored integer age does not change by
  // itself, so sweeping it repeatedly would write nothing and only widen the
  // automatic write population.
  const scope: ConsumerAgeMaintenanceScopeInput = {
    dateOfBirthOnly: true,
    maxScanRows,
    cursor: input.cursor ?? null,
    evaluatedAt,
  };

  const result = await commitConsumerAgeOverMaximumClassification(
    {
      expectedDbHost,
      databaseUrl: input.databaseUrl ?? process.env.DATABASE_URL ?? "",
      operator: CONSUMER_AGE_BIRTHDAY_SWEEP_OPERATOR,
      confirm: CONSUMER_AGE_DEAD_CLASSIFY_CONFIRMATION,
      limit: batchSize,
      scope,
    },
    db
  );

  const skippedByReason: Partial<Record<ConsumerAgeDeadClassificationSkipReason, number>> = {};
  for (const entry of result.skipped ?? []) {
    skippedByReason[entry.reason] = (skippedByReason[entry.reason] ?? 0) + 1;
  }

  return {
    schema: CONSUMER_AGE_BIRTHDAY_SWEEP_SCHEMA,
    outcome: result.outcome,
    ok: result.ok,
    enabled: true,
    writesAttempted: result.writesAttempted,
    reasonCode: result.reasonCode,
    reason: result.reason,
    evaluatedAt: result.evaluatedAt ?? evaluatedAt.toISOString(),
    dbHostVerified: result.dbHostVerified,
    batchSize,
    maxScanRows,
    coverage: result.coverage,
    nextCursor: result.nextCursor ?? null,
    rowsScanned: result.scan?.rowsScanned,
    matchingRows: result.scan?.matchingRows,
    candidatesInScannedWindow: result.candidatesInScannedWindow,
    candidatesWritten: result.candidatesWritten,
    skippedByReason,
    classifiedIds: result.classifiedIds,
  };
}
