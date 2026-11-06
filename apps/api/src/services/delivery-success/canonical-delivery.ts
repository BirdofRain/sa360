/**
 * Canonical successful-delivery predicate for company Sheets campaign leads
 * and ongoing GoHighLevel association runs.
 *
 * Pure: it does not query, write, send, or change job or run status.
 * Sheets success does not imply GHL success. An HTTP status does not prove a
 * contact, a note, or a workflow. A test receipt is never canonical.
 *
 * `findProductionGhlReceipt` still requires mode `location_api` and is not
 * this predicate. A later assignment can teach that helper to call here.
 * This module does not edit the GHL writer or the Sheets writer.
 */

import {
  receiptFromPersistedStep,
  separateDeliveryResults,
  type VetDeliveryResults,
} from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";

export const COMPANY_SHEETS_CANONICAL_CHANNEL = "company_sheets" as const;
/** Notification and workspace channel. Production runs use mode `ongoing_association`. */
export const GHL_CANONICAL_CHANNEL = "ghl_location_api" as const;

const SYNTHETIC_CAMPAIGN_TEST_EVENT = "synthetic-campaign-test";
const ONBOARDING_TEST_KEY_PREFIX = "onboarding-test:";
const SHEETS_TEST_KINDS = new Set(["canary", "campaign_test", "onboarding_captured_test", "aged_release"]);
const SHEETS_OPEN_STATUSES = new Set(["queued", "running", "retryable", "uncertain"]);
const GHL_PRODUCTION_MODE = "ongoing_association";
const GHL_REJECTED_MODES = new Set(["location_api", "live_canary", "paused_location_test"]);
const GHL_QUALIFYING_STATUSES = new Set(["succeeded", "partial_success"]);
const GHL_OPEN_STATUSES = new Set(["executing", "failed", "skipped_duplicate"]);
const GHL_OPEN_OUTBOX = new Set(["uncertain", "executing"]);
const BAD_OPERATION_OUTCOMES = new Set(["ambiguous", "rejected", "failed_before_send"]);

export type CanonicalDeliveryVerdict = {
  channel: typeof COMPANY_SHEETS_CANONICAL_CHANNEL | typeof GHL_CANONICAL_CHANNEL;
  receiptId: string | null;
  sourceLeadEventId: string | null;
  canonical: boolean;
  /** Completion time. Sheets uses `finishedAt`. GHL uses the run `completedAt`. */
  at: string | null;
  reasons: string[];
};

export type CompanySheetsJobSnapshot = {
  id: string;
  kind: string;
  status: string;
  clientAccountId: string;
  sourceLeadEventId: string | null;
  idempotencyKey: string;
  rowsWritten: number;
  /**
   * The writer clears this when a job leaves `uncertain`. A succeeded receipt
   * often has it null. It is not a success signal.
   */
  appendStartedAt: Date | null;
  finishedAt: Date | null;
};

export type CompanySheetsRowSnapshot = {
  jobId?: string | null;
  status: string;
};

export type CompanySheetsDestinationSnapshot = {
  clientAccountId: string;
  campaignDispatchNotBefore: Date | null;
};

export type CompanySheetsIntentSnapshot = {
  kind: string;
  clientAccountId: string;
  sourceLeadEventId: string | null;
  /** When set, it must be this job. A null job id does not disqualify the intent. */
  jobId?: string | null;
  createdAt: Date;
};

/**
 * `spreadsheetDeliveredAt` is accepted on a campaign job and is never proof.
 * It is the aged-release operator mark, not a campaign receipt.
 */
export type CompanySheetsCanonicalInput =
  | {
      evidence: "campaign_job";
      job: CompanySheetsJobSnapshot;
      rows: CompanySheetsRowSnapshot[];
      destination: CompanySheetsDestinationSnapshot | null;
      intent: CompanySheetsIntentSnapshot | null;
      spreadsheetDeliveredAt?: Date | null;
      /**
       * `ClientOnboardingTestAttemptKey` values loaded by the scanner.
       * Null means they were not loaded, which is not a pass.
       */
      onboardingTestAttemptKeys: string[] | null;
    }
  | { evidence: "permission_probe"; at?: Date | null }
  | { evidence: "header_write"; at?: Date | null }
  | { evidence: "spreadsheet_delivered_at"; at?: Date | null };

export type GhlCanonicalStep = {
  stepType: string;
  status: string;
  externalId?: string | null;
  errorCode?: string | null;
  responseRedactedJson?: unknown;
};

