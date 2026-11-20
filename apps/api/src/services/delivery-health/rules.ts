/**
 * Pure delivery-health rules.
 * A Sheets receipt is canonicalCompanySheetsDelivery: succeeded job, written
 * rows, finishedAt, and the campaign intent. HTTP status is not an input.
 * This module does not query, write, send, or retry.
 */

import { isCompanySheetsInternalPilotLead } from "@sa360/shared";

import { canonicalCompanySheetsDelivery } from "../delivery-success/canonical-delivery.js";
import {
  machineCode,
  type DeliveryHealthSubject,
} from "./evidence.js";

export const DELIVERY_HEALTH_DISPATCH_WARNING_MS = 2 * 60 * 1000;
export const DELIVERY_HEALTH_RECEIPT_WARNING_MS = 5 * 60 * 1000;
export const DELIVERY_HEALTH_ESCALATION_MS = 15 * 60 * 1000;

export const DELIVERY_HEALTH_FAILURE_CLASSES = [
  "google_authorization",
  "google_permission",
  "google_configuration",
  "uncertain_append",
  "missing_dispatch",
  "sheets_receipt_delayed",
  "sheets_receipt_unverified",
  "missing_intake",
] as const;

export type DeliveryHealthFailureClass = (typeof DELIVERY_HEALTH_FAILURE_CLASSES)[number];
export type DeliveryHealthSeverity = "warning" | "critical";

const ROUTED = new Set(["routing_matched", "approved", "delivered", "delivery_failed"]);
const EXPECTED_HOLDS = new Set([
  "awaiting_setup",
  "needs_explicit_schedule",
  "duplicate_held",
  "review_held",
  "assessment_held",
  "assessment_failed",
]);
const SUPPRESSED_CODES = new Set([
  "person_duplicate",
  "person_review",
  "assessment_missing",
  "assessment_failed",
]);
const AUTH_CODES = new Set(["unauthorized", "google_reconnect_required", "google_not_connected"]);
const PERMISSION_CODES = new Set(["access_denied", "insufficient_capability"]);
const CONFIG_CODES = new Set([
  "not_company_controlled",
  "approved_drive_unconfigured",
  "worksheet_unavailable",
  "invalid_request",
  "not_found",
  "schema_mismatch",
  "header_mismatch",
  "header_conflict",
  "header_changed",
  "mapping_required",
  "mapping_unresolved",
  "custom_writer_disabled",
  "required_field_unmapped",
  "tab_missing",
  "tab_incompatible",
  "destination_not_configured",
  "company_connection_changed",
]);
const INTAKE_PROCESSING = new Set(["stored", "captured"]);
const TEST_KINDS = new Set(["canary", "campaign_test", "onboarding_captured_test"]);
const SYNTHETIC_EVENT = "synthetic-campaign-test";

const DELAY_CLASSES = new Set<DeliveryHealthFailureClass>([
  "missing_dispatch",
  "sheets_receipt_delayed",
  "missing_intake",
]);

export type DeliveryHealthLead = {
  id: string;
  clientAccountId: string;
  status: string;
  routedAt: Date | null;
  receivedAt: Date;
  sourceRouteKey: string | null;
  cleanupStatus: string | null;
  enrichmentMetadataJson?: unknown;
};

export type DeliveryHealthIntent = {
  id: string;
  clientAccountId: string;
  sourceLeadEventId: string | null;
  kind: string;
  status: string;
  reason: string | null;
  lastError: string | null;
  jobId: string | null;
  createdAt: Date;
};

export type DeliveryHealthJob = {
  id: string;
  kind: string;
  status: string;
  clientAccountId: string;
  sourceLeadEventId: string | null;
  idempotencyKey: string;
  rowsWritten: number;
  appendStartedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
  uncertainReason: string | null;
  createdAt: Date;
};

export type DeliveryHealthRow = {
  jobId: string;
  status: string;
};

export type DeliveryHealthDestination = {
  campaignDispatchEnabled: boolean;
  campaignDispatchNotBefore: Date | null;
};

