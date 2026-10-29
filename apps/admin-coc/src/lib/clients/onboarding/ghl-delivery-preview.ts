/**
 * Operator-facing reading of one persisted GHL adapter simulation.
 * The simulation is the existing delivery-plan adapter. This module does not send.
 */

export type GhlPreviewStep = {
  stepType: string;
  status: string;
  targetId: string | null;
  title: string;
  requestPreviewJson: unknown;
  validationErrors: string[];
  warnings: string[];
};

export type GhlPreviewFieldMapping = {
  coreRequiredMapped: string[];
  coreRequiredMissing: string[];
  optionalMissing: string[];
};

export type GhlDeliveryPreviewFacts = {
  contact: string;
  workflow: string;
  fieldMapping: string;
  omissions: string[];
  opportunity: string;
  persistedSimulation: string;
  ongoingDeliveryChanged: false;
  missingMappings: string[];
  missingSourceValues: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function step(steps: readonly GhlPreviewStep[], stepType: string): GhlPreviewStep | undefined {
  return steps.find((item) => item.stepType === stepType);
}

function joined(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function contactFact(item: GhlPreviewStep | undefined): string {
  if (!item) return "Contact create or update is not in this plan.";
  const path = record(item.requestPreviewJson)?.path;
  const upsert = path === "/contacts/upsert";
  const action = upsert
    ? "Create or update. The plan uses POST /contacts/upsert. This simulation does not choose create versus update, and it does not write a contact."
    : "Create or update is listed, but the request path was not the contact upsert.";
  if (item.validationErrors.length > 0) {
    return `${action} Blocked: ${item.validationErrors.join(" ")}`;
  }
  if (item.warnings.length > 0) return `${action} ${item.warnings.join(" ")}`;
  return action;
}

function workflowLiveNote(triggerMode: string | null): string {
  if (triggerMode === "direct_api") return " Live execution enrolls this workflow id.";
  if (triggerMode === "tag_trigger") {
    return " Live execution uses tag trigger and does not call this workflow id.";
  }
  if (triggerMode === "none") return " Live execution does not start a workflow because trigger mode is none.";
  return "";
}

function workflowFact(
  item: GhlPreviewStep | undefined,
  workflowId: string | null,
  workflowName: string | null,
  triggerMode: string | null
): string {
  const requested = record(item?.requestPreviewJson)?.workflowId;
  const id = typeof requested === "string" && requested.trim() ? requested.trim() : workflowId;
  if (!item) return `Workflow enrollment is not in this plan.${workflowLiveNote(triggerMode)}`;
  if (!id) {
    const blocked = item.validationErrors.length > 0 ? ` ${item.validationErrors.join(" ")}` : "";
    return `Workflow enrollment is blocked. No workflow id is on this plan.${blocked}`;
  }
  const name = workflowName ? ` (${workflowName})` : "";
  const live = workflowLiveNote(triggerMode);
  if (item.status === "failed_validation" || item.validationErrors.length > 0) {
    return `Workflow enrollment for ${id}${name} is blocked. ${item.validationErrors.join(" ")}`.trim();
  }
  return `Workflow enrollment is included for ${id}${name}. The workflow name is not required to be Select Time Zone. No workflow was started.${live}`;
}

function mappingFact(
  item: GhlPreviewStep | undefined,
  fieldMapping: GhlPreviewFieldMapping | null
): { summary: string; omissions: string[]; missingMappings: string[]; missingSourceValues: string[] } {
  const missingMappings = [
    ...(fieldMapping?.coreRequiredMissing ?? []),
    ...(fieldMapping?.optionalMissing ?? []),
  ];
  const missingSourceValues: string[] = [];
  const customFields = record(record(item?.requestPreviewJson)?.customFields);
  if (customFields) {
    for (const [key, value] of Object.entries(customFields)) {
      if (value === null || value === "") missingSourceValues.push(key);
    }
  }
  const mapped = fieldMapping?.coreRequiredMapped ?? [];
  if (!fieldMapping && !customFields) {
    return {
      summary: "Field mapping was not returned with this simulation.",
      omissions: [],
      missingMappings: [],
      missingSourceValues: [],
    };
  }
  return {
    summary: `Mapped core fields: ${joined(mapped)}. Missing mappings: ${joined(missingMappings)}. Missing source values: ${joined(missingSourceValues)}. Omitted fields are not sent.`,
    omissions: [...missingMappings, ...missingSourceValues],
    missingMappings,
    missingSourceValues,
  };
}

function opportunityFact(item: GhlPreviewStep | undefined, opportunityCreationEnabled: boolean | null): string {
  if (opportunityCreationEnabled === false) {
    return "Opportunity effect: creation is off on this destination. No opportunity will be created or updated.";
  }
  if (!item) return "Opportunity effect: this plan has no opportunity step.";
  if (item.status === "failed_validation" || item.validationErrors.length > 0) {
    return `Opportunity effect: create or update is blocked. ${item.validationErrors.join(" ")}`.trim();
  }
  if (item.status === "skipped") return "Opportunity effect: skipped. No opportunity was written.";
  return "Opportunity effect: create or update is included. No opportunity was written by this simulation.";
}

export function describeGhlDeliveryPreview(input: {
  steps: readonly GhlPreviewStep[];
  fieldMapping?: GhlPreviewFieldMapping | null;
  workflowId?: string | null;
  workflowName?: string | null;
  workflowTriggerMode?: string | null;
  opportunityCreationEnabled?: boolean | null;
  adapterRunId: string | null;
}): GhlDeliveryPreviewFacts {
  const mapping = mappingFact(step(input.steps, "stamp_custom_fields"), input.fieldMapping ?? null);
  return {
    contact: contactFact(step(input.steps, "create_or_update_contact")),
    workflow: workflowFact(
      step(input.steps, "start_workflow"),
      input.workflowId ?? null,
      input.workflowName ?? null,
      input.workflowTriggerMode ?? null
    ),
    fieldMapping: mapping.summary,
    omissions: mapping.omissions,
    missingMappings: mapping.missingMappings,
    missingSourceValues: mapping.missingSourceValues,
    opportunity: opportunityFact(step(input.steps, "create_or_update_opportunity"), input.opportunityCreationEnabled ?? null),
    persistedSimulation: input.adapterRunId
      ? `Persisted simulation ${input.adapterRunId}. No GHL write was made.`
      : "This preview was not stored.",
    ongoingDeliveryChanged: false,
  };
}
