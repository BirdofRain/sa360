import type { DirectDemoDeliveryViewModel } from "@/lib/direct-delivery-demo/types";

export const DELIVERY_CONFIG_INCOMPLETE_MESSAGE =
  "Delivery config incomplete: missing pipeline/stage/workflow/custom field mapping.";

/** The five GHL delivery steps surfaced for source lead live canary results, in order. */
export const SOURCE_LEAD_DELIVERY_STEP_ORDER = [
  { stepType: "create_or_update_contact", label: "Contact upsert" },
  { stepType: "stamp_custom_fields", label: "Custom field stamp" },
  { stepType: "add_tags", label: "Tag application" },
  { stepType: "create_or_update_opportunity", label: "Opportunity create/update" },
  { stepType: "start_workflow", label: "Workflow start" },
] as const;

type DeliveryConfigFields = Pick<
  DirectDemoDeliveryViewModel,
  "deliveryPlanStatus" | "missingConfigFields"
>;

/** True when the failure looks like missing destination delivery configuration. */
export function isDeliveryConfigIncomplete(view: DeliveryConfigFields): boolean {
  if (view.missingConfigFields.length > 0) return true;
  return view.deliveryPlanStatus === "needs_config" || view.deliveryPlanStatus === "blocked";
}

export function deliveryConfigIncompleteMessage(view: DeliveryConfigFields): string | null {
  if (!isDeliveryConfigIncomplete(view)) return null;
  if (view.missingConfigFields.length > 0) {
    return `${DELIVERY_CONFIG_INCOMPLETE_MESSAGE} (${view.missingConfigFields.join(", ")})`;
  }
  return DELIVERY_CONFIG_INCOMPLETE_MESSAGE;
}

export type FailedDeliveryStep = { stepType: string; label: string };

/** Resolve the exact failed delivery step from the failure summary or step statuses. */
export function failedDeliveryStep(
  view: Pick<DirectDemoDeliveryViewModel, "liveRunFailure" | "liveRunStepSummary">
): FailedDeliveryStep | null {
  if (view.liveRunFailure && view.liveRunFailure.failedStepType !== "unknown") {
    return {
      stepType: view.liveRunFailure.failedStepType,
      label: view.liveRunFailure.failedStepLabel,
    };
  }
  const failed = view.liveRunStepSummary.find(
    (s) => s.status === "failed" || s.status === "optional_failed"
  );
  if (failed) return { stepType: failed.stepType, label: failed.label };
  return null;
}

export type Sa360StepProof = {
  /** "yes" only when SA360 executed the step and GHL confirmed success; never assumed. */
  executed: "yes" | "no" | "unknown";
  status: string | null;
  externalCallExecuted: boolean;
  externalId: string | null;
  httpStatus: number | null;
  responseBody: Record<string, unknown> | null;
};

/**
 * Prove (never assume) whether SA360 itself executed a given live-canary step.
 * Returns "unknown" when the step is absent from deliveryResultJson.
 */
export function sa360StepProof(
  view: Pick<DirectDemoDeliveryViewModel, "liveRunStepSummary">,
  stepType: string
): Sa360StepProof {
  const step = view.liveRunStepSummary.find((s) => s.stepType === stepType);
  if (!step) {
    return {
      executed: "unknown",
      status: null,
      externalCallExecuted: false,
      externalId: null,
      httpStatus: null,
      responseBody: null,
    };
  }
  const executed: Sa360StepProof["executed"] =
    step.externalCallExecuted && step.status === "succeeded"
      ? "yes"
      : step.externalCallExecuted
        ? "no"
        : "unknown";
  return {
    executed,
    status: step.status,
    externalCallExecuted: step.externalCallExecuted,
    externalId: step.externalId,
    httpStatus: step.httpStatus,
    responseBody: step.responseBody,
  };
}

/** Proof that SA360 executed and succeeded the contact upsert step (vs. assuming success). */
export function sa360ContactStepProof(
  view: Pick<DirectDemoDeliveryViewModel, "liveRunStepSummary">
): Sa360StepProof {
  return sa360StepProof(view, "create_or_update_contact");
}

/** True when a delivery result represents an attempted/finished live canary run worth detailing. */
export function hasLiveDeliveryDetail(
  view: Pick<
    DirectDemoDeliveryViewModel,
    "mode" | "liveRunId" | "liveRunStatus" | "liveRunFailure" | "liveRunStepSummary" | "externalCallExecuted"
  >
): boolean {
  return Boolean(
    view.liveRunId ||
      view.liveRunStatus ||
      view.liveRunFailure ||
      view.externalCallExecuted ||
      view.liveRunStepSummary.length > 0
  );
}
