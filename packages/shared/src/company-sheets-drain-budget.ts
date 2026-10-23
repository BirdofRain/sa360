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

export const COMPANY_SHEETS_INTENT_BUDGET_MS =
  COMPANY_SHEETS_INTENT_HTTP_CALL_CEILING * COMPANY_SHEETS_GOOGLE_HTTP_TIMEOUT_MS +
  COMPANY_SHEETS_INTENT_DB_SLACK_MS;

/**
 * Executions one drain request may start. A concurrent request has its own count.
 */
export const COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS = 1;

/**
 * Allowance for writing the drain response after the execution returns.
 * The API process does not cancel the handler when this allowance ends.
 */
export const COMPANY_SHEETS_DRAIN_RESPONSE_SLACK_MS = 15_000;

/**
 * How long the worker waits for one drain POST.
 * This is not an API execution ceiling. The handler continues after the
 * worker stops waiting, and a stalled event loop does not honor the timer.
 */
export const COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS =
  COMPANY_SHEETS_INTENT_BUDGET_MS * COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS +
  COMPANY_SHEETS_DRAIN_RESPONSE_SLACK_MS;
