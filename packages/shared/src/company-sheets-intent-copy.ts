/**
 * Operator wording for a campaign Sheets intent.
 * `scheduled` is never delivered. `pending` is recovered only when recovery
 * wrote reason `person_hold_recovered`.
 */

export type SheetsIntentOperatorCopy = {
  headline: string;
  detail: string;
  /** True only when the intent status is completed after a succeeded job. */
  delivered: boolean;
  recovered: boolean;
};

const RECOVERED_REASON = "person_hold_recovered";

export function companySheetsIntentOperatorCopy(input: {
  status: string;
  reason: string | null;
  lastError: string | null;
}): SheetsIntentOperatorCopy {
  const reason = input.reason;
  const code = input.lastError;
  if (input.status === "duplicate_held") {
    const detail =
      reason === "sheets_delivery_already_recorded"
        ? "A prior Sheets delivery owns this phone or email."
        : reason === "assessment_blocks_live_delivery"
          ? "The duplicate-risk assessment blocks live delivery."
          : "This phone or email is already reserved or admitted for the client.";
    return { headline: "Duplicate hold", detail: withCode(detail, code), delivered: false, recovered: false };
  }
  if (input.status === "review_held") {
    const detail =
      reason === "shared_identifier_conflict"
        ? "The phone and email belong to different people."
        : reason === "no_normalized_phone_or_email"
          ? "No usable phone or email."
          : reason === "history_coverage_partial"
            ? "Indexing is still in progress. The drain resumes it."
            : reason === "history_coverage_unavailable"
              ? "Indexing has not finished. The drain resumes it."
              : "This lead needs a person review before Sheets delivery.";
    return { headline: "Needs review", detail: withCode(detail, code), delivered: false, recovered: false };
  }
  if (input.status === "assessment_held") {
    return {
      headline: "Assessment missing",
      detail: withCode("The drain does not retry this. An operator can re-evaluate after an assessment exists.", code),
      delivered: false,
      recovered: false,
    };
  }
  if (input.status === "assessment_failed" && reason === "assessment_failed_transient") {
    return {
      headline: "Transient assessment failure",
      detail: withCode("The drain retries this. It has not been delivered.", code),
      delivered: false,
      recovered: false,
    };
  }
  if (input.status === "assessment_failed") {
    return {
      headline: "Assessment needs an operator",
      detail: withCode("The drain does not retry this. Re-evaluate after the assessment can be read.", code),
      delivered: false,
      recovered: false,
    };
  }
  if (input.status === "pending" && reason === RECOVERED_REASON) {
    return {
      headline: "Recovered from a hold",
      detail: "Waiting to schedule. Not delivered.",
      delivered: false,
      recovered: true,
    };
  }
  if (input.status === "pending") {
    return {
      headline: "Waiting to schedule",
      detail: "No Sheets job has been delivered for this intent.",
      delivered: false,
      recovered: false,
    };
  }
  if (input.status === "scheduled") {
    const uncertain = reason === "append_outcome_unresolved" || code === "uncertain";
    return {
      headline: uncertain ? "Scheduled, append outcome unknown" : "Scheduled",
      detail: uncertain
        ? "A job exists and the append outcome is unknown. This is not delivered and is not safe to retry as a new row."
        : "A job exists. Execution has not delivered a row.",
      delivered: false,
      recovered: false,
    };
  }
  if (input.status === "completed") {
    return {
      headline: "Sheets job succeeded",
      detail: "The campaign job finished as succeeded.",
      delivered: true,
      recovered: false,
    };
  }
  if (input.status === "retryable") {
    return {
      headline: "Retryable",
      detail: withCode("The drain can try again. Not delivered.", code),
      delivered: false,
      recovered: false,
    };
  }
  if (input.status === "processing") {
    return {
      headline: "Processing",
      detail: "The drain is working on this intent. Not delivered.",
      delivered: false,
      recovered: false,
    };
  }
  if (input.status === "awaiting_setup") {
    return {
      headline: "Awaiting setup",
      detail: withCode("The campaign tab or map is not ready. Not delivered.", code ?? reason),
      delivered: false,
      recovered: false,
    };
  }
  return {
    headline: input.status || "Unknown intent",
    detail: withCode(reason ?? "No reason is recorded.", code),
    delivered: false,
    recovered: false,
  };
}

function withCode(detail: string, code: string | null): string {
  if (!code) return detail;
  return `${detail} Code: ${code}.`;
}
