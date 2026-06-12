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
  customFieldStampSummary: string | null;
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

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function customFieldStampSummaryFromRequest(req: Record<string, unknown> | null): string | null {
  if (!req) return null;
  const stampPhases =
    req.stampPhases && typeof req.stampPhases === "object" && !Array.isArray(req.stampPhases)
      ? (req.stampPhases as Record<string, unknown>)
      : null;
  const textPhase =
    stampPhases?.text && typeof stampPhases.text === "object" && !Array.isArray(stampPhases.text)
      ? (stampPhases.text as Record<string, unknown>)
      : null;
  const optionPhase =
    stampPhases?.option &&
    typeof stampPhases.option === "object" &&
    !Array.isArray(stampPhases.option)
      ? (stampPhases.option as Record<string, unknown>)
      : null;

  const textFields = readStringList(req.attemptedTextFields ?? textPhase?.attemptedFields);
  const optionFields = readStringList(optionPhase?.attemptedFields);
  const skipped = req.skippedFields;
  const parts: string[] = [];

  if (textFields.length > 0) {
    parts.push(`TEXT stamped: ${textFields.join(", ")}`);
  }
  if (optionFields.length > 0) {
    parts.push(`Option fields stamped: ${optionFields.join(", ")}`);
  }

  if (Array.isArray(skipped) && skipped.length > 0) {
    const skippedLabels = skipped
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const row = item as Record<string, unknown>;
        const key = typeof row.logicalKey === "string" ? row.logicalKey : null;
        const message = typeof row.message === "string" ? row.message : null;
        return key && message ? `${key}: ${message}` : key;
      })
      .filter((v): v is string => Boolean(v));
    const missingMappings = skipped
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return null;
        const row = item as Record<string, unknown>;
        if (row.reason !== "option_mapping_missing") return null;
        return typeof row.logicalKey === "string" ? row.logicalKey : null;
      })
      .filter((v): v is string => Boolean(v));
    if (missingMappings.length > 0) {
      parts.push(`Required option fields missing mapping: ${missingMappings.join(", ")}`);
    }
    if (skippedLabels.length > 0) {
      parts.push(`Skipped: ${skippedLabels.join("; ")}`);
    }
  } else if (textFields.length > 0 || optionFields.length > 0) {
    parts.push("Skipped: none");
  }

  return parts.length > 0 ? parts.join(" — ") : null;
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
        detail:
          s.stepType === "stamp_custom_fields"
            ? customFieldStampSummaryFromRequest(
                s.requestRedactedJson && typeof s.requestRedactedJson === "object" && !Array.isArray(s.requestRedactedJson)
                  ? (s.requestRedactedJson as Record<string, unknown>)
                  : null
              ) ?? s.errorSummary
            : s.errorSummary,
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
        customFieldStampSummary:
          s.stepType === "stamp_custom_fields"
            ? customFieldStampSummaryFromRequest(
                s.requestRedactedJson && typeof s.requestRedactedJson === "object" && !Array.isArray(s.requestRedactedJson)
                  ? (s.requestRedactedJson as Record<string, unknown>)
                  : null
              )
            : null,
      };
    });
}
