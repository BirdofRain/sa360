/**
 * Persisted destination authorization for ongoing GHL delivery.
 *
 * An empty SA360_LIVE_CANARY_ALLOWED_DESTINATIONS value does not authorize a
 * client. The direct-delivery client and location env lists are not read here.
 * A destination is authorized only when an operator has activated that saved
 * location on the client record.
 */

import type { ClientGhlDestination } from "@prisma/client";
import { deliveryRetryDisposition } from "./ghl-delivery-adapter/vet-ghl-delivery-contract.js";

export const ENABLE_ONGOING_GHL_DELIVERY = "ENABLE ONGOING GHL DELIVERY";
export const DELIVER_ONE_GHL_TEST = "DELIVER ONE LEAD";

export type LiveDestinationRecord = Pick<
  ClientGhlDestination,
  | "deliveryEnabled"
  | "deliveryMode"
  | "clientCutoverApproved"
  | "internalApprovalStatus"
  | "destinationSubaccountIdGhl"
>;

/** Four persisted flags plus the saved location. A workflow id is not required for this check. */
export function isPersistedLiveDestination(
  destination: LiveDestinationRecord | null | undefined,
  locationId: string | null | undefined
): boolean {
  if (!destination) return false;
  const location = locationId?.trim() ?? "";
  if (!location || destination.destinationSubaccountIdGhl.trim() !== location) return false;
  return (
    destination.deliveryEnabled === true &&
    destination.deliveryMode === "live" &&
    destination.clientCutoverApproved === true &&
    destination.internalApprovalStatus === "approved"
  );
}

export type DeliveryRunDispositionInput = {
  status: string;
  stepRuns: Array<{
    errorCode: string | null;
    responseRedactedJson: unknown;
    stepType?: string | null;
    status?: string | null;
    externalId?: string | null;
  }>;
};

/**
 * succeeded, partial_success, and executing are kept.
 * Ambiguous and rejected remote outcomes are kept.
 * A failed run whose steps never left SA360 can be retried.
 * A failed run with a completed operation resumes only the operations that
 * have no completed receipt. Completed operations are not repeated.
 */
export function ongoingRunDisposition(
  run: DeliveryRunDispositionInput | null
): "create" | "retry" | "resume" | "hold" {
  return deliveryRetryDisposition(run);
}

export function runHadExternalCall(run: DeliveryRunDispositionInput): boolean {
  for (const step of run.stepRuns) {
    const response = asRecord(step.responseRedactedJson);
    if (response?.externalCallExecuted === true) return true;
    const code = step.errorCode ?? "";
    if (code === "http_transport" || code === "http_0" || code.startsWith("http_")) return true;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
