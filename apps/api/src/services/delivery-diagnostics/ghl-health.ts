/**
 * GoHighLevel association delivery health.
 *
 * The unit of intent is one `GhlAssociationDispatchOutbox` row. Each row is
 * classified from its stored run and step receipts with the existing canonical
 * predicates (`ghlContactReceived`, `canonicalGhlDelivery`) through
 * `buildGhlRunDiagnostic`. Nothing here calls LeadConnector or retries a run.
 *
 * Contact delivery, required workflow, and optional operations are separate
 * outcomes. A skipped owner, note, or custom-field operation is a warning at
 * most and is never counted as a failed contact delivery.
 */

import type { Prisma } from "@prisma/client";

import type { DeliveryRetryDisposition } from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import { isPersistedLiveDestination } from "../ghl-destination-authorization.js";
import { loadAttemptIds, loadOnboardingKeys } from "../lead-delivery/portal-ghl-delivery.js";
import {
  RUN_DIAGNOSTIC_DESTINATION_SELECT,
  RUN_DIAGNOSTIC_RUN_SELECT,
  buildGhlRunDiagnostic,
  type GhlRunDiagnostic,
  type StoredDestinationForDiagnostic,
  type StoredOutboxForDiagnostic,
  type StoredRunForDiagnostic,
} from "./ghl-run-diagnostic.js";
import type { DiagnosticsDb } from "./read-only.js";
import type { DiagnosticWindow } from "./window.js";

export const GHL_EVALUATION_CAP = 500;
const ATTENTION_CAP = 25;
const CLIENT_ROWS_CAP = 25;
export const GHL_PENDING_OVERDUE_MS = 5 * 60 * 1000;
export const GHL_EXECUTING_STALE_MS = 3 * 60 * 1000;

export type GhlDestinationState = "live" | "shadow" | "disabled" | "not_approved" | "location_mismatch" | "not_configured";

export type GhlDeliveryClass =
  | "delivered_complete"
  | "delivered_optional_warnings"
  | "contact_delivered_required_workflow_incomplete"
  | "contact_delivered_workflow_requirement_unrecorded"
  | "contact_not_verified"
  | "terminal_required_step_failure"
  | "retryable_failure"
  | "pending"
  | "pending_overdue"
  | "in_flight"
  | "held_stale_executing"
  | "held_uncertain"
  | "duplicate_skipped"
  | "intentional_non_delivery"
  | "settled_without_run_unexplained";

export type GhlAttentionItem = {
  kind: GhlDeliveryClass;
  clientAccountId: string;
  sourceLeadEventId: string;
  runId: string | null;
  failedRequiredSteps: Array<{ stepType: string; errorCode: string | null; httpStatus: number | null }>;
  code: string | null;
  /** Retry state, reported beside the delivery class and never folded into it. */
  retryDisposition: DeliveryRetryDisposition | null;
  outboxStatus: string;
};

export type GhlHealth = {
  windowFlow: {
    intendedDeliveries: number;
    evaluated: number;
    truncated: boolean;
    byClass: Partial<Record<GhlDeliveryClass, number>>;
    verifiedContactFulfillment: number;
    canonicalDeliveries: number;
    requiredWorkflow: { required: number; completed: number; incomplete: number; unrecorded: number };
    optionalWarnings: { runsWithWarnings: number; byStepType: Record<string, number>; benignSkips: number };
    terminalRequiredStepFailures: number;
    intentionalNonDelivery: Record<string, number>;
    lastVerifiedContactCompletedAt: string | null;
    nonAssociationRunsInWindow: Record<string, number>;
  };
  openWork: {
    pending: number;
    inFlight: number;
    uncertain: number;
    oldestPendingAvailableAt: string | null;
    oldestPendingAgeSeconds: number | null;
  };
  lastContactStepSucceededAt: string | null;
  lastContactStepScope: "latest_ongoing_association_run_with_contact_external_id";
  destinations: Array<{
    clientAccountId: string;
    accountStatus: string | null;
    state: GhlDestinationState;
    intended: number;
    contactVerified: number;
    needsAttention: number;
  }>;
  destinationsTruncated: boolean;
  attention: GhlAttentionItem[];
  attentionTruncated: boolean;
  classificationNote: string;
};

