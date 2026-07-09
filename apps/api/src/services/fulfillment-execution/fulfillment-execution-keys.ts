import type { DeliveryAttemptMode } from "@prisma/client";
import {
  FULFILLMENT_EXECUTION_POLICY_VERSION,
  FULFILLMENT_RESERVATION_POLICY_VERSION,
} from "@sa360/shared";

export function buildReservationIdempotencyKey(allocationId: string): string {
  return `reservation:${allocationId.trim()}:${FULFILLMENT_RESERVATION_POLICY_VERSION}`;
}

export function buildDeliveryAttemptIdempotencyKey(
  deliveryInstructionId: string,
  attemptNumber: number,
  executionMode: DeliveryAttemptMode
): string {
  return `delivery_attempt:${deliveryInstructionId.trim()}:${attemptNumber}:${executionMode}:${FULFILLMENT_EXECUTION_POLICY_VERSION}`;
}

export {
  FULFILLMENT_RESERVATION_POLICY_VERSION,
  FULFILLMENT_EXECUTION_POLICY_VERSION,
};
