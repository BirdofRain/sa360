/**
 * Read-only Sheets, intake, and onboarding counts.
 * Execute does not call this, and the result is not a rollback trigger.
 * The 15-minute intake counts age out and change when a row leaves `received`,
 * so a window delta is not a delivery failure. An increase in
 * processing_intents or running_appends is concurrent work, not a failure.
 * Current-state error counts stay in the comparison for review only.
 */
export const deliveryBaselineSql = `
SELECT json_build_object(
  'uncertain_jobs', (SELECT count(*) FROM "CompanySheetsDeliveryJob" WHERE status = 'uncertain'),
  'running_appends', (SELECT count(*) FROM "CompanySheetsDeliveryJob" WHERE status = 'running' AND "appendStartedAt" IS NOT NULL),
  'intent_errors', (SELECT count(*) FROM "CompanySheetsDispatchIntent" WHERE "lastError" IS NOT NULL AND status <> 'completed'),
  'job_errors', (SELECT count(*) FROM "CompanySheetsDeliveryJob" WHERE "lastError" IS NOT NULL AND status <> 'succeeded'),
  'processing_intents', (SELECT count(*) FROM "CompanySheetsDispatchIntent" WHERE status = 'processing'),
  'retryable_intents', (SELECT count(*) FROM "CompanySheetsDispatchIntent" WHERE status = 'retryable'),
  'intake_rejected', (SELECT count(*) FROM "SourceLeadEvent" WHERE status = 'rejected' AND "receivedAt" >= now() - interval '15 minutes'),
  'intake_delivery_failed', (SELECT count(*) FROM "SourceLeadEvent" WHERE status = 'delivery_failed' AND "receivedAt" >= now() - interval '15 minutes'),
  'intake_received', (SELECT count(*) FROM "SourceLeadEvent" WHERE status = 'received' AND "receivedAt" >= now() - interval '15 minutes'),
  'onboarding_uncertain_attempts', (SELECT count(*) FROM "ClientOnboardingTestAttempt" WHERE status IN ('failed', 'uncertain') OR "uncertainReason" IS NOT NULL)
)::text
`.trim();

const COUNT_KEYS = [
  "uncertain_jobs",
  "running_appends",
  "intent_errors",
  "job_errors",
  "processing_intents",
  "retryable_intents",
  "intake_rejected",
  "intake_delivery_failed",
  "intake_received",
  "onboarding_uncertain_attempts",
];

const WINDOW_KEYS = ["intake_received", "intake_rejected", "intake_delivery_failed"];
const IN_FLIGHT_KEYS = ["processing_intents", "running_appends"];
const INCREASE_KEYS = [
  "uncertain_jobs",
  "intent_errors",
  "job_errors",
  "retryable_intents",
  "onboarding_uncertain_attempts",
];

const FLAG_KEYS = ["sheets_execution", "sheets_dispatch", "onboarding_read", "onboarding_config"];

export function emptyDeliveryBaseline() {
  return {
    ...Object.fromEntries(COUNT_KEYS.map((key) => [key, 0])),
    flags: {
      sheets_execution: true,
      sheets_dispatch: true,
      onboarding_read: true,
      onboarding_config: true,
    },
  };
}

export function parseDeliveryBaseline(text, flags = {}) {
  const line = String(text ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter((item) => item.startsWith("{"))
    .at(-1);
  if (!line) return { ok: false, code: "delivery_baseline_unreadable" };
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, code: "delivery_baseline_unreadable" };
  }
  const snapshot = { flags: { ...flags } };
  for (const key of COUNT_KEYS) {
    const value = Number(parsed?.[key]);
    if (!Number.isInteger(value) || value < 0) return { ok: false, code: "delivery_baseline_unreadable" };
    snapshot[key] = value;
  }
  return { ok: true, snapshot };
}

export function evaluateDeliveryBaseline(before, after, options = {}) {
  if (!before || !after) return { ok: false, failures: ["delivery_baseline_missing"] };
  const failures = [];
  const inflight = Number(before.processing_intents) + Number(before.running_appends);
  if (!Number.isFinite(inflight)) failures.push("delivery_inflight_unreadable");
  else if (inflight > 0 && options.releaseWindow !== true) failures.push("delivery_inflight_window");
  for (const key of INCREASE_KEYS) {
    if (typeof before[key] !== "number" || typeof after[key] !== "number") failures.push(`delivery_${key}_unreadable`);
    else if (after[key] > before[key]) failures.push(`delivery_${key}_increased`);
  }
  const observations = {};
  for (const key of [...WINDOW_KEYS, ...IN_FLIGHT_KEYS]) {
    observations[key] = { before: Number(before[key]), after: Number(after[key]) };
  }
  for (const key of FLAG_KEYS) {
    if (before.flags?.[key] !== true || after.flags?.[key] !== true) failures.push(`delivery_${key}_flag`);
  }
  return { ok: failures.length === 0, failures, observations };
}
