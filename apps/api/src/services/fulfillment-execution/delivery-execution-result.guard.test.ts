import test from "node:test";
import assert from "node:assert/strict";

import {
  assertSafeForPreSendCancellation,
  assertTerminalPreSendResult,
  ExternalCallPreSendCancellationError,
} from "./delivery-execution-result.guard.js";
import { recordLiveAttemptCanceledBeforeExternalCall } from "./fulfillment-outcome.service.js";
import type { DeliveryExecutionResult } from "./fulfillment-execution.types.js";

test("terminal_pre_send_failure requires externalCallExecuted=false", () => {
  const valid: DeliveryExecutionResult = {
    status: "terminal_pre_send_failure",
    errorCode: "x",
    errorSummary: "y",
    externalCallExecuted: false,
  };
  assert.doesNotThrow(() => assertTerminalPreSendResult(valid));

  const invalid = {
    status: "terminal_pre_send_failure",
    errorCode: "x",
    errorSummary: "y",
    externalCallExecuted: true,
  } as unknown as DeliveryExecutionResult;
  assert.throws(
    () => assertTerminalPreSendResult(invalid),
    ExternalCallPreSendCancellationError
  );
});

test("external-call evidence cannot reach recordLiveAttemptCanceledBeforeExternalCall", async () => {
  await assert.rejects(
    () =>
      recordLiveAttemptCanceledBeforeExternalCall(
        "attempt_1",
        {
          errorCode: "unsafe",
          errorSummary: "unsafe",
          externalCallExecuted: true,
        },
        {
          deliveryAttempt: {
            findUnique: async () => null,
          },
        } as never
      ),
    ExternalCallPreSendCancellationError
  );
});

test("unknown and partial results are blocked from pre-send cancellation", () => {
  const unknown: DeliveryExecutionResult = {
    status: "unknown_outcome",
    errorCode: "x",
    errorSummary: "y",
    externalCallExecuted: true,
  };
  assert.throws(
    () => assertSafeForPreSendCancellation(unknown),
    ExternalCallPreSendCancellationError
  );

  const partial: DeliveryExecutionResult = {
    status: "partial_external_success_requiring_review",
    errorCode: "x",
    errorSummary: "y",
    externalCallExecuted: true,
    sanitizedResponse: {},
    contactIdGhl: "c1",
  };
  assert.throws(
    () => assertSafeForPreSendCancellation(partial),
    ExternalCallPreSendCancellationError
  );
});
