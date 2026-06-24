import type { LiveCanaryStepSummary } from "../ghl-delivery-adapter/ghl-live-canary-steps.present.js";

export type BulkImportLiveDeliverySnapshot = {
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  destinationLocationIdGhl: string | null;
  contactAction: "created" | "updated" | null;
  contactDisplayName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  ownerId: string | null;
  ownerName: string | null;
  tagsAdded: string[];
  fieldsStampedSummary: string | null;
  workflowTriggerStrategy: string | null;
  workflowTriggerNote: string | null;
  liveRunId: string | null;
  adapterStatus: string | null;
  deliveredAt: string | null;
  adapterDetailsRedacted: Record<string, unknown> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTagsFromStep(step: LiveCanaryStepSummary): string[] {
  const detail = step.detail?.trim();
  if (!detail) return [];
  if (detail.startsWith("[")) {
    try {
      const parsed = JSON.parse(detail) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((t) => String(t)).filter(Boolean);
      }
    } catch {
      // fall through
    }
  }
  return detail
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function parseBulkImportLiveDeliverySnapshot(
  deliveryResultJson: unknown,
  workflowStrategy: string | null,
  deliveredAt?: Date | null
): BulkImportLiveDeliverySnapshot | null {
  const raw = asRecord(deliveryResultJson);
  if (!raw) return null;

  const stepSummary = Array.isArray(raw.liveRunStepSummary)
    ? (raw.liveRunStepSummary as LiveCanaryStepSummary[])
    : [];

  const contactStep = stepSummary.find((s) => s.stepType === "create_or_update_contact");
  const ownerStep = stepSummary.find((s) => s.stepType === "assign_owner");
  const tagStep = stepSummary.find((s) => s.stepType === "add_tags");
  const workflowStep = stepSummary.find((s) => s.stepType === "start_workflow");
  const opportunityStep = stepSummary.find((s) => s.stepType === "create_opportunity");

  const contactAction =
    contactStep?.status === "succeeded"
      ? contactStep.detail?.toLowerCase().includes("updated")
        ? "updated"
        : "created"
      : null;

  const tagsAdded = tagStep?.status === "succeeded" ? parseTagsFromStep(tagStep) : [];

  const fieldsStampedSummary =
    contactStep?.customFieldStampSummary?.trim() ||
    opportunityStep?.customFieldStampSummary?.trim() ||
    null;

  const workflowTriggerNote =
    workflowStrategy === "source_tag_only"
      ? "No NEW_LEAD or AI_READY trigger tag was added."
      : workflowStep?.status === "skipped"
        ? workflowStep.detail
        : null;

  const adapterStatus =
    pickString(raw.liveRunStatus) ??
    (raw.ok === true ? "succeeded" : typeof raw.ok === "boolean" ? "failed" : null);

  const adapterDetailsRedacted: Record<string, unknown> = {};
  for (const key of [
    "summary",
    "liveRunStatus",
    "liveRunFailure",
    "deliveryPlanId",
    "adapterRunId",
    "matchedRuleId",
    "externalCallExecuted",
    "mode",
  ] as const) {
    if (key in raw && raw[key] !== undefined && raw[key] !== null) {
      adapterDetailsRedacted[key] = raw[key];
    }
  }
  if (stepSummary.length > 0) {
    adapterDetailsRedacted.liveRunStepSummary = stepSummary.map((step) => ({
      stepType: step.stepType,
      label: step.label,
      status: step.status,
      detail: step.detail,
      httpStatus: step.httpStatus,
      externalId: step.externalId,
      customFieldStampSummary: step.customFieldStampSummary,
    }));
  }

  return {
    ghlContactId: pickString(raw.contactIdGhl),
    ghlOpportunityId: pickString(raw.opportunityIdGhl),
    destinationLocationIdGhl: pickString(raw.destinationSubaccountIdGhl),
    contactAction,
    contactDisplayName: pickString(raw.contactDisplayName) ?? contactStep?.label ?? null,
    contactEmail: pickString(raw.contactEmail),
    contactPhone: pickString(raw.contactPhone),
    ownerId: ownerStep?.configuredOwnerId ?? null,
    ownerName: ownerStep?.detail ?? null,
    tagsAdded,
    fieldsStampedSummary,
    workflowTriggerStrategy: workflowStrategy,
    workflowTriggerNote,
    liveRunId: pickString(raw.liveRunId),
    adapterStatus,
    deliveredAt: deliveredAt ? deliveredAt.toISOString() : null,
    adapterDetailsRedacted: Object.keys(adapterDetailsRedacted).length > 0 ? adapterDetailsRedacted : null,
  };
}