export type DeliveryHealthClient = {
  clientAccountId: string;
  status: string;
  destination: DeliveryHealthDestination | null;
};

/** Confirmed intake gap. A webhook audit row alone is not enough. */
export type DeliveryHealthIntakeCandidate = {
  clientAccountId: string;
  routingDryRunDecisionId: string;
  webhookRequestLogId: string;
  processingStatus: string;
  httpStatus: number | null;
  completedAt: Date | null;
  sourceEventExists: boolean;
  syntheticPilot: boolean;
  matched: boolean;
};

export type DeliveryHealthSnapshot = {
  clients: DeliveryHealthClient[];
  leads: DeliveryHealthLead[];
  intents: DeliveryHealthIntent[];
  jobs: DeliveryHealthJob[];
  rows: DeliveryHealthRow[];
  onboardingTestAttemptKeys: string[];
  intake: DeliveryHealthIntakeCandidate[];
};

export type DeliveryHealthFinding = {
  clientAccountId: string;
  failureClass: DeliveryHealthFailureClass;
  severity: DeliveryHealthSeverity;
  affectedCount: number;
  subjects: DeliveryHealthSubject[];
};

type Draft = {
  clientAccountId: string;
  failureClass: DeliveryHealthFailureClass;
  severity: DeliveryHealthSeverity;
  subject: DeliveryHealthSubject;
};

export function delayMonitoringSuppressed(client: DeliveryHealthClient | undefined): boolean {
  if (!client || client.status !== "active") return true;
  const destination = client.destination;
  if (!destination?.campaignDispatchEnabled || !destination.campaignDispatchNotBefore) return true;
  return false;
}

export function evaluateDeliveryHealth(snapshot: DeliveryHealthSnapshot, now: Date): DeliveryHealthFinding[] {
  const clients = new Map(snapshot.clients.map((client) => [client.clientAccountId, client]));
  const drafts: Draft[] = [];
  for (const lead of snapshot.leads) {
    const draft = classifyLead(lead, snapshot, clients.get(lead.clientAccountId), now);
    if (draft) drafts.push(draft);
  }
  for (const candidate of snapshot.intake) {
    const draft = classifyIntake(candidate, clients.get(candidate.clientAccountId), now);
    if (draft) drafts.push(draft);
  }
  return groupDrafts(drafts);
}

function classifyLead(
  lead: DeliveryHealthLead,
  snapshot: DeliveryHealthSnapshot,
  client: DeliveryHealthClient | undefined,
  now: Date
): Draft | null {
  if (!client || lead.clientAccountId !== client.clientAccountId) return null;
  if (!ROUTED.has(lead.status) || lead.cleanupStatus) return null;
  if (lead.id === SYNTHETIC_EVENT) return null;
  if (
    isCompanySheetsInternalPilotLead({
      sourceRouteKey: lead.sourceRouteKey,
      enrichmentMetadataJson: lead.enrichmentMetadataJson,
    })
  ) {
    return null;
  }

  const intent = pickIntent(snapshot.intents, lead.id);
  const related = snapshot.jobs.filter((job) => job.sourceLeadEventId === lead.id && job.clientAccountId === lead.clientAccountId);
  const testJobs = related.filter(isTestJob);
  const production = related.filter((job) => !isTestJob(job));
  const reference = lead.routedAt ?? lead.receivedAt;
  const beforeCutoff = Boolean(
    client.destination?.campaignDispatchNotBefore &&
      reference.getTime() < client.destination.campaignDispatchNotBefore.getTime()
  );
  const delaysOff = delayMonitoringSuppressed(client) || beforeCutoff;

  const uncertain = production.find(isUncertainJob);
  if (uncertain) return leadDraft(lead, intent, uncertain, "uncertain_append", "critical", uncertain.uncertainReason ?? uncertain.status);

  const permission = firstCode(production, intent, PERMISSION_CODES);
  if (permission) return leadDraft(lead, intent, permission.job, "google_permission", "critical", permission.code);
  const auth = firstCode(production, intent, AUTH_CODES);
  if (auth) return leadDraft(lead, intent, auth.job, "google_authorization", "critical", auth.code);

  const unverified = production.find((job) => job.status === "succeeded" && !isCanonical(job, snapshot, intent, client));
  if (unverified) return leadDraft(lead, intent, unverified, "sheets_receipt_unverified", "critical", "rows_not_confirmed");

  if (production.some((job) => isCanonical(job, snapshot, intent, client))) return null;
  if (delaysOff) return null;
  if (production.length === 0 && testJobs.length > 0) return null;
  if (intent && EXPECTED_HOLDS.has(intent.status)) return null;
  if (suppressedCode(intent, production)) return null;

  const config = firstCode(production, intent && EXPECTED_HOLDS.has(intent.status) ? null : intent, CONFIG_CODES);
  if (config) return leadDraft(lead, intent, config.job, "google_configuration", "critical", config.code);

  const age = Math.max(0, now.getTime() - reference.getTime());
  if (production.length === 0 && !intent) {
    if (age < DELIVERY_HEALTH_DISPATCH_WARNING_MS) return null;
    return leadDraft(lead, null, null, "missing_dispatch", timedSeverity(age), "missing_dispatch");
  }
  if (age < DELIVERY_HEALTH_RECEIPT_WARNING_MS) return null;
  return leadDraft(lead, intent, newest(production), "sheets_receipt_delayed", timedSeverity(age), "sheets_receipt_delayed");
}

