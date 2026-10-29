/**
 * Pure rules for ongoing GHL activation.
 *
 * Authorization is the saved destination plus the resource ids captured when
 * an admin turned delivery on. Changing the location, workflow, pipeline, or
 * stage makes that authorization stale. These functions do not call GHL.
 */

export type DestinationResourceIds = {
  destinationSubaccountIdGhl?: string | null;
  destinationWorkflowIdGhl?: string | null;
  destinationPipelineIdGhl?: string | null;
  destinationPipelineStageIdGhl?: string | null;
};

export type ActivationArm = DestinationResourceIds & {
  deliveryEnabled: boolean;
  activationLocationIdGhl: string | null;
  activationWorkflowIdGhl: string | null;
  activationPipelineIdGhl: string | null;
  activationStageIdGhl: string | null;
};

export type OngoingActivationClear = {
  deliveryEnabled: false;
  deliveryMode: "shadow";
  clientCutoverApproved: false;
  internalApprovalStatus: "not_reviewed";
  activationLocationIdGhl: null;
  activationWorkflowIdGhl: null;
  activationPipelineIdGhl: null;
  activationStageIdGhl: null;
};

export type ActivationSnapshotFields = {
  destinationSubaccountIdGhl: string;
  destinationWorkflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  opportunityCreationEnabled: boolean;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  activationLocationIdGhl: string | null;
  activationWorkflowIdGhl: string | null;
  activationPipelineIdGhl: string | null;
  activationStageIdGhl: string | null;
  ongoingDeliveryNotBefore: Date | null;
};

const CLEAR: OngoingActivationClear = {
  deliveryEnabled: false,
  deliveryMode: "shadow",
  clientCutoverApproved: false,
  internalApprovalStatus: "not_reviewed",
  activationLocationIdGhl: null,
  activationWorkflowIdGhl: null,
  activationPipelineIdGhl: null,
  activationStageIdGhl: null,
};

function clean(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function nextResource(next: string | null | undefined, current: string | null | undefined): string {
  if (next === undefined) return clean(current);
  return clean(next);
}

/** True when the saved workflow, pipeline, and stage still match activation. */
export function activationSnapshotMatches(destination: ActivationSnapshotFields): boolean {
  if (!destination.ongoingDeliveryNotBefore) return false;
  const location = clean(destination.destinationSubaccountIdGhl);
  if (!location || clean(destination.activationLocationIdGhl) !== location) return false;
  const mode = clean(destination.workflowTriggerMode) || "tag_trigger";
  if (mode !== "none" && clean(destination.activationWorkflowIdGhl) !== clean(destination.destinationWorkflowIdGhl)) {
    return false;
  }
  if (destination.opportunityCreationEnabled) {
    if (clean(destination.activationPipelineIdGhl) !== clean(destination.destinationPipelineIdGhl)) return false;
    if (clean(destination.activationStageIdGhl) !== clean(destination.destinationPipelineStageIdGhl)) return false;
  }
  return true;
}

/**
 * A destination edit invalidates activation when the location, workflow,
 * pipeline, or stage changes on an armed destination. Returns the columns
 * that must be cleared, or null when the edit does not touch activation.
 */
export function ongoingActivationInvalidationPatch(
  current: ActivationArm,
  next: DestinationResourceIds
): OngoingActivationClear | null {
  const armed = current.deliveryEnabled === true || clean(current.activationLocationIdGhl).length > 0;
  if (!armed) return null;
  const location = nextResource(next.destinationSubaccountIdGhl, current.destinationSubaccountIdGhl);
  const workflow = nextResource(next.destinationWorkflowIdGhl, current.destinationWorkflowIdGhl);
  const pipeline = nextResource(next.destinationPipelineIdGhl, current.destinationPipelineIdGhl);
  const stage = nextResource(next.destinationPipelineStageIdGhl, current.destinationPipelineStageIdGhl);
  const changed =
    location !== clean(current.destinationSubaccountIdGhl) ||
    workflow !== clean(current.destinationWorkflowIdGhl) ||
    pipeline !== clean(current.destinationPipelineIdGhl) ||
    stage !== clean(current.destinationPipelineStageIdGhl);
  return changed ? { ...CLEAR } : null;
}

export type DiscoveredResourceCheck =
  | { ok: true }
  | {
      ok: false;
      code: "WORKFLOW_NOT_IN_LOCATION" | "PIPELINE_NOT_IN_LOCATION" | "STAGE_NOT_ON_PIPELINE";
      error: string;
    };

function idList(value: unknown): Array<{ id: string; stages?: unknown }> {
  if (!Array.isArray(value)) return [];
  const rows: Array<{ id: string; stages?: unknown }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) continue;
    rows.push({ id: id.trim(), stages: (item as { stages?: unknown }).stages });
  }
  return rows;
}

/**
 * The saved workflow, pipeline, and stage must appear on the location snapshot.
 * A missing snapshot is the caller's DISCOVERY_REQUIRED case. This function
 * does not fetch one.
 */
export function discoveredResourcesMatchDestination(input: {
  workflowTriggerMode: string | null;
  destinationWorkflowIdGhl: string | null;
  opportunityCreationEnabled: boolean;
  destinationPipelineIdGhl: string | null;
  destinationPipelineStageIdGhl: string | null;
  workflowsJson: unknown;
  pipelinesJson: unknown;
}): DiscoveredResourceCheck {
  const mode = clean(input.workflowTriggerMode) || "tag_trigger";
  if (mode !== "none") {
    const workflowId = clean(input.destinationWorkflowIdGhl);
    const workflows = idList(input.workflowsJson);
    if (!workflows.some((row) => row.id === workflowId)) {
      return {
        ok: false,
        code: "WORKFLOW_NOT_IN_LOCATION",
        error: "The saved workflow was not found on the connected location.",
      };
    }
  }
  if (input.opportunityCreationEnabled) {
    const pipelineId = clean(input.destinationPipelineIdGhl);
    const stageId = clean(input.destinationPipelineStageIdGhl);
    const pipeline = idList(input.pipelinesJson).find((row) => row.id === pipelineId);
    if (!pipeline) {
      return {
        ok: false,
        code: "PIPELINE_NOT_IN_LOCATION",
        error: "The saved pipeline was not found on the connected location.",
      };
    }
    const stages = idList(pipeline.stages);
    if (!stages.some((stage) => stage.id === stageId)) {
      return {
        ok: false,
        code: "STAGE_NOT_ON_PIPELINE",
        error: "The saved stage was not found on the saved pipeline.",
      };
    }
  }
  return { ok: true };
}
