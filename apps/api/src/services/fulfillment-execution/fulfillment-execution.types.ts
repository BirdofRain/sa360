import type { LeadAllocationStatus } from "@prisma/client";

/** Statuses that hold an exclusive commercial claim on a source lead. */
export const ACTIVE_EXCLUSIVE_ALLOCATION_STATUSES: LeadAllocationStatus[] = [
  "reserved",
  "delivering",
  "committed",
  "review_required",
];

export const ACTIVE_ATTEMPT_STATUSES = ["claimed", "in_progress"] as const;

export type ReservationFailureCode =
  | "allocation_not_found"
  | "invalid_allocation_status"
  | "tenant_mismatch"
  | "order_not_found"
  | "order_not_active"
  | "order_not_configured"
  | "unsupported_order_kind"
  | "unsupported_fulfillment_mode"
  | "outside_fulfillment_cycle"
  | "ineligible_assessment"
  | "missing_required_instruction"
  | "exclusive_source_conflict"
  | "capacity_exhausted"
  | "reservation_race_lost";

export type ReservationResult =
  | {
      ok: true;
      status: "reserved" | "already_reserved";
      allocationId: string;
      leadOrderId: string;
      reservedQuantity: number;
    }
  | {
      ok: false;
      code: ReservationFailureCode;
      reasons: string[];
    };

export type DeliveryExecutionResult =
  | {
      status: "succeeded";
      externalReference: string | null;
      sanitizedResponse: Record<string, unknown>;
      contactIdGhl: string | null;
      opportunityIdGhl?: string | null;
      workflowStarted?: boolean;
      allRequiredComplete?: boolean;
    }
  | {
      status: "retryable_failure";
      errorCode: string;
      errorSummary: string;
      retryable: boolean;
      sanitizedResponse: Record<string, unknown>;
      contactIdGhl?: string | null;
    }
  | {
      status: "terminal_pre_send_failure";
      errorCode: string;
      errorSummary: string;
      sanitizedResponse?: Record<string, unknown>;
    }
  | {
      status: "unknown_outcome";
      errorCode: string;
      errorSummary: string;
      externalCallExecuted: boolean;
      sanitizedResponse?: Record<string, unknown>;
      contactIdGhl?: string | null;
    }
  | {
      status: "partial_external_success_requiring_review";
      errorCode: string;
      errorSummary: string;
      sanitizedResponse: Record<string, unknown>;
      contactIdGhl: string | null;
      opportunityIdGhl?: string | null;
      externalCallExecuted: boolean;
    };

export type ExecutionAdapterDeliverLiveInput = {
  idempotencyKey: string;
  authoritativeLocationId: string;
  instructionId: string;
  allocationId: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  destinationConfig: unknown;
  sourceLeadEvent: {
    sourceLeadUid: string | null;
    sourceProvider: string;
    sourceSystem: string;
    normalizedPayloadJson: unknown;
    enrichmentMetadataJson?: unknown;
  };
  deps?: import("../ghl-delivery-adapter/ghl-live-transport.js").GhlLiveHttpDeps;
};

export type Lf2ExecutionPosture =
  | "first_execution"
  | "blocked_replay"
  | "reconciliation_required"
  | "active_execution";