export function destinationState(
  destination: StoredDestinationForDiagnostic | null,
  locationId: string | null
): GhlDestinationState {
  if (!destination) return "not_configured";
  const live = isPersistedLiveDestination(
    {
      deliveryEnabled: destination.deliveryEnabled,
      deliveryMode: destination.deliveryMode,
      clientCutoverApproved: destination.clientCutoverApproved,
      internalApprovalStatus: destination.internalApprovalStatus,
      destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
    },
    locationId ?? destination.destinationSubaccountIdGhl
  );
  if (live) return "live";
  if (locationId && destination.destinationSubaccountIdGhl.trim() !== locationId.trim()) return "location_mismatch";
  if (!destination.deliveryEnabled) return "disabled";
  if (destination.deliveryMode !== "live") return "shadow";
  return "not_approved";
}

export type OutboxForClassification = StoredOutboxForDiagnostic & { id?: string };

export function classifyGhlDelivery(input: {
  outbox: OutboxForClassification;
  diagnostic: GhlRunDiagnostic | null;
  destinationState: GhlDestinationState;
  accountStatus: string | null;
  now: Date;
}): { class: GhlDeliveryClass; failedRequiredSteps: GhlAttentionItem["failedRequiredSteps"]; code: string | null } {
  const { outbox, diagnostic, now } = input;
  const none: GhlAttentionItem["failedRequiredSteps"] = [];

  if (outbox.status === "pending") {
    const overdue = now.getTime() - outbox.availableAt.getTime() > GHL_PENDING_OVERDUE_MS;
    return { class: overdue ? "pending_overdue" : "pending", failedRequiredSteps: none, code: null };
  }
  if (outbox.status === "executing") {
    const started = outbox.executingAt?.getTime() ?? outbox.availableAt.getTime();
    const stale = now.getTime() - started > GHL_EXECUTING_STALE_MS;
    return { class: stale ? "held_stale_executing" : "in_flight", failedRequiredSteps: none, code: null };
  }
  // The dispatcher also settles a failed run that called GHL as uncertain. A
  // stored run decides fulfillment; the outbox row only reports the hold.
  if (outbox.status === "uncertain" && (!diagnostic || diagnostic.run.status === "executing")) {
    return { class: "held_uncertain", failedRequiredSteps: none, code: outbox.lastError ?? null };
  }

  if (!diagnostic) {
    if (input.destinationState !== "live") {
      return { class: "intentional_non_delivery", failedRequiredSteps: none, code: input.destinationState };
    }
    if (input.accountStatus && input.accountStatus !== "active") {
      return { class: "intentional_non_delivery", failedRequiredSteps: none, code: `client_${input.accountStatus}` };
    }
    return { class: "settled_without_run_unexplained", failedRequiredSteps: none, code: outbox.outcome ?? null };
  }

  const status = diagnostic.run.status;
  if (status === "skipped_duplicate") return { class: "duplicate_skipped", failedRequiredSteps: none, code: null };
  if (status === "executing") return { class: "held_stale_executing", failedRequiredSteps: none, code: null };

  if (status === "failed") {
    const failedRequiredSteps = diagnostic.steps
      .filter((step) => step.status === "failed" && step.required === true)
      .map((step) => ({ stepType: step.stepType, errorCode: step.errorCode, httpStatus: step.httpStatus }));
    const code = failedRequiredSteps[0]?.errorCode ?? null;
    if (diagnostic.retry.disposition === "hold" || !diagnostic.retry.automaticRetryPending) {
      return { class: "terminal_required_step_failure", failedRequiredSteps, code };
    }
    return { class: "retryable_failure", failedRequiredSteps, code };
  }

  if (!diagnostic.verdict.contactReceived) {
    return { class: "contact_not_verified", failedRequiredSteps: none, code: diagnostic.verdict.contactReceivedReasons[0] ?? null };
  }
  const recorded = diagnostic.run.workflowStartRequiredRecorded;
  if (recorded === true) {
    const workflowReason = diagnostic.verdict.canonicalReasons.find((reason) => reason.startsWith("workflow_"));
    if (workflowReason) {
      return { class: "contact_delivered_required_workflow_incomplete", failedRequiredSteps: none, code: workflowReason };
    }
  } else if (recorded === null && diagnostic.verdict.unverifiedReason) {
    return {
      class: "contact_delivered_workflow_requirement_unrecorded",
      failedRequiredSteps: none,
      code: diagnostic.verdict.unverifiedReason,
    };
  }
  const warnings = diagnostic.contributors.filter(
    (item) => item.effect === "optional_warning" && !(item.status === "skipped" && !item.errorCode)
  );
  if (warnings.length > 0) return { class: "delivered_optional_warnings", failedRequiredSteps: none, code: null };
  return { class: "delivered_complete", failedRequiredSteps: none, code: null };
}

