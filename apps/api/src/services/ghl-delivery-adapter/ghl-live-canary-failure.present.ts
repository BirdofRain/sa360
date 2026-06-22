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
  requestId: string | null;
  responseBody: Record<string, unknown> | null;
  contactIdGhl: string | null;
  partialContactCreated: boolean;
};

/** Internal bookkeeping keys we inject on responseRedactedJson — not part of the GHL response body. */
const INTERNAL_RESPONSE_KEYS = new Set([
  "externalCallExecuted",
  "contactIdGhl",
  "opportunityIdGhl",
  "stampPhase",
  "workflowStarted",
  "workflowTriggerMode",
]);

/** Sanitized GHL response body (already redacted), with internal bookkeeping keys stripped. */
export function sanitizedGhlResponseBody(
  responseRedactedJson: unknown
): Record<string, unknown> | null {
  if (
    !responseRedactedJson ||
    typeof responseRedactedJson !== "object" ||
    Array.isArray(responseRedactedJson)
  ) {
    return null;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(responseRedactedJson as Record<string, unknown>)) {
    if (INTERNAL_RESPONSE_KEYS.has(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Best-effort extraction of a GHL trace/request id from a redacted response (no secrets). */
export function requestIdFromRedactedResponse(responseRedactedJson: unknown): string | null {
  const tryKeys = (record: Record<string, unknown>): string | null => {
    for (const key of ["traceId", "trace_id", "requestId", "request_id", "x-request-id"]) {
      const v = record[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  if (!responseRedactedJson || typeof responseRedactedJson !== "object" || Array.isArray(responseRedactedJson)) {
    return null;
  }
  const record = responseRedactedJson as Record<string, unknown>;
  const direct = tryKeys(record);
  if (direct) return direct;
  for (const nestedKey of ["meta", "headers"]) {
    const nested = record[nestedKey];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const found = tryKeys(nested as Record<string, unknown>);
      if (found) return found;
    }
  }
  return null;
}

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
    (liveRun.status === "partial_success"
      ? null
      : stepRuns.find((s) => s.stepType === "create_or_update_contact"));

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
      requestId: null,
      responseBody: null,
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
    requestId: requestIdFromRedactedResponse(failedStep.responseRedactedJson),
    responseBody: sanitizedGhlResponseBody(failedStep.responseRedactedJson),
    contactIdGhl: liveRun.contactIdGhl,
    partialContactCreated: Boolean(liveRun.contactIdGhl),
  };
}
