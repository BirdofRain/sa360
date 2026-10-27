/**
 * Reviewed adapter bindings for captured onboarding tests.
 *
 * These ports fail closed. They do not call Google or GoHighLevel.
 * The company Sheets append, lock, and RAW insert stay on
 * executeCompanySheetsDeliveryJob. That writer addresses a bound campaign or
 * Canary tab and does not accept an onboarding test worksheet without a
 * production-writer change, so this binding does not call it.
 * GHL writes stay behind isGhlWriteTransportAllowed, which is false.
 */

import { isGhlWriteTransportAllowed } from "../ghl-delivery-adapter/ghl-delivery-disabled-transport.js";
import { COMPANY_SHEETS_CANARY_SCHEMA_VERSION } from "../../lib/company-google-sheets-env.js";
import type {
  CapturedTestGhlLocationPort,
  CapturedTestSheetsAppendPort,
  GhlStepOutcome,
  SheetsAppendOutcome,
  SheetsAppendRequest,
} from "./captured-test-delivery.js";

export const ONBOARDING_SHEETS_WRITER_BLOCKER =
  "CompanySheetsDeliveryJob execution is limited to lead, aged_release, canary, and campaign_test bindings. An exact-v3 onboarding test worksheet is not one of those bindings, and this integration does not add a second writer or a new delivery-job kind.";

export function createFailClosedSheetsAppend(): CapturedTestSheetsAppendPort & { calls: SheetsAppendRequest[] } {
  const calls: SheetsAppendRequest[] = [];
  return {
    calls,
    async append(request) {
      const outcome = refuseSheets(request);
      if (outcome.externalCallExecuted) calls.push(request);
      return outcome;
    },
  };
}

export function refuseSheets(request: SheetsAppendRequest): SheetsAppendOutcome {
  const canary =
    request.schemaVersion === COMPANY_SHEETS_CANARY_SCHEMA_VERSION || request.worksheetRole === "canary";
  if (request.values.length === 35 && canary) {
    return { status: "failed", externalCallExecuted: false, error: "canary_schema_mismatch" };
  }
  if (canary) {
    return { status: "failed", externalCallExecuted: false, error: "canary_projection_not_a_v3_proof" };
  }
  return {
    status: "failed",
    externalCallExecuted: false,
    error: ONBOARDING_SHEETS_WRITER_BLOCKER,
  };
}

export function createFailClosedGhlPort(calls: string[] = []): CapturedTestGhlLocationPort {
  void calls;
  const refused = (): GhlStepOutcome => ({
    status: "failed",
    externalCallExecuted: false,
    httpStatus: null,
    externalId: null,
    error: isGhlWriteTransportAllowed() ? "ghl_transport_unexpectedly_allowed" : "ghl_write_transport_disabled",
    reason: "rejected",
  });
  return {
    async upsertContact() {
      return refused();
    },
    async createNote() {
      return refused();
    },
    async enrollWorkflow() {
      return refused();
    },
  };
}
