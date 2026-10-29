/**
 * Captured-test port over the existing company Sheets writer.
 *
 * Agent E mounts this in place of createFailClosedSheetsAppend. This file does
 * not register routes, enable flags, or call the GHL adapter.
 */

import type {
  CapturedTestSheetsAppendPort,
  CustomCapturedCampaignSheetsPort,
  SheetsAppendOutcome,
  SheetsAppendRequest,
} from "../client-onboarding-v2/captured-test-delivery.js";
import {
  appendOnboardingCapturedTestRow,
  sendCompanySheetsCapturedEventTestRow,
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

export function createCustomCapturedCampaignSheetsPort(
  deps: CompanySheetsDeliveryDeps = {}
): CustomCapturedCampaignSheetsPort {
  return {
    async send(input) {
      const result = await sendCompanySheetsCapturedEventTestRow(input.clientAccountId, input.sourceLeadEventId, deps);
      if (result.ok) {
        return {
          status: "succeeded",
          externalCallExecuted: result.externalCallExecuted,
          inventoryAffected: result.inventoryAffected,
          billingAffected: result.billingAffected,
          deliveryEnabled: result.deliveryEnabled,
          cutoffChanged: result.cutoffChanged,
          duplicate: result.duplicate,
        };
      }
      const uncertain = result.code === "uncertain" || result.code === "append_outcome_unknown";
      return {
        status: uncertain ? "uncertain" : "failed",
        externalCallExecuted: result.externalCallExecuted === true,
        error: result.code,
        inventoryAffected: result.inventoryAffected === true,
        billingAffected: result.billingAffected === true,
        deliveryEnabled: result.deliveryEnabled === true,
        cutoffChanged: result.cutoffChanged === true,
        duplicate: result.duplicate === true,
      };
    },
  };
}