export type GhlCanonicalInput = {
  run: {
    id: string;
    mode: string;
    status: string;
    completedAt: Date | null;
    destinationClientAccountId: string;
    idempotencyKey?: string | null;
  };
  steps: GhlCanonicalStep[];
  destination: {
    clientAccountId: string;
    workflowStartRequired: boolean;
  } | null;
  /** True when this delivery plan configured an opportunity write. */
  opportunityConfigured: boolean;
  /**
   * Writer setting from the destination field map or source-enrichment policy.
   * A note is never a hard failure. `ClientOnboardingDestinationProfile.notesEnabled`
   * is not read.
   */
  intakeSummaryNotesEnabled: boolean;
  /** Onboarding profile flag. Present so callers can see it is not the note requirement. */
  onboardingProfileNotesEnabled?: boolean;
  /** Missing profile is ignored. `notesEnabled` on this object is not a requirement. */
  profile?: {
    clientAccountId: string;
    notesEnabled: boolean;
  } | null;
  outbox: {
    status: string;
    clientAccountId: string;
    sourceLeadEventId: string;
    externalCallExecuted: boolean;
    lastError: string | null;
    liveRunId: string | null;
  } | null;
  /** Set when a `ClientOnboardingTestAttempt` belongs to this run. */
  onboardingTestAttemptId?: string | null;
  /**
   * `ClientOnboardingTestAttemptKey` values loaded by the scanner.
   * Null means they were not loaded, which is not a pass.
   */
  onboardingTestAttemptKeys: string[] | null;
};

type StoredReceipt = {
  operation: string;
  outcome: string;
  externalId: string | null;
  idempotencyKey: string;
};

export function canonicalCompanySheetsDelivery(input: CompanySheetsCanonicalInput): CanonicalDeliveryVerdict {
  if (input.evidence !== "campaign_job") {
    const reason =
      input.evidence === "permission_probe"
        ? "permission_probe"
        : input.evidence === "header_write"
          ? "header_write_only"
          : "spreadsheet_delivered_at";
    return sheetsVerdict({
      receiptId: null,
      sourceLeadEventId: null,
      at: iso(input.at),
      reasons: [reason],
    });
  }

  const { job, destination, intent } = input;
  const reasons: string[] = [];
  // The operator timestamp is not read. A real campaign job stays on the rules below.
  void input.spreadsheetDeliveredAt;

  if (job.kind !== "lead") {
    add(reasons, SHEETS_TEST_KINDS.has(job.kind) ? `kind_${job.kind}` : "kind_not_lead");
  }
  if (job.status !== "succeeded") {
    add(reasons, SHEETS_OPEN_STATUSES.has(job.status) ? `status_${job.status}` : "status_not_succeeded");
  }
  if (job.status === "uncertain" && present(job.appendStartedAt)) {
    add(reasons, "uncertain_after_append");
  }

  const sourceLeadEventId = text(job.sourceLeadEventId);
  if (!sourceLeadEventId) add(reasons, "source_lead_event_missing");
  else if (sourceLeadEventId === SYNTHETIC_CAMPAIGN_TEST_EVENT) add(reasons, "synthetic_campaign_test");
  if (isOnboardingTestKey(job.idempotencyKey)) add(reasons, "onboarding_test_key");
  assessOnboardingKeys(input.onboardingTestAttemptKeys, [job.idempotencyKey], reasons);

  if (!present(job.finishedAt)) add(reasons, "finished_at_missing");

  const rows = input.rows.filter((row) => row.jobId == null || row.jobId === job.id);
  if (job.rowsWritten < 1) add(reasons, "rows_written_missing");
  const written = rows.filter((row) => row.status === "written").length;
  if (rows.length === 0 || written < job.rowsWritten) add(reasons, "rows_not_confirmed");
  if (rows.some((row) => row.status !== "written")) add(reasons, "row_not_written");

  if (!destination) add(reasons, "destination_missing");
  else if (destination.clientAccountId !== job.clientAccountId) add(reasons, "client_mismatch");

  if (!intent) {
    add(reasons, "dispatch_intent_missing");
  } else {
    if (intent.kind !== "campaign_lead") add(reasons, "dispatch_intent_kind");
    if (intent.clientAccountId !== job.clientAccountId) add(reasons, "dispatch_intent_client_mismatch");
    if (intent.jobId != null && intent.jobId !== "" && intent.jobId !== job.id) {
      add(reasons, "dispatch_intent_job_mismatch");
    }
    if (sourceLeadEventId && intent.sourceLeadEventId !== sourceLeadEventId) {
      add(reasons, "dispatch_intent_event_mismatch");
    }
    const cutoff = destination ? present(destination.campaignDispatchNotBefore) : null;
    const createdAt = present(intent.createdAt);
    if (destination && !cutoff) add(reasons, "cutoff_missing");
    else if (destination && cutoff && (!createdAt || createdAt.getTime() < cutoff.getTime())) {
      add(reasons, "cutoff_not_satisfied");
    }
  }

  return sheetsVerdict({
    receiptId: job.id,
    sourceLeadEventId,
    at: iso(job.finishedAt),
    reasons,
  });
}

