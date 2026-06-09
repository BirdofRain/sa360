import type { GhlLiveDeliveryRunItem, GhlLiveDeliveryStepRunItem } from "./ghl-live-canary.present.js";

export type LiveCanaryFailureSummary = {
  failedStepType: string;
  failedStepLabel: string;
  httpMethod: string | null;
  httpPath: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string;
  requestBodyKeys: string[];
  contactIdGhl: string | null;
  partialContactCreated: boolean;
};

const STEP_LABELS: Record<string, string> = {
  create_or_update_contact: "Create or update GHL contact",
  stamp_custom_fields: "Stamp SA360 custom fields",
  add_tags: "Add GHL tags",
  create_or_update_opportunity: "Create GHL opportunity",
  assign_owner: "Assign GHL owner",
  start_workflow: "Start GHL workflow",
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

function requestMetaFromStep(step: GhlLiveDeliveryStepRunItem): {
  httpMethod: string | null;
  httpPath: string | null;
  requestBodyKeys: string[];
} {
  const req = step.requestRedactedJson;
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return { httpMethod: null, httpPath: null, requestBodyKeys: [] };
  }
  const record = req as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : null;
  let path: string | null = null;
  if (typeof record.url === "string") {
    try {
      path = new URL(record.url).pathname;
    } catch {
      path = record.url;
    }
  }
  const body = record.body;
  const requestBodyKeys =
    body && typeof body === "object" && !Array.isArray(body)
      ? Object.keys(body as Record<string, unknown>)
      : [];
  return { httpMethod: method, httpPath: path, requestBodyKeys };
}

export function summarizeLiveCanaryFailureFromRun(
  liveRun: GhlLiveDeliveryRunItem | null | undefined
): LiveCanaryFailureSummary | null {
  if (!liveRun) return null;
  if (liveRun.status === "succeeded") return null;

  const stepRuns = Array.isArray(liveRun.stepRuns) ? liveRun.stepRuns : [];
  const failedStep =
    stepRuns.find((s) => s.status === "failed") ??
    stepRuns.find((s) => s.stepType === "create_or_update_contact");

  if (!failedStep) {
    const message = liveRun.errors[0] ?? liveRun.summary ?? "Live canary failed.";
    return {
      failedStepType: "unknown",
      failedStepLabel: "Live canary",
      httpMethod: null,
      httpPath: null,
      httpStatus: null,
      errorCode: null,
      errorMessage: message,
      requestBodyKeys: [],
      contactIdGhl: liveRun.contactIdGhl,
      partialContactCreated: Boolean(liveRun.contactIdGhl),
    };
  }

  const meta = requestMetaFromStep(failedStep);
  const errorMessage =
    failedStep.errorSummary?.trim() ||
    liveRun.errors[0]?.trim() ||
    liveRun.summary?.trim() ||
    "Live canary step failed.";

  return {
    failedStepType: failedStep.stepType,
    failedStepLabel: stepLabel(failedStep.stepType),
    httpMethod: meta.httpMethod,
    httpPath: meta.httpPath,
    httpStatus: httpStatusFromErrorCode(failedStep.errorCode),
    errorCode: failedStep.errorCode,
    errorMessage,
    requestBodyKeys: meta.requestBodyKeys,
    contactIdGhl: liveRun.contactIdGhl,
    partialContactCreated: Boolean(liveRun.contactIdGhl),
  };
}
