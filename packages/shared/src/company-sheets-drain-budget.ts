/**
 * Worst-case sequential Google HTTP calls inside one delivery execution.
 * Each call is capped at 10s (Sheets and OAuth). Production defaults:
 * ancestry limit 20 and maxBatches 4.
 *
 * oauth refresh, spreadsheet metadata, drive file,
 * 20 ancestor reads, header read, blank-sheet probe, header write,
 * pre-append reconcile, and 4 batches of (append + ambiguous reconcile).
 */
export const COMPANY_SHEETS_INTENT_HTTP_CALL_CEILING = 35;

export const COMPANY_SHEETS_GOOGLE_HTTP_TIMEOUT_MS = 10_000;

/**
 * Allowance for database work around those HTTP calls.
 * Not a statement_timeout and not a pool timeout. Interactive transactions
 * on this path keep Prisma's defaults. Other queries can outlast this number.
 */
export const COMPANY_SHEETS_INTENT_DB_SLACK_MS = 30_000;

/** Wall clock a drain may use before it stops claiming another execution. */
export const COMPANY_SHEETS_INTENT_BUDGET_MS =
  COMPANY_SHEETS_INTENT_HTTP_CALL_CEILING * COMPANY_SHEETS_GOOGLE_HTTP_TIMEOUT_MS +
  COMPANY_SHEETS_INTENT_DB_SLACK_MS;

/**
 * How long a running delivery or a processing intent stays reserved.
 * Same length as the start budget. When it ends, a later drain does not
 * append again: an earlier Google request can still be open.
 */
export const COMPANY_SHEETS_EXECUTION_LEASE_MS = COMPANY_SHEETS_INTENT_BUDGET_MS;

/**
 * Hard stop so a frozen clock cannot claim forever.
 * Fast executions still share the start budget up to the request limit.
 */
export const COMPANY_SHEETS_DRAIN_SAFETY_CAP = 50;

/**
 * Allowance for writing the drain response after the handler returns.
 * The API process does not cancel the handler when this allowance ends.
 */
export const COMPANY_SHEETS_DRAIN_RESPONSE_SLACK_MS = 15_000;

/**
 * How long the worker waits for one drain POST.
 * This is not an API execution ceiling. The handler continues after the
 * worker stops waiting, and a stalled event loop does not honor the timer.
 */
export const COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS =
  COMPANY_SHEETS_INTENT_BUDGET_MS + COMPANY_SHEETS_DRAIN_RESPONSE_SLACK_MS;