function classifyIntake(
  candidate: DeliveryHealthIntakeCandidate,
  client: DeliveryHealthClient | undefined,
  now: Date
): Draft | null {
  if (candidate.syntheticPilot || !candidate.matched || candidate.sourceEventExists) return null;
  if (delayMonitoringSuppressed(client)) return null;
  if (!INTAKE_PROCESSING.has(candidate.processingStatus)) return null;
  if (candidate.httpStatus == null || candidate.httpStatus < 200 || candidate.httpStatus >= 300) return null;
  if (!candidate.completedAt) return null;
  const age = Math.max(0, now.getTime() - candidate.completedAt.getTime());
  if (age < DELIVERY_HEALTH_DISPATCH_WARNING_MS) return null;
  return {
    clientAccountId: candidate.clientAccountId,
    failureClass: "missing_intake",
    severity: timedSeverity(age),
    subject: {
      sourceLeadEventId: null,
      dispatchIntentId: null,
      jobId: null,
      jobStatus: null,
      code: "source_event_missing",
      routingDryRunDecisionId: candidate.routingDryRunDecisionId,
      webhookRequestLogId: candidate.webhookRequestLogId,
    },
  };
}

function leadDraft(
  lead: DeliveryHealthLead,
  intent: DeliveryHealthIntent | null,
  job: DeliveryHealthJob | null,
  failureClass: DeliveryHealthFailureClass,
  severity: DeliveryHealthSeverity,
  code: string | null
): Draft {
  return {
    clientAccountId: lead.clientAccountId,
    failureClass,
    severity,
    subject: {
      sourceLeadEventId: lead.id,
      dispatchIntentId: intent?.id ?? null,
      jobId: job?.id ?? null,
      jobStatus: job?.status ?? null,
      code,
      routingDryRunDecisionId: null,
      webhookRequestLogId: null,
    },
  };
}

function timedSeverity(ageMs: number): DeliveryHealthSeverity {
  return ageMs >= DELIVERY_HEALTH_ESCALATION_MS ? "critical" : "warning";
}

function pickIntent(intents: readonly DeliveryHealthIntent[], sourceLeadEventId: string): DeliveryHealthIntent | null {
  const matches = intents.filter((intent) => intent.kind === "campaign_lead" && intent.sourceLeadEventId === sourceLeadEventId);
  matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return matches[0] ?? null;
}

function isTestJob(job: DeliveryHealthJob): boolean {
  if (job.kind !== "lead" || TEST_KINDS.has(job.kind)) return true;
  if (job.idempotencyKey.startsWith("onboarding-test:")) return true;
  if (job.sourceLeadEventId === SYNTHETIC_EVENT) return true;
  return false;
}

