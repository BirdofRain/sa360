import {
  evaluateDeliveryReadiness,
  type DeliveryReadinessAssessment,
  type DeliveryReadinessRuleInput,
} from "./delivery-readiness.service.js";

export class LiveDeliveryNotAllowedError extends Error {
  readonly code = "LIVE_DELIVERY_NOT_ALLOWED";

  constructor(
    message: string,
    public readonly assessment: DeliveryReadinessAssessment
  ) {
    super(message);
    this.name = "LiveDeliveryNotAllowedError";
  }
}

/** Central guard for any future live delivery executor. Phase 4G does not call GHL. */
export function assertLiveDeliveryAllowed(rule: DeliveryReadinessRuleInput): DeliveryReadinessAssessment {
  const assessment = evaluateDeliveryReadiness(rule);
  if (!assessment.canDeliverLive) {
    const detail =
      assessment.blockers[0] ??
      assessment.requiredApprovals[0] ??
      "Delivery readiness checks failed.";
    throw new LiveDeliveryNotAllowedError(detail, assessment);
  }
  return assessment;
}

export function isLiveDeliveryAllowed(rule: DeliveryReadinessRuleInput): boolean {
  return evaluateDeliveryReadiness(rule).canDeliverLive;
}
