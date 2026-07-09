import type { DeliveryExecutionResult } from "./fulfillment-execution.types.js";

export class ExternalCallPreSendCancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalCallPreSendCancellationError";
  }
}

export function assertTerminalPreSendResult(result: DeliveryExecutionResult): void {
  if (result.status !== "terminal_pre_send_failure") return;
  if (result.externalCallExecuted !== false) {
    throw new ExternalCallPreSendCancellationError(
      "terminal_pre_send_failure requires externalCallExecuted=false"
    );
  }
}

export function assertSafeForPreSendCancellation(result: DeliveryExecutionResult): void {
  if (result.status === "terminal_pre_send_failure") {
    assertTerminalPreSendResult(result);
    return;
  }
  if (result.status === "unknown_outcome" || result.status === "partial_external_success_requiring_review") {
    throw new ExternalCallPreSendCancellationError(
      `${result.status} must not use pre-send cancellation`
    );
  }
  if (result.status === "retryable_failure" && result.externalCallExecuted === true) {
    throw new ExternalCallPreSendCancellationError(
      "retryable_failure with externalCallExecuted=true must not use pre-send cancellation"
    );
  }
}

export function executionResultExternalCallExecuted(result: DeliveryExecutionResult): boolean {
  switch (result.status) {
    case "terminal_pre_send_failure":
      return false;
    case "unknown_outcome":
    case "partial_external_success_requiring_review":
      return result.externalCallExecuted;
    case "retryable_failure":
      return result.externalCallExecuted ?? false;
    case "succeeded":
      return true;
    default:
      return false;
  }
}
