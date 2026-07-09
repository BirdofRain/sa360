import type { DeliveryAttemptMode, DeliveryInstructionStatus, LeadAllocationStatus } from "@prisma/client";

export const EXECUTABLE_ALLOCATION_STATUSES: LeadAllocationStatus[] = ["reserved", "delivering"];

export const NON_EXECUTABLE_ALLOCATION_STATUSES: LeadAllocationStatus[] = [
  "shadow",
  "released",
  "committed",
  "review_required",
];

export const CLAIMABLE_INSTRUCTION_STATUSES: DeliveryInstructionStatus[] = ["planned", "queued"];

export const ACTIVE_ATTEMPT_STATUSES = ["claimed", "in_progress"] as const;

export type ExecutionMode = DeliveryAttemptMode;

export const EXECUTION_MODE_SIMULATION: ExecutionMode = "simulation";
export const EXECUTION_MODE_LIVE: ExecutionMode = "live";

export function isLiveExecutionMode(mode: ExecutionMode): boolean {
  return mode === EXECUTION_MODE_LIVE;
}
