import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";

export type WorkflowTriggerMode = "none" | "direct_api" | "tag_trigger";

/** Tag added after opportunity creation; GHL workflow should trigger on "Contact Tag Added". */
export const WORKFLOW_TRIGGER_TAG = "SA360::TRIGGER::NEW_LEAD";

export const WORKFLOW_TAG_TRIGGER_DETAIL =
  'Added workflow trigger tag SA360::TRIGGER::NEW_LEAD — configure GHL workflow trigger "Contact Tag Added" for this tag.';

export const WORKFLOW_TRIGGER_MODE_DEFAULT: WorkflowTriggerMode = "tag_trigger";

export function normalizeWorkflowTriggerMode(value: unknown): WorkflowTriggerMode {
  if (value === "none" || value === "direct_api" || value === "tag_trigger") {
    return value;
  }
  return WORKFLOW_TRIGGER_MODE_DEFAULT;
}

export function resolveWorkflowTriggerMode(ctx: GhlAdapterPlanContext): WorkflowTriggerMode {
  return normalizeWorkflowTriggerMode(ctx.destinationFieldMapping?.workflowTriggerMode);
}
