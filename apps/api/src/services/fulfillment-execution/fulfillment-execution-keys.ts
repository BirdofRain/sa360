import {
  FULFILLMENT_EXECUTION_POLICY_VERSION,
  FULFILLMENT_RESERVATION_POLICY_VERSION,
} from "@sa360/shared";

export function buildReservationIdempotencyKey(allocationId: string): string {
  return `reservation:${allocationId.trim()}:${FULFILLMENT_RESERVATION_POLICY_VERSION}`;
}

export function buildDeliveryAttemptIdempotencyKey(
  deliveryInstructionId: string,
  attemptNumber: number
): string {
  return `delivery_attempt:${deliveryInstructionId.trim()}:${attemptNumber}:${FULFILLMENT_EXECUTION_POLICY_VERSION}`;
}

export function buildDeliveryAttemptClaimIdempotencyKey(
  deliveryInstructionId: string,
  claimNonce: string
): string {
  return `delivery_attempt_claim:${deliveryInstructionId.trim()}:${claimNonce.trim()}:${FULFILLMENT_EXECUTION_POLICY_VERSION}`;
}

export {
  FULFILLMENT_RESERVATION_POLICY_VERSION,
  FULFILLMENT_EXECUTION_POLICY_VERSION,
};
