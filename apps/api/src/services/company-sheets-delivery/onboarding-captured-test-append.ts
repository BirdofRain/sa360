/**
 * Captured-test port over the existing company Sheets writer.
 *
 * Agent E mounts this in place of createFailClosedSheetsAppend. This file does
 * not register routes, enable flags, or call the GHL adapter.
 */

import type {
  CapturedTestSheetsAppendPort,
  SheetsAppendOutcome,
  SheetsAppendRequest,
} from "../client-onboarding-v2/captured-test-delivery.js";
import {
  appendOnboardingCapturedTestRow,
  type CompanySheetsDeliveryDeps,
  type OnboardingCapturedTestAppendResult,
} from "./company-sheets-delivery.service.js";

export function onboardingCapturedTestSheetsOutcome(result: OnboardingCapturedTestAppendResult): SheetsAppendOutcome {
  if (result.ok) {
    return {
      status: "succeeded",
      rowsWritten: result.rowsWritten,
      externalCallExecuted: result.externalCallExecuted,
    };
  }
  if (result.uncertainReason && result.appendStartedAt) {
    return {
      status: "uncertain",
      externalCallExecuted: result.externalCallExecuted,
      reason: result.uncertainReason,
      appendStartedAt: result.appendStartedAt,
    };
  }
  return { status: "failed", externalCallExecuted: result.externalCallExecuted, error: result.code };
}

export function createOnboardingCapturedTestSheetsAppend(
  deps: CompanySheetsDeliveryDeps = {}
): CapturedTestSheetsAppendPort {
  return {
    async append(request: SheetsAppendRequest): Promise<SheetsAppendOutcome> {
      const result = await appendOnboardingCapturedTestRow(
        {
          clientAccountId: request.clientAccountId,
          spreadsheetId: request.spreadsheetId,
          worksheetId: request.worksheetId,
          worksheetTitle: request.worksheetTitle,
          worksheetRole: request.worksheetRole,
          schemaVersion: request.schemaVersion,
          values: request.values,
          idempotencyKey: request.idempotencyKey,
          deliveryRowId: request.deliveryRowId,
          sourceLeadEventId: request.sourceLeadEventId,
          testRunId: request.testRunId,
        },
        deps
      );
      return onboardingCapturedTestSheetsOutcome(result);
    },
  };
}
