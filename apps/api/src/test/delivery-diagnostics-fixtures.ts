import type {
  StoredDestinationForDiagnostic,
  StoredOutboxForDiagnostic,
  StoredRunForDiagnostic,
} from "../services/delivery-diagnostics/ghl-run-diagnostic.js";

export const FIXTURE_NOW = new Date("2026-11-25T12:00:00.000Z");
export const FIXTURE_CLIENT = "client_fixture_1";
export const FIXTURE_LOCATION = "loc_fixture_1";
export const FIXTURE_LEAD = "lead_event_fixture_1";
export const FIXTURE_RUN = "run_fixture_1";
export const FIXTURE_PII = "jane.consumer@example.com";

export function receipt(operation: string, outcome: string, externalId: string | null) {
  return {
    externalCallExecuted: outcome === "completed",
    vetOperationReceipt: {
      operation,
      outcome,
      externalId,
      httpStatus: outcome === "completed" ? 200 : outcome === "rejected" ? 422 : 500,
      idempotencyKey: `assoc:${operation}`,
    },
  };
}

export type FixtureStep = StoredRunForDiagnostic["stepRuns"][number];

export function step(input: Partial<FixtureStep> & Pick<FixtureStep, "stepType" | "status">, order: number): FixtureStep {
  return {
    stepOrder: order,
    externalId: null,
    errorCode: null,
    errorSummary: null,
    responseRedactedJson: null,
    startedAt: null,
    completedAt: null,
    ...input,
  };
}

export const contactStep = (order = 1) =>
  step(
    {
      stepType: "create_or_update_contact",
      status: "succeeded",
      externalId: "contact_1",
      responseRedactedJson: receipt("contact", "completed", "contact_1"),
    },
    order
  );

export const tagStep = (order = 2) =>
  step({ stepType: "add_tags", status: "succeeded", responseRedactedJson: receipt("tags", "completed", null) }, order);

export const workflowSkipped = (order = 3) =>
  step(
    {
      stepType: "start_workflow",
      status: "skipped",
      errorSummary: "workflow not configured",
      responseRedactedJson: {
        externalCallExecuted: false,
        vetOperationReceipt: {
          operation: "workflow",
          outcome: "skipped",
          externalId: null,
          httpStatus: null,
          idempotencyKey: "assoc:workflow",
        },
      },
    },
    order
  );

export const workflowCompleted = (order = 3) =>
  step(
    {
      stepType: "start_workflow",
      status: "succeeded",
      externalId: "contact_1",
      responseRedactedJson: receipt("workflow", "completed", "contact_1"),
    },
    order
  );

export const opportunityFailed = (order = 4) =>
  step(
    {
      stepType: "create_or_update_opportunity",
      status: "failed",
      errorCode: "http_422",
      errorSummary: `Opportunity for ${FIXTURE_PII} rejected`,
      responseRedactedJson: {
        externalCallExecuted: true,
        statusCode: 422,
        message: `contact ${FIXTURE_PII} has no pipeline`,
        body: { contact: { email: FIXTURE_PII, phone: "+15555550111" } },
        vetOperationReceipt: {
          operation: "opportunity",
          outcome: "rejected",
          externalId: null,
          httpStatus: 422,
          idempotencyKey: "assoc:opportunity",
        },
      },
    },
    order
  );

export const ownerFailed = (order = 5) =>
  step(
    {
      stepType: "assign_owner",
      status: "optional_failed",
      errorCode: "http_500",
      responseRedactedJson: { externalCallExecuted: true, httpStatus: 500 },
    },
    order
  );

export function runFixture(overrides: Partial<StoredRunForDiagnostic> = {}): StoredRunForDiagnostic {
  return {
    id: FIXTURE_RUN,
    leadDeliveryPlanId: "plan_fixture_1",
    routingDryRunDecisionId: "decision_fixture_1",
    campaignRoutingRuleId: null,
    masterClientAccountId: "lal_master_vet",
    destinationClientAccountId: FIXTURE_CLIENT,
    destinationSubaccountIdGhl: FIXTURE_LOCATION,
    mode: "ongoing_association",
    status: "succeeded",
    idempotencyKey: `ghl-association:${FIXTURE_LEAD}`,
    startedAt: new Date("2026-11-25T11:00:00.000Z"),
    completedAt: new Date("2026-11-25T11:00:05.000Z"),
    durationMs: 5000,
    summary: "succeeded",
    warnings: null,
    errors: null,
    workflowStartRequired: true,
    stepRuns: [contactStep(), tagStep(), workflowCompleted()],
    ...overrides,
  };
}

export function destinationFixture(
  overrides: Partial<StoredDestinationForDiagnostic> = {}
): StoredDestinationForDiagnostic {
  return {
    clientAccountId: FIXTURE_CLIENT,
    destinationSubaccountIdGhl: FIXTURE_LOCATION,
    destinationWorkflowIdGhl: "wf_fixture",
    destinationPipelineIdGhl: null,
    destinationPipelineStageIdGhl: null,
    workflowTriggerMode: "direct_api",
    workflowStartRequired: true,
    ownerAssignmentRequired: false,
    customFieldStampRequired: false,
    opportunityCreationEnabled: false,
    sourceEnrichmentPolicyJson: {},
    snapshotInstalled: true,
    requiredFieldsInstalled: true,
    ghlConnectionStatus: "connected",
    deliveryMode: "live",
    deliveryEnabled: true,
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    updatedAt: new Date("2026-11-24T00:00:00.000Z"),
    ...overrides,
  };
}

export function outboxFixture(overrides: Partial<StoredOutboxForDiagnostic> = {}): StoredOutboxForDiagnostic {
  return {
    status: "settled",
    outcome: "succeeded",
    attemptCount: 1,
    externalCallExecuted: true,
    lastError: null,
    clientAccountId: FIXTURE_CLIENT,
    sourceLeadEventId: FIXTURE_LEAD,
    destinationLocationIdGhl: FIXTURE_LOCATION,
    liveRunId: FIXTURE_RUN,
    availableAt: new Date("2026-11-25T10:59:00.000Z"),
    executingAt: null,
    settledAt: new Date("2026-11-25T11:00:05.000Z"),
    ...overrides,
  };
}

export const sourceLeadFixture = {
  id: FIXTURE_LEAD,
  bulkImportId: null,
  bulkImportRowId: null,
  sourceType: "webhook",
};
