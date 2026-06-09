import type { GhlLiveDeliveryRunItem } from "./ghl-live-canary.present.js";

export type LiveCanaryOpportunityBodyPreview = {
  locationId: string | null;
  pipelineId: string | null;
  pipelineStageId: string | null;
  contactId: string | null;
  namePresent: boolean;
  statusPresent: boolean;
  name: string | null;
  status: string | null;
};

export type LiveCanaryStepSummary = {
  stepType: string;
  label: string;
  status: string;
  detail: string | null;
  httpStatus: number | null;
  httpMethod: string | null;
  httpPath: string | null;
  errorMessage: string | null;
  externalId: string | null;
  requestBodyKeys: string[];
  requestBodyPreview: LiveCanaryOpportunityBodyPreview | null;
  configuredOwnerId: string | null;
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

function requestMetaFromStep(step: {
  requestRedactedJson: unknown;
}): {
  httpMethod: string | null;
  httpPath: string | null;
  requestBodyKeys: string[];
  body: Record<string, unknown> | null;
} {
  const req = step.requestRedactedJson;
  if (!req || typeof req !== "object" || Array.isArray(req)) {
    return { httpMethod: null, httpPath: null, requestBodyKeys: [], body: null };
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
  const body =
    record.body && typeof record.body === "object" && !Array.isArray(record.body)
      ? (record.body as Record<string, unknown>)
      : null;
  return {
    httpMethod: method,
    httpPath: path,
    requestBodyKeys: body ? Object.keys(body) : [],
    body,
  };
}

function opportunityBodyPreview(body: Record<string, unknown> | null): LiveCanaryOpportunityBodyPreview | null {
  if (!body) return null;
  const name = typeof body.name === "string" ? body.name : null;
  const status = typeof body.status === "string" ? body.status : null;
  return {
    locationId: typeof body.locationId === "string" ? body.locationId : null,
    pipelineId: typeof body.pipelineId === "string" ? body.pipelineId : null,
    pipelineStageId: typeof body.pipelineStageId === "string" ? body.pipelineStageId : null,
    contactId: typeof body.contactId === "string" ? body.contactId : null,
    namePresent: Boolean(name?.trim()),
    statusPresent: Boolean(status?.trim()),
    name,
    status,
  };
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
    .map((s) => {
      const meta = requestMetaFromStep(s);
      const configuredOwnerId =
        s.stepType === "assign_owner" && meta.body && typeof meta.body.assignedTo === "string"
          ? meta.body.assignedTo
          : s.stepType === "assign_owner" && s.targetId
            ? s.targetId
            : null;
      return {
        stepType: s.stepType,
        label: stepLabel(s.stepType),
        status: s.status,
        detail: s.errorSummary,
        httpStatus: httpStatusFromErrorCode(s.errorCode),
        httpMethod: meta.httpMethod,
        httpPath: meta.httpPath,
        errorMessage: s.errorSummary,
        externalId: s.externalId,
        requestBodyKeys: meta.requestBodyKeys,
        requestBodyPreview:
          s.stepType === "create_or_update_opportunity"
            ? opportunityBodyPreview(meta.body)
            : null,
        configuredOwnerId,
      };
    });
}
