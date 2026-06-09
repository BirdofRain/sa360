import type { GhlLiveDeliveryRunItem } from "./ghl-live-canary.present.js";

export type LiveCanaryStepSummary = {
  stepType: string;
  label: string;
  status: string;
  detail: string | null;
  httpStatus: number | null;
  errorMessage: string | null;
  externalId: string | null;
};

const STEP_LABELS: Record<string, string> = {
  create_or_update_contact: "Contact created",
  stamp_custom_fields: "Custom fields",
  add_tags: "Tags",
  create_or_update_opportunity: "Opportunity",
  assign_owner: "Owner assignment",
  start_workflow: "Workflow",
};

function stepLabel(stepType: string): string {
  return STEP_LABELS[stepType] ?? stepType;
}

function httpStatusFromErrorCode(errorCode: string | null): number | null {
  if (!errorCode) return null;
  const m = /^http_(\d+)$/.exec(errorCode);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export function summarizeLiveCanaryStepsFromRun(
  liveRun: GhlLiveDeliveryRunItem | null | undefined
): LiveCanaryStepSummary[] {
  if (!liveRun) return [];
  const stepRuns = Array.isArray(liveRun.stepRuns) ? liveRun.stepRuns : [];
  const focus = [
    "create_or_update_contact",
    "stamp_custom_fields",
    "add_tags",
    "create_or_update_opportunity",
    "assign_owner",
    "start_workflow",
  ];
  return focus
    .map((stepType) => stepRuns.find((s) => s.stepType === stepType))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({
      stepType: s.stepType,
      label: stepLabel(s.stepType),
      status: s.status,
      detail: s.errorSummary,
      httpStatus: httpStatusFromErrorCode(s.errorCode),
      errorMessage: s.errorSummary,
      externalId: s.externalId,
    }));
}