export function canonicalGhlDelivery(input: GhlCanonicalInput): CanonicalDeliveryVerdict {
  const { run, destination, outbox } = input;
  const reasons: string[] = [];
  const results = separateDeliveryResults(input.steps);
  const contactStep = stepOf(input.steps, "create_or_update_contact");
  const workflowStep = stepOf(input.steps, "start_workflow");
  const contactReceipt = storedReceipt(contactStep);
  const workflowReceipt = storedReceipt(workflowStep);
  const workflowRequired = destination?.workflowStartRequired === true;
  // The onboarding profile flag and the writer note switch are not success gates.
  void input.onboardingProfileNotesEnabled;
  void input.intakeSummaryNotesEnabled;
  void input.profile?.notesEnabled;

  if (run.mode !== GHL_PRODUCTION_MODE) {
    add(reasons, GHL_REJECTED_MODES.has(run.mode) ? `mode_${run.mode}` : "mode_not_ongoing_association");
  }
  if (!GHL_QUALIFYING_STATUSES.has(run.status)) {
    add(reasons, GHL_OPEN_STATUSES.has(run.status) ? `status_${run.status}` : "status_not_succeeded");
  }
  if (!present(run.completedAt)) add(reasons, "completed_at_missing");

  if (text(input.onboardingTestAttemptId) || isOnboardingTestKey(run.idempotencyKey)) {
    add(reasons, "onboarding_test_attempt");
  }
  const receiptKeys: string[] = [];
  for (const step of input.steps) {
    const receipt = storedReceipt(step);
    if (!receipt) continue;
    receiptKeys.push(receipt.idempotencyKey);
    if (isOnboardingTestKey(receipt.idempotencyKey)) add(reasons, "onboarding_test_attempt");
  }
  assessOnboardingKeys(input.onboardingTestAttemptKeys, [run.idempotencyKey, ...receiptKeys], reasons);

  if (!destination) add(reasons, "destination_missing");
  else if (destination.clientAccountId !== run.destinationClientAccountId) add(reasons, "client_mismatch");

  assessContact(results, contactStep, contactReceipt, reasons);
  flagBadOutcome(contactStep, reasons);
  assessTags(input.steps, reasons);
  assessOpportunity(input.steps, input.opportunityConfigured, reasons);
  assessWorkflow(results, workflowReceipt, workflowRequired, reasons);
  if (workflowRequired) flagBadOutcome(workflowStep, reasons);
  assessOutbox(outbox, run, reasons);

  return {
    channel: GHL_CANONICAL_CHANNEL,
    receiptId: run.id,
    sourceLeadEventId: outbox ? text(outbox.sourceLeadEventId) : null,
    canonical: reasons.length === 0,
    at: iso(run.completedAt),
    reasons,
  };
}

function assessContact(
  results: VetDeliveryResults,
  step: GhlCanonicalStep | undefined,
  receipt: StoredReceipt | null,
  reasons: string[]
) {
  const written = results.contact === "upserted" || results.contact === "replayed";
  const proven = receipt?.operation === "contact" && receipt.outcome === "completed";
  const externalId = text(step?.externalId) ?? receipt?.externalId ?? null;
  if (!written || !proven) {
    // Status succeeded plus HTTP 2xx is the writer's fallback, not a receipt.
    add(reasons, written && !proven ? "contact_not_proven" : "contact_not_upserted");
  }
  if (!externalId) add(reasons, "contact_external_id_missing");
}

function assessTags(steps: GhlCanonicalStep[], reasons: string[]) {
  const step = stepOf(steps, "add_tags");
  if (!step || step.status !== "succeeded") add(reasons, "tags_not_written");
  flagBadOutcome(step, reasons);
}