function bump<T extends string>(map: Partial<Record<T, number>>, key: T, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

const ATTENTION_CLASSES = new Set<GhlDeliveryClass>([
  "terminal_required_step_failure",
  "contact_delivered_required_workflow_incomplete",
  "contact_not_verified",
  "held_uncertain",
  "held_stale_executing",
  "pending_overdue",
  "retryable_failure",
  "settled_without_run_unexplained",
]);

export async function loadGhlHealth(
  db: DiagnosticsDb,
  input: {
    window: DiagnosticWindow;
    now: Date;
    clientAccountId: string | null;
    campaignLeadIds: { ids: string[] | null; capped: boolean };
  }
): Promise<GhlHealth> {
  const { window, now } = input;
  const leadFilter = input.campaignLeadIds.ids;
  const empty = leadFilter != null && leadFilter.length === 0;
  const clientFilter = input.clientAccountId ? { clientAccountId: input.clientAccountId } : {};
  const leadIdFilter = leadFilter ? { sourceLeadEventId: { in: leadFilter } } : {};

  const outboxWhere: Prisma.GhlAssociationDispatchOutboxWhereInput = {
    availableAt: { gte: window.from, lt: window.to },
    ...clientFilter,
    ...leadIdFilter,
  };
  const outboxRows = empty
    ? []
    : await db.ghlAssociationDispatchOutbox.findMany({
        where: outboxWhere,
        orderBy: [{ availableAt: "desc" }, { id: "desc" }],
        take: GHL_EVALUATION_CAP + 1,
        select: {
          id: true,
          status: true,
          outcome: true,
          attemptCount: true,
          externalCallExecuted: true,
          lastError: true,
          clientAccountId: true,
          sourceLeadEventId: true,
          destinationLocationIdGhl: true,
          liveRunId: true,
          availableAt: true,
          executingAt: true,
          settledAt: true,
        },
      });
  const truncated = outboxRows.length > GHL_EVALUATION_CAP;
  const rows = outboxRows.slice(0, GHL_EVALUATION_CAP);
  const intendedDeliveries = truncated ? await db.ghlAssociationDispatchOutbox.count({ where: outboxWhere }) : rows.length;

  const runIds = [...new Set(rows.flatMap((row) => (row.liveRunId ? [row.liveRunId] : [])))];
  const clientIds = [...new Set(rows.map((row) => row.clientAccountId))];
  const leadIds = [...new Set(rows.map((row) => row.sourceLeadEventId))];

  const [runs, destinations, accounts, leads] = await Promise.all([
    runIds.length
      ? db.ghlLiveDeliveryRun.findMany({ where: { id: { in: runIds } }, select: RUN_DIAGNOSTIC_RUN_SELECT })
      : Promise.resolve([]),
    clientIds.length
      ? db.clientGhlDestination.findMany({
          where: { clientAccountId: { in: clientIds } },
          select: RUN_DIAGNOSTIC_DESTINATION_SELECT,
        })
      : Promise.resolve([]),
    clientIds.length
      ? db.clientAccount.findMany({ where: { clientAccountId: { in: clientIds } }, select: { clientAccountId: true, status: true } })
      : Promise.resolve([]),
    leadIds.length
      ? db.sourceLeadEvent.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, bulkImportId: true, bulkImportRowId: true, sourceType: true },
        })
      : Promise.resolve([]),
  ]);
  const onboardingKeys = await loadOnboardingKeys(db, runs);
  const attemptIds = await loadAttemptIds(db, runs);

  const runById = new Map<string, StoredRunForDiagnostic>(runs.map((run) => [run.id, run]));
  const destinationByClient = new Map(destinations.map((row) => [row.clientAccountId, row]));
  const accountByClient = new Map(accounts.map((row) => [row.clientAccountId, row.status]));
  const leadById = new Map(leads.map((row) => [row.id, row]));

  const byClass: Partial<Record<GhlDeliveryClass, number>> = {};
  const intentional: Record<string, number> = {};
  const optionalByStep: Record<string, number> = {};
  const requiredWorkflow = { required: 0, completed: 0, incomplete: 0, unrecorded: 0 };
  let verifiedContact = 0;
  let canonicalCount = 0;
  let optionalRuns = 0;
  let benignSkips = 0;
  let terminal = 0;
  let lastVerified: string | null = null;
  const attention: GhlAttentionItem[] = [];
  const perClient = new Map<
    string,
    { clientAccountId: string; accountStatus: string | null; state: GhlDestinationState; intended: number; contactVerified: number; needsAttention: number }
  >();

  for (const row of rows) {
    const run = row.liveRunId ? runById.get(row.liveRunId) ?? null : null;
    const destination = destinationByClient.get(row.clientAccountId) ?? null;
    const accountStatus = accountByClient.get(row.clientAccountId) ?? null;
    const diagnostic = run
      ? buildGhlRunDiagnostic({
          run,
          destination,
          accountStatus,
          outbox: row,
          sourceLead: leadById.get(row.sourceLeadEventId) ?? null,
          onboardingTestAttemptKeys: onboardingKeys,
          onboardingTestAttemptId: attemptIds.get(run.idempotencyKey.trim()) ?? null,
        })
      : null;
    const state = destinationState(destination, row.destinationLocationIdGhl);
    const classified = classifyGhlDelivery({ outbox: row, diagnostic, destinationState: state, accountStatus, now });
    bump(byClass, classified.class);

    const client =
      perClient.get(row.clientAccountId) ??
      { clientAccountId: row.clientAccountId, accountStatus, state, intended: 0, contactVerified: 0, needsAttention: 0 };
    client.intended += 1;
    perClient.set(row.clientAccountId, client);

    if (classified.class === "intentional_non_delivery") bump(intentional, classified.code ?? "unspecified");
    if (classified.class === "terminal_required_step_failure") terminal += 1;

    if (diagnostic?.verdict.contactReceived) {
      verifiedContact += 1;
      client.contactVerified += 1;
      const completedAt = diagnostic.run.completedAt;
      if (completedAt && (!lastVerified || completedAt > lastVerified)) lastVerified = completedAt;
      const recorded = diagnostic.run.workflowStartRequiredRecorded;
      if (recorded === true) {
        requiredWorkflow.required += 1;
        if (diagnostic.verdict.canonicalReasons.some((reason) => reason.startsWith("workflow_"))) requiredWorkflow.incomplete += 1;
        else requiredWorkflow.completed += 1;
      } else if (recorded === null) {
        requiredWorkflow.unrecorded += 1;
      }
      const warnings = diagnostic.contributors.filter((item) => item.effect === "optional_warning");
      let counted = false;
      for (const item of warnings) {
        if (item.status === "skipped" && !item.errorCode) {
          benignSkips += 1;
          continue;
        }
        bump(optionalByStep, item.stepType);
        counted = true;
      }
      if (counted) optionalRuns += 1;
    }
    if (diagnostic?.verdict.canonical === true) canonicalCount += 1;

    if (ATTENTION_CLASSES.has(classified.class)) {
      client.needsAttention += 1;
      attention.push({
        kind: classified.class,
        clientAccountId: row.clientAccountId,
        sourceLeadEventId: row.sourceLeadEventId,
        runId: run?.id ?? null,
        failedRequiredSteps: classified.failedRequiredSteps,
        code: classified.code,
        retryDisposition: diagnostic?.retry.disposition ?? null,
        outboxStatus: row.status,
      });
    }
  }

  const openGroups = await db.ghlAssociationDispatchOutbox.groupBy({
    by: ["status"],
    where: { status: { in: ["pending", "executing", "uncertain"] }, ...clientFilter, ...leadIdFilter },
    _count: { _all: true },
  });
  const openCount = (status: string) => openGroups.find((group) => group.status === status)?._count._all ?? 0;
  const oldestPending = await db.ghlAssociationDispatchOutbox.findFirst({
    where: { status: { in: ["pending", "executing"] }, ...clientFilter, ...leadIdFilter },
    orderBy: { availableAt: "asc" },
    select: { availableAt: true },
  });

  const lastContact = await db.ghlLiveDeliveryRun.findFirst({
    where: {
      mode: "ongoing_association",
      status: { in: ["succeeded", "partial_success"] },
      completedAt: { not: null },
      ...(input.clientAccountId ? { destinationClientAccountId: input.clientAccountId } : {}),
      stepRuns: {
        some: {
          stepType: "create_or_update_contact",
          status: { in: ["succeeded", "partial_success"] },
          externalId: { not: null },
        },
      },
    },
    orderBy: { startedAt: "desc" },
    select: { completedAt: true },
  });

  const otherRuns = await db.ghlLiveDeliveryRun.groupBy({
    by: ["mode", "status"],
    where: {
      startedAt: { gte: window.from, lt: window.to },
      mode: { not: "ongoing_association" },
      ...(input.clientAccountId ? { destinationClientAccountId: input.clientAccountId } : {}),
    },
    _count: { _all: true },
  });
  const nonAssociation: Record<string, number> = {};
  for (const group of otherRuns) bump(nonAssociation, `${group.mode}:${group.status}`, group._count._all);

  const clientRows = [...perClient.values()].sort((a, b) => b.needsAttention - a.needsAttention || b.intended - a.intended);
  const oldestAvailable = oldestPending?.availableAt ?? null;

  return {
    windowFlow: {
      intendedDeliveries,
      evaluated: rows.length,
      truncated,
      byClass,
      verifiedContactFulfillment: verifiedContact,
      canonicalDeliveries: canonicalCount,
      requiredWorkflow,
      optionalWarnings: { runsWithWarnings: optionalRuns, byStepType: optionalByStep, benignSkips },
      terminalRequiredStepFailures: terminal,
      intentionalNonDelivery: intentional,
      lastVerifiedContactCompletedAt: lastVerified,
      nonAssociationRunsInWindow: nonAssociation,
    },
    openWork: {
      pending: openCount("pending"),
      inFlight: openCount("executing"),
      uncertain: openCount("uncertain"),
      oldestPendingAvailableAt: oldestAvailable?.toISOString() ?? null,
      oldestPendingAgeSeconds: oldestAvailable ? Math.max(0, Math.round((now.getTime() - oldestAvailable.getTime()) / 1000)) : null,
    },
    lastContactStepSucceededAt: lastContact?.completedAt?.toISOString() ?? null,
    lastContactStepScope: "latest_ongoing_association_run_with_contact_external_id",
    destinations: clientRows.slice(0, CLIENT_ROWS_CAP),
    destinationsTruncated: clientRows.length > CLIENT_ROWS_CAP,
    attention: attention.slice(0, ATTENTION_CAP),
    attentionTruncated: attention.length > ATTENTION_CAP,
    classificationNote:
      "Destination state (live, shadow, disabled, not_approved) uses the destination as saved now. A destination changed after a lead settled can be classified differently than it was at delivery time.",
  };
}
