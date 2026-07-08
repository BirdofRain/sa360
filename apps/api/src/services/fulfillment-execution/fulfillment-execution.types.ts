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
