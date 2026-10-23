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

/** Prisma claim, row, and lock work around those HTTP calls. */
export const COMPANY_SHEETS_INTENT_DB_SLACK_MS = 30_000;

export const COMPANY_SHEETS_INTENT_BUDGET_MS =
  COMPANY_SHEETS_INTENT_HTTP_CALL_CEILING * COMPANY_SHEETS_GOOGLE_HTTP_TIMEOUT_MS +
  COMPANY_SHEETS_INTENT_DB_SLACK_MS;

/**
 * Executions one drain may start. A second execution waits for the next tick
 * so the worker timeout can cover the in-flight one.
 */
export const COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS = 1;

/** Time for the API to send the drain response after the execution returns. */
export const COMPANY_SHEETS_DRAIN_RESPONSE_SLACK_MS = 15_000;

export const COMPANY_SHEETS_DISPATCH_HTTP_TIMEOUT_MS =
  COMPANY_SHEETS_INTENT_BUDGET_MS * COMPANY_SHEETS_DRAIN_MAX_EXECUTIONS +
  COMPANY_SHEETS_DRAIN_RESPONSE_SLACK_MS;
