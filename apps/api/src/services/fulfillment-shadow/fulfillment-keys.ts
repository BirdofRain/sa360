import {
  FULFILLMENT_ALLOCATION_POLICY_VERSION,
  FULFILLMENT_ELIGIBILITY_POLICY_KEY,
  FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
  FULFILLMENT_SHADOW_WORK_TYPE,
} from "@sa360/shared";

export function buildFulfillmentOutboxIdempotencyKey(sourceLeadEventId: string): string {
  return `fulfillment:shadow:${sourceLeadEventId.trim()}`;
}

export function buildShadowAllocationIdempotencyKey(
  sourceLeadEventId: string,
  policyVersion: string = FULFILLMENT_ALLOCATION_POLICY_VERSION
): string {
  return `allocation:shadow:${sourceLeadEventId.trim()}:${policyVersion}`;
}

export {
  FULFILLMENT_ALLOCATION_POLICY_VERSION,
  FULFILLMENT_ELIGIBILITY_POLICY_KEY,
  FULFILLMENT_ELIGIBILITY_POLICY_VERSION,
  FULFILLMENT_SHADOW_WORK_TYPE,
};
