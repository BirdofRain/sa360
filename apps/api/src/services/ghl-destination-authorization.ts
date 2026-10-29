/**
 * Persisted destination authorization for ongoing GHL delivery.
 *
 * An empty SA360_LIVE_CANARY_ALLOWED_DESTINATIONS value does not authorize a
 * client. The direct-delivery client and location env lists are not read here.
 * A destination is authorized only when an operator has activated that saved
 * location on the client record.
 */

import type { ClientGhlDestination } from "@prisma/client";

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
  stepRuns: Array<{ errorCode: string | null; responseRedactedJson: unknown }>;
};

/**
 * succeeded, partial_success, and executing are kept.
 * A failed run that already called GHL, or that has no step evidence, is kept.
 * A failed run whose steps show the call never left SA360 can be retried on the same row.
 */
export function ongoingRunDisposition(run: DeliveryRunDispositionInput | null): "create" | "retry" | "hold" {
  if (!run) return "create";
  if (
    run.status === "succeeded" ||
    run.status === "partial_success" ||
    run.status === "executing" ||
    run.status === "skipped_duplicate"
  ) {
    return "hold";
  }
  if (run.status !== "failed") return "hold";
  if (run.stepRuns.length === 0 || runHadExternalCall(run)) return "hold";
  return "retry";
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
