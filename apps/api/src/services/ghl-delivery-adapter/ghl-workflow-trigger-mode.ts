import type { AutomationReadiness, EnrichmentStatus } from "../source-intake/source-enrichment.types.js";
import type { GhlAdapterPlanContext } from "./ghl-delivery-adapter.types.js";

export type WorkflowTriggerMode = "none" | "direct_api" | "tag_trigger";

/** Tag added after opportunity creation; GHL workflow should trigger on "Contact Tag Added". */
export const WORKFLOW_TRIGGER_TAG = "SA360::TRIGGER::NEW_LEAD";

/** Added when configured Voice AI context requirements are satisfied. */
export const WORKFLOW_AI_READY_TAG = "SA360::TRIGGER::AI_READY";

/** Optional: partial survey enrichment — contact delivery still succeeded. */
export const DATA_PARTIAL_TAG = "SA360::DATA::PARTIAL";

/** Optional: unmapped source fields need operator mapping review. */
export const DATA_MAPPING_REVIEW_TAG = "SA360::DATA::MAPPING_REVIEW";

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

export function buildPostDeliveryWorkflowTags(input: {
  automationReadiness: AutomationReadiness;
  enrichmentStatus: EnrichmentStatus;
  hasUnmappedFields: boolean;
}): string[] {
  const tags: string[] = [];
  if (input.enrichmentStatus === "partial" || input.enrichmentStatus === "mapping_required") {
    tags.push(DATA_PARTIAL_TAG);
  }
  if (input.hasUnmappedFields || input.enrichmentStatus === "mapping_required") {
    tags.push(DATA_MAPPING_REVIEW_TAG);
  }
  if (input.automationReadiness === "ready") {
    tags.push(WORKFLOW_AI_READY_TAG);
  }
  return tags;
}
