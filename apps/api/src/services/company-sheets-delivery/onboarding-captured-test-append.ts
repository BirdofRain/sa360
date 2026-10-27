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
} from "./company-sheets-delivery.service.js";

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
      if (result.ok) {
        return {
          status: "succeeded",
          rowsWritten: result.rowsWritten,
          externalCallExecuted: true,
        };
      }
      if (result.uncertainReason && result.appendStartedAt) {
        return {
          status: "uncertain",
          externalCallExecuted: true,
          reason: result.uncertainReason,
          appendStartedAt: result.appendStartedAt,
        };
      }
      return { status: "failed", externalCallExecuted: false, error: result.code };
    },
  };
}
