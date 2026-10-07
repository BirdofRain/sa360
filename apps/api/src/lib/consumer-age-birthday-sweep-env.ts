/**
 * Feature flags for the recurring consumer-age birthday sweep.
 *
 * A date-of-birth lead can be age 86 today and 87 tomorrow, so inventory that
 * was sellable at activation has to be re-checked. The sweep is OFF by default:
 * deploying this code must not start writing to production inventory.
 */

function parseTruthyFlag(raw: string | undefined): boolean {
  const value = raw?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number
): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const asInt = Math.trunc(parsed);
  if (asInt < min || asInt > max) return fallback;
  return asInt;
}

/** When true, the sweep may write. Default: false. */
export function isConsumerAgeBirthdaySweepEnabled(): boolean {
  return parseTruthyFlag(process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED);
}

/** Sweep cadence in minutes. Default 360 (4×/day); outside [15, 1440] uses the default. */
export function getConsumerAgeBirthdaySweepIntervalMinutes(): number {
  return parseBoundedInt(
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_INTERVAL_MINUTES,
    360,
    15,
    1440
  );
}

/** Rows one sweep invocation may write. Default 200; outside [1, 1000] uses the default. */
export function getConsumerAgeBirthdaySweepBatchSize(): number {
  return parseBoundedInt(process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_BATCH_SIZE, 200, 1, 1_000);
}

/** Rows one sweep invocation may read. Default 5000; outside [1, 50000] uses the default. */
export function getConsumerAgeBirthdaySweepMaxScanRows(): number {
  return parseBoundedInt(
    process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_SCAN_ROWS,
    5_000,
    1,
    50_000
  );
}

/**
 * Host (or `host:port`) the sweep is authorized to write to. Required even when
 * the flag is on, so a misdirected `DATABASE_URL` refuses instead of writing.
 */
export function getConsumerAgeBirthdaySweepExpectedDbHost(): string {
  return process.env.SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_EXPECTED_DB_HOST?.trim() ?? "";
}
