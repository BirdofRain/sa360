/**
 * Sanitized, read-only view of one stored GoHighLevel delivery run.
 *
 * It reads the run, its step rows, the saved destination, the association
 * outbox row, and the source lead identity columns. It never calls
 * LeadConnector, never reads a lead payload, and never returns a stored
 * request or response body. Verdicts come from the existing canonical
 * predicates and the existing retry-disposition function, so this view cannot
 * drift from what delivery and the customer portal already decide.
 */

import {
  hasOptionalPostContactIssues,
  isRequiredLiveCanaryStepFailure,
  type LiveCanaryStepRequirementFlags,
} from "../ghl-delivery-adapter/ghl-live-canary-step-requirements.js";
import { LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME } from "../ghl-delivery-adapter/lal-ai-bot1-vet-snapshot.js";
import {
  deliveryRetryDisposition,
  receiptFromPersistedStep,
  separateDeliveryResults,
  type DeliveryRetryDisposition,
  type VetDeliveryResults,
} from "../ghl-delivery-adapter/vet-ghl-delivery-contract.js";
import { isPersistedLiveDestination } from "../ghl-destination-authorization.js";
import {
  canonicalGhlDelivery,
  ghlContactReceived,
  type GhlCanonicalInput,
  type GhlCanonicalStep,
} from "../delivery-success/canonical-delivery.js";
import { loadAttemptIds, loadOnboardingKeys } from "../lead-delivery/portal-ghl-delivery.js";
import { parseSourceEnrichmentPolicyJson } from "../source-intake/source-enrichment.service.js";
import type { DiagnosticsDb } from "./read-only.js";
import {
  externalCallExecutedFromResponse,
  httpStatusFromErrorCode,
  sanitizeCode,
  sanitizeErrorList,
  sanitizeErrorText,
  sanitizedGhlErrorBody,
  type SanitizedGhlError,
} from "./sanitize.js";

const STEP_LABELS: Record<string, string> = {
  create_or_update_contact: "Contact",
  stamp_custom_fields: "Custom fields",
  stamp_source_attributes: "Source attributes",
  add_tags: "Tags",
  create_or_update_opportunity: "Opportunity",
  assign_owner: "Owner",
  start_workflow: "Workflow",
  write_intake_summary_note: "Intake note",
  write_backup_sheet: "Backup sheet",
};

export type GhlStepRequirementSource = "fixed" | "run_recorded" | "current_destination" | "unrecorded";

