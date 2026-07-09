import type { LiveCanaryExecutionResult } from "../ghl-delivery-adapter/ghl-live-canary-executor.service.js";
import { isRequiredDeliveryPathComplete } from "../ghl-delivery-adapter/ghl-live-canary-step-requirements.js";
import type { DeliveryExecutionResult } from "./fulfillment-execution.types.js";

const DUPLICATE_RISK_STEP_TYPES = new Set([
  "create_or_update_contact",
  "create_or_update_opportunity",
  "add_tags",
  "stamp_custom_fields",
  "start_workflow",
]);

function anyExternalCallExecuted(execution: LiveCanaryExecutionResult): boolean {
  return execution.stepOutcomes.some((step) => step.externalCallExecuted);
}

function contactStepSucceeded(execution: LiveCanaryExecutionResult): boolean {
  return execution.stepOutcomes.some(
    (step) => step.stepType === "create_or_update_contact" && step.status === "succeeded"
  );
}

function failedStepTypes(execution: LiveCanaryExecutionResult): string[] {
  return execution.stepOutcomes
    .filter((step) => step.status === "failed")
    .map((step) => step.stepType);
}

export function classifyGhlLiveExecutionResult(
  execution: LiveCanaryExecutionResult,
  input: { opportunityConfigured: boolean }
): DeliveryExecutionResult {
  const externalCallExecuted = anyExternalCallExecuted(execution);
  const contactSucceeded = contactStepSucceeded(execution);
  const requiredPathComplete = isRequiredDeliveryPathComplete(
    execution.stepOutcomes,
    input.opportunityConfigured
  );

  const sanitizedResponse = {
    runStatus: execution.runStatus,
    summary: execution.summary,
    contactIdGhl: execution.contactIdGhl,
    opportunityIdGhl: execution.opportunityIdGhl,
    workflowStarted: execution.workflowStarted,
    externalCallExecuted,
    stepOutcomes: execution.stepOutcomes.map((step) => ({
      stepType: step.stepType,
      status: step.status,
      externalId: step.externalId,
      externalCallExecuted: step.externalCallExecuted,
      errorCode: step.errorCode,
      errorSummary: step.errorSummary,
    })),
    errors: execution.errors,
    warnings: execution.warnings,
  };

  if (!externalCallExecuted) {
    return {
      status: "terminal_pre_send_failure",
      errorCode: "no_external_call_executed",
      errorSummary: execution.summary || execution.errors[0] || "No external call executed.",
      sanitizedResponse,
    };
  }

  if (
    execution.runStatus === "succeeded" ||
    (execution.runStatus === "partial_success" && requiredPathComplete && contactSucceeded)
  ) {
    return {
      status: "succeeded",
      externalReference: execution.contactIdGhl,
      sanitizedResponse,
      contactIdGhl: execution.contactIdGhl,
      opportunityIdGhl: execution.opportunityIdGhl,
      workflowStarted: execution.workflowStarted,
      allRequiredComplete: requiredPathComplete,
    };
  }

  if (contactSucceeded) {
    const failedSteps = failedStepTypes(execution);
    const hasDuplicateRiskFailure = failedSteps.some((stepType) =>
      DUPLICATE_RISK_STEP_TYPES.has(stepType)
    );
    if (hasDuplicateRiskFailure) {
      return {
        status: "partial_external_success_requiring_review",
        errorCode: "partial_external_success",
        errorSummary: execution.summary,
        sanitizedResponse,
        contactIdGhl: execution.contactIdGhl,
        opportunityIdGhl: execution.opportunityIdGhl,
        externalCallExecuted: true,
      };
    }
  }

  if (!contactSucceeded) {
    return {
      status: "terminal_pre_send_failure",
      errorCode: "contact_upsert_failed",
      errorSummary: execution.summary || execution.errors[0] || "Contact upsert failed.",
      sanitizedResponse,
    };
  }

  return {
    status: "retryable_failure",
    errorCode: execution.runStatus,
    errorSummary: execution.summary,
    retryable: false,
    sanitizedResponse,
    contactIdGhl: execution.contactIdGhl,
  };
}

export function classifyThrownGhlExecutionError(
  err: unknown,
  input: { externalCallMayHaveStarted: boolean }
): DeliveryExecutionResult {
  const message = err instanceof Error ? err.message : String(err);
  if (input.externalCallMayHaveStarted) {
    return {
      status: "unknown_outcome",
      errorCode: "live_canary_exception",
      errorSummary: message,
      externalCallExecuted: true,
      sanitizedResponse: { error: message, externalCallExecuted: true },
    };
  }
  return {
    status: "terminal_pre_send_failure",
    errorCode: "live_canary_exception",
    errorSummary: message,
    sanitizedResponse: { error: message, externalCallExecuted: false },
  };
}