function isUncertainJob(job: DeliveryHealthJob): boolean {
  return job.status === "uncertain" || machineCode(job.uncertainReason) != null;
}

function newest(jobs: readonly DeliveryHealthJob[]): DeliveryHealthJob | null {
  const copy = [...jobs];
  copy.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return copy[0] ?? null;
}

function firstCode(
  jobs: readonly DeliveryHealthJob[],
  intent: DeliveryHealthIntent | null,
  codes: Set<string>
): { job: DeliveryHealthJob | null; code: string } | null {
  for (const job of jobs) {
    if (job.status === "succeeded") continue;
    const code = machineCode(job.lastError) ?? machineCode(job.uncertainReason);
    if (code && codes.has(code)) return { job, code };
  }
  const intentCode = machineCode(intent?.lastError) ?? machineCode(intent?.reason);
  if (intentCode && codes.has(intentCode)) return { job: null, code: intentCode };
  return null;
}

function suppressedCode(intent: DeliveryHealthIntent | null, jobs: readonly DeliveryHealthJob[]): boolean {
  const intentCode = machineCode(intent?.lastError) ?? machineCode(intent?.reason);
  if (intentCode && SUPPRESSED_CODES.has(intentCode)) return true;
  return jobs.some((job) => {
    const code = machineCode(job.lastError);
    return code != null && SUPPRESSED_CODES.has(code);
  });
}

function isCanonical(
  job: DeliveryHealthJob,
  snapshot: DeliveryHealthSnapshot,
  intent: DeliveryHealthIntent | null,
  client: DeliveryHealthClient
): boolean {
  if (job.kind !== "lead" || job.status !== "succeeded") return false;
  const verdict = canonicalCompanySheetsDelivery({
    evidence: "campaign_job",
    job: {
      id: job.id,
      kind: job.kind,
      status: job.status,
      clientAccountId: job.clientAccountId,
      sourceLeadEventId: job.sourceLeadEventId,
      idempotencyKey: job.idempotencyKey,
      rowsWritten: job.rowsWritten,
      appendStartedAt: job.appendStartedAt,
      finishedAt: job.finishedAt,
    },
    rows: snapshot.rows.filter((row) => row.jobId === job.id),
    destination: client.destination
      ? {
          clientAccountId: client.clientAccountId,
          campaignDispatchNotBefore: client.destination.campaignDispatchNotBefore,
        }
      : null,
    intent: intent
      ? {
          kind: intent.kind,
          clientAccountId: intent.clientAccountId,
          sourceLeadEventId: intent.sourceLeadEventId,
          jobId: intent.jobId,
          createdAt: intent.createdAt,
        }
      : null,
    onboardingTestAttemptKeys: snapshot.onboardingTestAttemptKeys,
  });
  return verdict.canonical;
}

function groupDrafts(drafts: readonly Draft[]): DeliveryHealthFinding[] {
  const groups = new Map<string, DeliveryHealthFinding>();
  const seen = new Set<string>();
  for (const draft of drafts) {
    const subjectKey = [
      draft.clientAccountId,
      draft.failureClass,
      draft.subject.sourceLeadEventId ?? "",
      draft.subject.routingDryRunDecisionId ?? "",
    ].join("|");
    if (seen.has(subjectKey)) continue;
    seen.add(subjectKey);
    const key = `${draft.clientAccountId}|${draft.failureClass}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        clientAccountId: draft.clientAccountId,
        failureClass: draft.failureClass,
        severity: draft.severity,
        affectedCount: 1,
        subjects: [draft.subject],
      });
      continue;
    }
    existing.affectedCount += 1;
    existing.subjects.push(draft.subject);
    if (draft.severity === "critical") existing.severity = "critical";
  }
  return [...groups.values()];
}

export function isDelayFailureClass(failureClass: string): boolean {
  return DELAY_CLASSES.has(failureClass as DeliveryHealthFailureClass);
}