export type GhlStepDiagnostic = {
  order: number;
  stepType: string;
  label: string;
  status: string;
  /** Null when the requirement was not recorded on the run and cannot be inferred. */
  required: boolean | null;
  requirementSource: GhlStepRequirementSource;
  externalCallExecuted: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  ghlError: SanitizedGhlError | null;
  externalId: string | null;
  receiptOutcome: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

export type GhlDestinationDiagnostic = {
  clientAccountId: string;
  ghlLocationId: string;
  locationMatchesRun: boolean | null;
  accountStatus: string | null;
  workflowId: string | null;
  /** Contract constant for the VET snapshot. It is not read from LeadConnector. */
  workflowNameFromContract: string | null;
  workflowTriggerMode: string;
  workflowStartRequired: boolean;
  ownerAssignmentRequired: boolean;
  customFieldStampRequired: boolean;
  opportunityCreationEnabled: boolean;
  /** The destination is saved with the VET webform policy, so the snapshot owns the first opportunity. */
  lalAiBot1VetWebform: boolean;
  /** Mirrors the canonical predicate: an SA360 opportunity step is expected only here. */
  opportunityStepExpected: boolean;
  pipelineId: string | null;
  pipelineStageId: string | null;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  connectionStatus: string | null;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  persistedLive: boolean;
  configUpdatedAt: string;
  /** Saved configuration may differ from the configuration that planned this run. */
  configChangedSinceRun: boolean | null;
};

export type GhlRetryDiagnostic = {
  disposition: DeliveryRetryDisposition;
  automaticRetryPending: boolean;
  explanation: string;
  outbox: {
    status: string;
    outcome: string | null;
    attemptCount: number;
    externalCallExecuted: boolean;
    lastError: string | null;
    availableAt: string;
    executingAt: string | null;
    settledAt: string | null;
  } | null;
};

export type GhlStepContributor = {
  stepType: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  required: boolean | null;
  effect: "required_step_incomplete" | "optional_warning";
};

export type GhlRunDiagnostic = {
  run: {
    id: string;
    status: string;
    mode: string;
    startedAt: string;
    completedAt: string | null;
    durationMs: number | null;
    /** Null means the run did not record the requirement. */
    workflowStartRequiredRecorded: boolean | null;
    summary: string | null;
    errors: string[];
    warnings: string[];
  };
  source: {
    sourceLeadEventId: string | null;
    routingDryRunDecisionId: string | null;
    leadDeliveryPlanId: string;
    campaignRoutingRuleId: string | null;
  };
  destination: { clientAccountId: string; masterClientAccountId: string; ghlLocationId: string };
  contact: {
    status: string | null;
    externalId: string | null;
    receiptOutcome: string | null;
    result: VetDeliveryResults["contact"];
  };
  opportunity: {
    stepPresent: boolean;
    status: string | null;
    errorCode: string | null;
    httpStatus: number | null;
    errorMessage: string | null;
    ghlError: SanitizedGhlError | null;
    stepExpectedByDestination: boolean | null;
  };
  workflow: {
    stepPresent: boolean;
    status: string | null;
    attempted: boolean;
    result: VetDeliveryResults["workflow"];
    requiredRecorded: boolean | null;
    skipReason: string | null;
    errorCode: string | null;
  };
  steps: GhlStepDiagnostic[];
  contributors: GhlStepContributor[];
  verdict: {
    canonical: boolean | null;
    canonicalReasons: string[];
    unverifiedReason: string | null;
    contactReceived: boolean;
    contactReceivedReasons: string[];
  };
  retry: GhlRetryDiagnostic;
  destinationConfig: GhlDestinationDiagnostic | null;
  evidence: {
    storedBodiesReturned: false;
    consumerFieldsReturned: false;
    externalCallsMade: false;
  };
};

export type StoredRunForDiagnostic = {
  id: string;
  leadDeliveryPlanId: string;
  routingDryRunDecisionId: string | null;
  campaignRoutingRuleId: string | null;
  masterClientAccountId: string;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  mode: string;
  status: string;
  idempotencyKey: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  summary: string | null;
  warnings: unknown;
  errors: unknown;
  workflowStartRequired: boolean | null;
  stepRuns: Array<{
    stepOrder: number;
    stepType: string;
    status: string;
    externalId: string | null;
    errorCode: string | null;
    errorSummary: string | null;
    responseRedactedJson: unknown;
    startedAt: Date | null;
    completedAt: Date | null;
  }>;
};

export type StoredDestinationForDiagnostic = {
  clientAccountId: string;
  destinationSubaccountIdGhl: string;
  destinationWorkflowIdGhl: string | null;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  workflowTriggerMode: string;
  workflowStartRequired: boolean;
  ownerAssignmentRequired: boolean;
  customFieldStampRequired: boolean;
  opportunityCreationEnabled: boolean;
  sourceEnrichmentPolicyJson: unknown;
  snapshotInstalled: boolean;
  requiredFieldsInstalled: boolean;
  ghlConnectionStatus: string | null;
  deliveryMode: string;
  deliveryEnabled: boolean;
  clientCutoverApproved: boolean;
  internalApprovalStatus: string;
  updatedAt: Date;
};

export type StoredOutboxForDiagnostic = {
  status: string;
  outcome: string | null;
  attemptCount: number;
  externalCallExecuted: boolean;
  lastError: string | null;
  clientAccountId: string;
  sourceLeadEventId: string;
  destinationLocationIdGhl: string;
  liveRunId: string | null;
  availableAt: Date;
  executingAt: Date | null;
  settledAt: Date | null;
};

export const RUN_DIAGNOSTIC_STEP_SELECT = {
  stepOrder: true,
  stepType: true,
  status: true,
  externalId: true,
  errorCode: true,
  errorSummary: true,
  responseRedactedJson: true,
  startedAt: true,
  completedAt: true,
} as const;

export const RUN_DIAGNOSTIC_RUN_SELECT = {
  id: true,
  leadDeliveryPlanId: true,
  routingDryRunDecisionId: true,
  campaignRoutingRuleId: true,
  masterClientAccountId: true,
  destinationClientAccountId: true,
  destinationSubaccountIdGhl: true,
  mode: true,
  status: true,
  idempotencyKey: true,
  startedAt: true,
  completedAt: true,
  durationMs: true,
  summary: true,
  warnings: true,
  errors: true,
  workflowStartRequired: true,
  stepRuns: { orderBy: { stepOrder: "asc" as const }, select: RUN_DIAGNOSTIC_STEP_SELECT },
} as const;

export const RUN_DIAGNOSTIC_DESTINATION_SELECT = {
  clientAccountId: true,
  destinationSubaccountIdGhl: true,
  destinationWorkflowIdGhl: true,
  destinationPipelineIdGhl: true,
  destinationPipelineStageIdGhl: true,
  workflowTriggerMode: true,
  workflowStartRequired: true,
  ownerAssignmentRequired: true,
  customFieldStampRequired: true,
  opportunityCreationEnabled: true,
  sourceEnrichmentPolicyJson: true,
  snapshotInstalled: true,
  requiredFieldsInstalled: true,
  ghlConnectionStatus: true,
  deliveryMode: true,
  deliveryEnabled: true,
  clientCutoverApproved: true,
  internalApprovalStatus: true,
  updatedAt: true,
} as const;

export const RUN_DIAGNOSTIC_OUTBOX_SELECT = {
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
} as const;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function describeRetryDisposition(input: {
  disposition: DeliveryRetryDisposition;
  runStatus: string;
  outbox: StoredOutboxForDiagnostic | null;
}): { automaticRetryPending: boolean; explanation: string } {
  const { disposition, runStatus, outbox } = input;
  if (disposition === "hold") {
    if (runStatus === "succeeded" || runStatus === "partial_success") {
      return {
        automaticRetryPending: false,
        explanation:
          "Held. A finished run is kept and is not sent again. Completed operations are not repeated.",
      };
    }
    if (runStatus === "executing") {
      return {
        automaticRetryPending: false,
        explanation: "Held while executing. An attempt that never settled is marked uncertain, not retried.",
      };
    }
    if (runStatus === "skipped_duplicate") {
      return { automaticRetryPending: false, explanation: "Held. A duplicate decision is not delivered." };
    }
    return {
      automaticRetryPending: false,
      explanation:
        "Held. A stored step was rejected by GoHighLevel or ended ambiguously. The automatic drain will not send it again.",
    };
  }
  const pending = outbox != null && (outbox.status === "pending" || outbox.status === "executing");
  if (disposition === "create") {
    return { automaticRetryPending: pending, explanation: "No run is recorded for this decision yet." };
  }
  return {
    automaticRetryPending: pending,
    explanation:
      disposition === "resume"
        ? "A completed operation is kept. Only operations without a completed receipt would be sent."
        : "No step left SA360. The same run can be retried by the drain while the schedule row is open.",
  };
}

function isOutboxForRun(outbox: StoredOutboxForDiagnostic | null, runId: string): boolean {
  return outbox != null && outbox.liveRunId === runId;
}

type RequirementContext = {
  workflowRecorded: boolean | null;
  destination: StoredDestinationForDiagnostic | null;
  opportunityConfigured: boolean;
};

function requirementFor(stepType: string, ctx: RequirementContext): {
  required: boolean | null;
  source: GhlStepRequirementSource;
} {
  if (stepType === "start_workflow") {
    if (ctx.workflowRecorded === null) return { required: null, source: "unrecorded" };
    return { required: ctx.workflowRecorded, source: "run_recorded" };
  }
  if (stepType === "create_or_update_opportunity") {
    return ctx.destination
      ? { required: ctx.opportunityConfigured, source: "current_destination" }
      : { required: null, source: "unrecorded" };
  }
  if (stepType === "assign_owner") {
    return ctx.destination
      ? { required: ctx.destination.ownerAssignmentRequired, source: "current_destination" }
      : { required: null, source: "unrecorded" };
  }
  if (stepType === "stamp_custom_fields") {
    return ctx.destination
      ? { required: ctx.destination.customFieldStampRequired, source: "current_destination" }
      : { required: null, source: "unrecorded" };
  }
  const flags: LiveCanaryStepRequirementFlags = { ownerRequired: false, workflowRequired: false, stampRequired: false };
  return { required: isRequiredLiveCanaryStepFailure(stepType, flags), source: "fixed" };
}

export function destinationDiagnostic(input: {
  destination: StoredDestinationForDiagnostic;
  accountStatus: string | null;
  runLocationId: string | null;
  runStartedAt: Date | null;
}): GhlDestinationDiagnostic {
  const { destination } = input;
  const policy = parseSourceEnrichmentPolicyJson(destination.sourceEnrichmentPolicyJson);
  const location = destination.destinationSubaccountIdGhl;
  return {
    clientAccountId: destination.clientAccountId,
    ghlLocationId: location,
    locationMatchesRun: input.runLocationId == null ? null : input.runLocationId.trim() === location.trim(),
    accountStatus: input.accountStatus,
    workflowId: destination.destinationWorkflowIdGhl,
    workflowNameFromContract: policy.lalAiBot1VetWebform ? LAL_AI_BOT1_VET_WEBFORM_WORKFLOW_NAME : null,
    workflowTriggerMode: destination.workflowTriggerMode,
    workflowStartRequired: destination.workflowStartRequired,
    ownerAssignmentRequired: destination.ownerAssignmentRequired,
    customFieldStampRequired: destination.customFieldStampRequired,
    opportunityCreationEnabled: destination.opportunityCreationEnabled,
    lalAiBot1VetWebform: policy.lalAiBot1VetWebform === true,
    opportunityStepExpected: policy.lalAiBot1VetWebform !== true && destination.opportunityCreationEnabled === true,
    pipelineId: destination.destinationPipelineIdGhl,
    pipelineStageId: destination.destinationPipelineStageIdGhl,
    snapshotInstalled: destination.snapshotInstalled,
    requiredFieldsInstalled: destination.requiredFieldsInstalled,
    connectionStatus: destination.ghlConnectionStatus,
    deliveryMode: destination.deliveryMode,
    deliveryEnabled: destination.deliveryEnabled,
    clientCutoverApproved: destination.clientCutoverApproved,
    internalApprovalStatus: destination.internalApprovalStatus,
    persistedLive: isPersistedLiveDestination(
      {
        deliveryEnabled: destination.deliveryEnabled,
        deliveryMode: destination.deliveryMode,
        clientCutoverApproved: destination.clientCutoverApproved,
        internalApprovalStatus: destination.internalApprovalStatus,
        destinationSubaccountIdGhl: destination.destinationSubaccountIdGhl,
      },
      destination.destinationSubaccountIdGhl
    ),
    configUpdatedAt: destination.updatedAt.toISOString(),
    configChangedSinceRun: input.runStartedAt ? destination.updatedAt.getTime() > input.runStartedAt.getTime() : null,
  };
}

export function buildGhlRunDiagnostic(input: {
  run: StoredRunForDiagnostic;
  destination: StoredDestinationForDiagnostic | null;
  accountStatus: string | null;
  outbox: StoredOutboxForDiagnostic | null;
  sourceLead: { id: string; bulkImportId: string | null; bulkImportRowId: string | null; sourceType: string | null } | null;
  onboardingTestAttemptKeys: string[] | null;
  onboardingTestAttemptId: string | null;
}): GhlRunDiagnostic {
  const { run, destination, outbox } = input;
  const recorded = run.workflowStartRequired;
  const policy = destination ? parseSourceEnrichmentPolicyJson(destination.sourceEnrichmentPolicyJson) : null;
  const opportunityConfigured =
    destination != null && policy?.lalAiBot1VetWebform !== true && destination.opportunityCreationEnabled === true;
  const ctx: RequirementContext = { workflowRecorded: recorded, destination, opportunityConfigured };
  const results = separateDeliveryResults(run.stepRuns);
  const stepOf = (stepType: string) => run.stepRuns.find((step) => step.stepType === stepType);

  const steps: GhlStepDiagnostic[] = run.stepRuns.map((step) => {
    const req = requirementFor(step.stepType, ctx);
    const receipt = receiptFromPersistedStep(step);
    const code = sanitizeCode(step.errorCode) ?? (step.errorCode?.startsWith("http_") ? step.errorCode : null);
    const httpStatus = httpStatusFromErrorCode(step.errorCode);
    return {
      order: step.stepOrder,
      stepType: step.stepType,
      label: STEP_LABELS[step.stepType] ?? step.stepType,
      status: step.status,
      required: req.required,
      requirementSource: req.source,
      externalCallExecuted:
        externalCallExecutedFromResponse(step.responseRedactedJson) || httpStatus != null || step.errorCode === "http_transport",
      httpStatus,
      errorCode: code,
      errorMessage: sanitizeErrorText(step.errorSummary),
      ghlError: step.status === "failed" || step.status === "optional_failed" ? sanitizedGhlErrorBody(step.responseRedactedJson) : null,
      externalId: step.externalId?.trim() || null,
      receiptOutcome: receipt?.outcome ?? null,
      startedAt: iso(step.startedAt),
      completedAt: iso(step.completedAt),
    };
  });
  const stepDiag = (stepType: string) => steps.find((step) => step.stepType === stepType);

  const contributors: GhlStepContributor[] = [];
  for (const step of steps) {
    if (step.status === "succeeded") continue;
    const optionalIssue = hasOptionalPostContactIssues([{ stepType: step.stepType, status: step.status }]);
    const requiredIncomplete =
      step.required === true &&
      step.stepType !== "create_or_update_contact" &&
      (step.status === "failed" || step.status === "skipped" || step.status === "optional_failed" || step.status === "blocked");
    if (!optionalIssue && !requiredIncomplete && step.status !== "failed") continue;
    contributors.push({
      stepType: step.stepType,
      status: step.status,
      errorCode: step.errorCode,
      errorMessage: step.errorMessage,
      required: step.required,
      effect: step.required === true ? "required_step_incomplete" : "optional_warning",
    });
  }

  const canonicalSteps: GhlCanonicalStep[] = run.stepRuns.map((step) => ({
    stepType: step.stepType,
    status: step.status,
    externalId: step.externalId,
    errorCode: step.errorCode,
    responseRedactedJson: step.responseRedactedJson,
  }));
  const outboxForRun = isOutboxForRun(outbox, run.id) ? outbox : null;
  const canonicalBase: Omit<GhlCanonicalInput, "destination"> = {
    run: {
      id: run.id,
      mode: run.mode,
      status: run.status,
      completedAt: run.completedAt,
      destinationClientAccountId: run.destinationClientAccountId,
      idempotencyKey: run.idempotencyKey,
    },
    steps: canonicalSteps,
    opportunityConfigured,
    intakeSummaryNotesEnabled: policy?.intakeSummaryNotesEnabled === true,
    outbox: outboxForRun
      ? {
          status: outboxForRun.status,
          clientAccountId: outboxForRun.clientAccountId,
          sourceLeadEventId: outboxForRun.sourceLeadEventId,
          externalCallExecuted: outboxForRun.externalCallExecuted,
          lastError: outboxForRun.lastError,
          liveRunId: outboxForRun.liveRunId,
        }
      : null,
    onboardingTestAttemptId: input.onboardingTestAttemptId,
    onboardingTestAttemptKeys: input.onboardingTestAttemptKeys,
  };
  const canonicalFor = (workflowRequired: boolean) =>
    canonicalGhlDelivery({
      ...canonicalBase,
      destination: destination ? { clientAccountId: destination.clientAccountId, workflowStartRequired: workflowRequired } : null,
    });

  let canonical: boolean | null;
  let canonicalReasons: string[];
  let unverifiedReason: string | null = null;
  if (recorded === true || recorded === false) {
    const verdict = canonicalFor(recorded);
    canonical = verdict.canonical;
    canonicalReasons = verdict.reasons;
  } else {
    const required = canonicalFor(true);
    const optional = canonicalFor(false);
    if (required.canonical === optional.canonical) {
      canonical = required.canonical;
      canonicalReasons = required.canonical ? [] : required.reasons.filter((reason) => optional.reasons.includes(reason));
    } else {
      canonical = null;
      canonicalReasons = ["workflow_requirement_unknown"];
      unverifiedReason = "workflow_requirement_unrecorded";
    }
  }

  const contactVerdict = ghlContactReceived({
    run: {
      id: run.id,
      mode: run.mode,
      status: run.status,
      completedAt: run.completedAt,
      destinationClientAccountId: run.destinationClientAccountId,
      destinationSubaccountIdGhl: run.destinationSubaccountIdGhl,
      idempotencyKey: run.idempotencyKey,
    },
    steps: canonicalSteps,
    destination: destination
      ? { clientAccountId: destination.clientAccountId, locationIdGhl: destination.destinationSubaccountIdGhl }
      : null,
    outbox: outboxForRun
      ? {
          status: outboxForRun.status,
          clientAccountId: outboxForRun.clientAccountId,
          sourceLeadEventId: outboxForRun.sourceLeadEventId,
          destinationLocationIdGhl: outboxForRun.destinationLocationIdGhl,
          liveRunId: outboxForRun.liveRunId,
        }
      : null,
    sourceLead: input.sourceLead,
    onboardingTestAttemptId: input.onboardingTestAttemptId,
    onboardingTestAttemptKeys: input.onboardingTestAttemptKeys,
  });

  const disposition = deliveryRetryDisposition({ status: run.status, stepRuns: run.stepRuns });
  const retryText = describeRetryDisposition({ disposition, runStatus: run.status, outbox: outboxForRun });

  const contactStep = stepOf("create_or_update_contact");
  const opportunityStep = stepDiag("create_or_update_opportunity");
  const workflowStep = stepDiag("start_workflow");
  const workflowRaw = stepOf("start_workflow");

  return {
    run: {
      id: run.id,
      status: run.status,
      mode: run.mode,
      startedAt: run.startedAt.toISOString(),
      completedAt: iso(run.completedAt),
      durationMs: run.durationMs,
      workflowStartRequiredRecorded: recorded,
      summary: sanitizeErrorText(run.summary),
      errors: sanitizeErrorList(run.errors),
      warnings: sanitizeErrorList(run.warnings),
    },
    source: {
      sourceLeadEventId: outboxForRun?.sourceLeadEventId ?? null,
      routingDryRunDecisionId: run.routingDryRunDecisionId,
      leadDeliveryPlanId: run.leadDeliveryPlanId,
      campaignRoutingRuleId: run.campaignRoutingRuleId,
    },
    destination: {
      clientAccountId: run.destinationClientAccountId,
      masterClientAccountId: run.masterClientAccountId,
      ghlLocationId: run.destinationSubaccountIdGhl,
    },
    contact: {
      status: contactStep?.status ?? null,
      externalId: contactStep?.externalId?.trim() || null,
      receiptOutcome: stepDiag("create_or_update_contact")?.receiptOutcome ?? null,
      result: results.contact,
    },
    opportunity: {
      stepPresent: opportunityStep != null,
      status: opportunityStep?.status ?? null,
      errorCode: opportunityStep?.errorCode ?? null,
      httpStatus: opportunityStep?.httpStatus ?? null,
      errorMessage: opportunityStep?.errorMessage ?? null,
      ghlError: opportunityStep?.ghlError ?? null,
      stepExpectedByDestination: destination ? opportunityConfigured : null,
    },
    workflow: {
      stepPresent: workflowStep != null,
      status: workflowStep?.status ?? null,
      attempted: workflowStep?.externalCallExecuted === true,
      result: results.workflow,
      requiredRecorded: recorded,
      skipReason: workflowStep && workflowStep.status === "skipped" ? sanitizeErrorText(workflowRaw?.errorSummary) : null,
      errorCode: workflowStep?.errorCode ?? null,
    },
    steps,
    contributors,
    verdict: {
      canonical,
      canonicalReasons,
      unverifiedReason,
      contactReceived: contactVerdict.received,
      contactReceivedReasons: contactVerdict.reasons,
    },
    retry: {
      disposition,
      automaticRetryPending: retryText.automaticRetryPending,
      explanation: retryText.explanation,
      outbox: outboxForRun
        ? {
            status: outboxForRun.status,
            outcome: sanitizeCode(outboxForRun.outcome),
            attemptCount: outboxForRun.attemptCount,
            externalCallExecuted: outboxForRun.externalCallExecuted,
            lastError: sanitizeCode(outboxForRun.lastError),
            availableAt: outboxForRun.availableAt.toISOString(),
            executingAt: iso(outboxForRun.executingAt),
            settledAt: iso(outboxForRun.settledAt),
          }
        : null,
    },
    destinationConfig: destination
      ? destinationDiagnostic({
          destination,
          accountStatus: input.accountStatus,
          runLocationId: run.destinationSubaccountIdGhl,
          runStartedAt: run.startedAt,
        })
      : null,
    evidence: { storedBodiesReturned: false, consumerFieldsReturned: false, externalCallsMade: false },
  };
}

export type GhlRunDiagnosticResult =
  | { found: true; diagnostic: GhlRunDiagnostic }
  | { found: false };

export async function loadGhlRunDiagnostic(db: DiagnosticsDb, runId: string): Promise<GhlRunDiagnosticResult> {
  const run = await db.ghlLiveDeliveryRun.findUnique({
    where: { id: runId },
    select: RUN_DIAGNOSTIC_RUN_SELECT,
  });
  if (!run) return { found: false };

  const [destination, account, outbox] = await Promise.all([
    db.clientGhlDestination.findUnique({
      where: { clientAccountId: run.destinationClientAccountId },
      select: RUN_DIAGNOSTIC_DESTINATION_SELECT,
    }),
    db.clientAccount.findUnique({
      where: { clientAccountId: run.destinationClientAccountId },
      select: { status: true },
    }),
    db.ghlAssociationDispatchOutbox.findFirst({
      where: { liveRunId: run.id },
      orderBy: { createdAt: "desc" },
      select: RUN_DIAGNOSTIC_OUTBOX_SELECT,
    }),
  ]);
  const sourceLead = outbox
    ? await db.sourceLeadEvent.findUnique({
        where: { id: outbox.sourceLeadEventId },
        select: { id: true, bulkImportId: true, bulkImportRowId: true, sourceType: true },
      })
    : null;
  const [keys, attemptIds] = await Promise.all([loadOnboardingKeys(db, [run]), loadAttemptIds(db, [run])]);

  return {
    found: true,
    diagnostic: buildGhlRunDiagnostic({
      run,
      destination,
      accountStatus: account?.status ?? null,
      outbox,
      sourceLead,
      onboardingTestAttemptKeys: keys,
      onboardingTestAttemptId: attemptIds.get(run.idempotencyKey.trim()) ?? null,
    }),
  };
}