function assessOpportunity(steps: GhlCanonicalStep[], configured: boolean, reasons: string[]) {
  if (!configured) return;
  const step = stepOf(steps, "create_or_update_opportunity");
  if (!step || step.status !== "succeeded") add(reasons, "opportunity_not_written");
  flagBadOutcome(step, reasons);
}

function assessWorkflow(
  results: VetDeliveryResults,
  receipt: StoredReceipt | null,
  required: boolean,
  reasons: string[]
) {
  if (!required) return;
  const proven = receipt?.operation === "workflow" && receipt.outcome === "completed";
  const enrolled = results.workflow === "enrolled" || results.workflow === "replayed";
  if (enrolled && proven) return;
  // A note receipt, a contact upsert, or an HTTP status cannot prove enrollment.
  add(reasons, enrolled ? "workflow_not_proven" : "workflow_not_enrolled");
}

function flagBadOutcome(step: GhlCanonicalStep | undefined, reasons: string[]) {
  const outcome = operationOutcome(step);
  if (outcome && BAD_OPERATION_OUTCOMES.has(outcome)) add(reasons, `operation_outcome_${outcome}`);
}

function operationOutcome(step: GhlCanonicalStep | undefined): string | null {
  if (!step) return null;
  return storedReceipt(step)?.outcome ?? receiptFromPersistedStep(step)?.outcome ?? null;
}

function assessOnboardingKeys(
  keys: string[] | null | undefined,
  candidates: Array<string | null | undefined>,
  reasons: string[]
) {
  if (keys == null) {
    add(reasons, "onboarding_test_keys_not_supplied");
    return;
  }
  const loaded = new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0));
  for (const candidate of candidates) {
    const value = text(candidate);
    if (value && loaded.has(value)) {
      add(reasons, "onboarding_test_attempt");
      return;
    }
  }
}

function assessOutbox(
  outbox: GhlCanonicalInput["outbox"],
  run: GhlCanonicalInput["run"],
  reasons: string[]
) {
  if (!outbox) {
    add(reasons, "outbox_missing");
    return;
  }
  if (outbox.status !== "settled") {
    add(reasons, GHL_OPEN_OUTBOX.has(outbox.status) ? `outbox_${outbox.status}` : "outbox_not_settled");
  }
  if (outbox.externalCallExecuted !== true) add(reasons, "outbox_not_executed");
  if (outbox.lastError !== null) add(reasons, "outbox_last_error");
  if (outbox.liveRunId !== run.id) add(reasons, "outbox_run_mismatch");
  if (outbox.clientAccountId !== run.destinationClientAccountId) add(reasons, "outbox_client_mismatch");
  if (!text(outbox.sourceLeadEventId)) add(reasons, "source_lead_event_missing");
}

function sheetsVerdict(input: {
  receiptId: string | null;
  sourceLeadEventId: string | null;
  at: string | null;
  reasons: string[];
}): CanonicalDeliveryVerdict {
  return {
    channel: COMPANY_SHEETS_CANONICAL_CHANNEL,
    receiptId: input.receiptId,
    sourceLeadEventId: input.sourceLeadEventId,
    canonical: input.reasons.length === 0,
    at: input.at,
    reasons: input.reasons,
  };
}

function stepOf(steps: GhlCanonicalStep[], stepType: string): GhlCanonicalStep | undefined {
  return steps.find((step) => step.stepType === stepType);
}

function storedReceipt(step: GhlCanonicalStep | undefined): StoredReceipt | null {
  const response = asRecord(step?.responseRedactedJson);
  const receipt = asRecord(response?.vetOperationReceipt);
  if (!receipt || typeof receipt.operation !== "string" || typeof receipt.outcome !== "string") return null;
  const externalId = text(typeof receipt.externalId === "string" ? receipt.externalId : null);
  return {
    operation: receipt.operation,
    outcome: receipt.outcome,
    externalId,
    idempotencyKey: typeof receipt.idempotencyKey === "string" ? receipt.idempotencyKey : "",
  };
}

function isOnboardingTestKey(key: string | null | undefined): boolean {
  return typeof key === "string" && key.trim().startsWith(ONBOARDING_TEST_KEY_PREFIX);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function present(value: Date | null | undefined): Date | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value;
}

function iso(value: Date | null | undefined): string | null {
  return present(value)?.toISOString() ?? null;
}

function add(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}
