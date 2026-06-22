import type { DirectDemoDeliveryMode, DirectDemoDeliveryViewModel } from "./types.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Coerce API / network payloads into safe strings for JSX. */
export function displayText(value: unknown, fallback = "—"): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Error) return value.message || fallback;
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/** String list safe for `.map()` in JSX — drops non-strings and nested objects. */
export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item == null) return "";
      if (typeof item === "number" || typeof item === "boolean") return String(item);
      return "";
    })
    .filter((s) => s.length > 0);
}

function normalizeMode(value: unknown): DirectDemoDeliveryMode {
  return value === "live_canary" ? "live_canary" : "simulate";
}

function normalizeDuplicateRisk(
  value: unknown
): DirectDemoDeliveryViewModel["duplicateRisk"] {
  if (!isRecord(value)) return null;
  const riskLevel = displayText(value.riskLevel, "");
  if (!riskLevel) return null;
  return {
    riskLevel,
    blocksLiveDelivery: value.blocksLiveDelivery === true,
    recommendedAction:
      typeof value.recommendedAction === "string" ? value.recommendedAction : null,
  };
}

function normalizeLiveRunFailure(
  value: unknown
): DirectDemoDeliveryViewModel["liveRunFailure"] {
  if (!isRecord(value)) return null;
  const failedStepType = displayText(value.failedStepType, "");
  if (!failedStepType) return null;
  return {
    failedStepType,
    failedStepLabel: displayText(value.failedStepLabel, failedStepType),
    httpMethod: typeof value.httpMethod === "string" ? value.httpMethod : null,
    httpPath: typeof value.httpPath === "string" ? value.httpPath : null,
    httpStatus: typeof value.httpStatus === "number" ? value.httpStatus : null,
    errorCode: typeof value.errorCode === "string" ? value.errorCode : null,
    errorMessage: displayText(value.errorMessage, "Live canary step failed."),
    requestBodyKeys: stringList(value.requestBodyKeys),
    requestId: typeof value.requestId === "string" ? value.requestId : null,
    responseBody: isRecord(value.responseBody) ? value.responseBody : null,
    contactIdGhl: typeof value.contactIdGhl === "string" ? value.contactIdGhl : null,
    partialContactCreated: value.partialContactCreated === true,
  };
}

export type DirectDemoDeliveryTierSummary = {
  requiredDelivery: "succeeded" | "failed" | "unknown";
  optionalEnrichment: "ok" | "needs_config" | "unknown";
};

function optionalEnrichmentStatus(
  liveRunStepSummary: DirectDemoDeliveryViewModel["liveRunStepSummary"]
): DirectDemoDeliveryTierSummary["optionalEnrichment"] {
  const optionalTypes = ["stamp_custom_fields", "assign_owner", "start_workflow"];
  const optionalNeedsConfig = liveRunStepSummary.some(
    (s) =>
      optionalTypes.includes(s.stepType) &&
      (s.status === "optional_failed" ||
        s.status === "skipped" ||
        s.status === "failed" ||
        s.status === "partial_success")
  );
  return optionalNeedsConfig ? "needs_config" : "ok";
}

function requiredDeliveryStatus(
  liveRunStepSummary: DirectDemoDeliveryViewModel["liveRunStepSummary"]
): DirectDemoDeliveryTierSummary["requiredDelivery"] {
  const step = (type: string) =>
    liveRunStepSummary.find((s) => s.stepType === type)?.status;
  const contactOk = step("create_or_update_contact") === "succeeded";
  const tagsOk = step("add_tags") === "succeeded";
  const oppStep = liveRunStepSummary.find(
    (s) => s.stepType === "create_or_update_opportunity"
  );
  const oppOk = !oppStep || oppStep.status === "succeeded";
  return contactOk && tagsOk && oppOk ? "succeeded" : "failed";
}

export function directDemoDeliveryTierSummary(
  result: Pick<DirectDemoDeliveryViewModel, "liveRunStatus" | "liveRunStepSummary">
): DirectDemoDeliveryTierSummary | null {
  if (result.liveRunStatus === "succeeded") {
    return {
      requiredDelivery: "succeeded",
      optionalEnrichment:
        optionalEnrichmentStatus(result.liveRunStepSummary) === "needs_config"
          ? "needs_config"
          : "ok",
    };
  }
  if (result.liveRunStatus !== "partial_success") return null;
  return {
    requiredDelivery: requiredDeliveryStatus(result.liveRunStepSummary),
    optionalEnrichment: optionalEnrichmentStatus(result.liveRunStepSummary),
  };
}

export type LiveCanaryDeliveryStepLine = {
  label: string;
  status: string;
};

export function liveCanarySuccessDeliveryLines(
  result: Pick<DirectDemoDeliveryViewModel, "liveRunStatus" | "liveRunStepSummary">
): LiveCanaryDeliveryStepLine[] | null {
  if (result.liveRunStatus !== "succeeded") return null;
  const step = (type: string) =>
    result.liveRunStepSummary.find((s) => s.stepType === type);
  const owner = step("assign_owner");
  const ownerStatus =
    owner?.status === "succeeded"
      ? "assigned"
      : owner?.status === "skipped"
        ? "skipped"
        : owner?.status ?? "—";
  return [
    { label: "Contact created", status: step("create_or_update_contact")?.status ?? "—" },
    { label: "Custom fields stamped", status: step("stamp_custom_fields")?.status ?? "—" },
    { label: "Tags added", status: step("add_tags")?.status ?? "—" },
    { label: "Opportunity created", status: step("create_or_update_opportunity")?.status ?? "—" },
    { label: "Owner assigned/skipped", status: ownerStatus },
    {
      label: "Workflow trigger tag added",
      status: step("start_workflow")?.status ?? "—",
    },
  ];
}

function normalizeSourceLane(value: unknown): DirectDemoDeliveryViewModel["sourceLane"] {
  if (value === "meta_lead_ads") return "meta_lead_ads";
  if (value === "leadcapture_io") return "leadcapture_io";
  if (value === "manual_direct_demo") return "manual_direct_demo";
  if (value === "unknown") return "unknown";
  return null;
}

export function directDemoOutcomeLabel(result: Pick<
  DirectDemoDeliveryViewModel,
  "ok" | "externalCallExecuted" | "liveRunStatus"
>): "success" | "blocked" | "failed" | "partial_success" {
  if (result.ok && result.liveRunStatus === "succeeded") return "success";
  if (result.liveRunStatus === "partial_success") return "partial_success";
  if (result.ok) return "success";
  if (result.externalCallExecuted) return "failed";
  return "blocked";
}

function normalizeLiveRunStepSummary(value: unknown): DirectDemoDeliveryViewModel["liveRunStepSummary"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const stepType = displayText(item.stepType, "");
      if (!stepType) return null;
      const previewRaw = item.requestBodyPreview;
      const preview =
        isRecord(previewRaw) && previewRaw !== null
          ? {
              locationId: typeof previewRaw.locationId === "string" ? previewRaw.locationId : null,
              pipelineId: typeof previewRaw.pipelineId === "string" ? previewRaw.pipelineId : null,
              pipelineStageId:
                typeof previewRaw.pipelineStageId === "string" ? previewRaw.pipelineStageId : null,
              contactId: typeof previewRaw.contactId === "string" ? previewRaw.contactId : null,
              namePresent: previewRaw.namePresent === true,
              statusPresent: previewRaw.statusPresent === true,
              name: typeof previewRaw.name === "string" ? previewRaw.name : null,
              status: typeof previewRaw.status === "string" ? previewRaw.status : null,
            }
          : null;
      return {
        stepType,
        label: displayText(item.label, stepType),
        status: displayText(item.status, "unknown"),
        detail: typeof item.detail === "string" ? item.detail : null,
        httpStatus: typeof item.httpStatus === "number" ? item.httpStatus : null,
        httpMethod: typeof item.httpMethod === "string" ? item.httpMethod : null,
        httpPath: typeof item.httpPath === "string" ? item.httpPath : null,
        errorMessage: typeof item.errorMessage === "string" ? item.errorMessage : null,
        externalId: typeof item.externalId === "string" ? item.externalId : null,
        requestBodyKeys: stringList(item.requestBodyKeys),
        requestBodyPreview: preview,
        configuredOwnerId:
          typeof item.configuredOwnerId === "string" ? item.configuredOwnerId : null,
        customFieldStampSummary:
          typeof item.customFieldStampSummary === "string" ? item.customFieldStampSummary : null,
        requestId: typeof item.requestId === "string" ? item.requestId : null,
        responseBody: isRecord(item.responseBody) ? item.responseBody : null,
        externalCallExecuted: item.externalCallExecuted === true,
      };
    })
    .filter((s): s is NonNullable<typeof s> => Boolean(s));
}

function normalizeApiBuildVersion(
  value: unknown
): DirectDemoDeliveryViewModel["apiBuildVersion"] {
  if (!isRecord(value)) return null;
  return {
    commitSha: typeof value.commitSha === "string" ? value.commitSha : null,
    commitShort: typeof value.commitShort === "string" ? value.commitShort : null,
    buildLabel: typeof value.buildLabel === "string" ? value.buildLabel : null,
    buildSource: typeof value.buildSource === "string" ? value.buildSource : null,
  };
}

function normalizeMatchedRuleSummary(
  value: unknown
): DirectDemoDeliveryViewModel["matchedRuleSummary"] {
  if (!isRecord(value)) return null;
  const id = displayText(value.id, "");
  if (!id) return null;
  return {
    id,
    matchType: displayText(value.matchType, "unknown"),
    matchValue: typeof value.matchValue === "string" ? value.matchValue : null,
    clientAccountId: displayText(value.clientAccountId, ""),
    destinationSubaccountIdGhl: displayText(value.destinationSubaccountIdGhl, ""),
  };
}

function normalizeReadiness(value: unknown): DirectDemoDeliveryViewModel["readiness"] {
  if (!isRecord(value)) return null;
  return {
    canDeliverLive: value.canDeliverLive === true,
    readyForDirectCanary: value.readyForDirectCanary === true,
    blockers: stringList(value.blockers),
  };
}

export function createEmptyDirectDemoView(
  message: string,
  mode: DirectDemoDeliveryMode = "simulate"
): DirectDemoDeliveryViewModel {
  return {
    ok: false,
    mode,
    matched: false,
    destinationClientAccountId: null,
    destinationSubaccountIdGhl: null,
    routingDryRunDecisionId: null,
    deliveryPlanId: null,
    adapterRunId: null,
    liveRunId: null,
    externalCallExecuted: false,
    summary: null,
    reason: message,
    blockers: [],
    warnings: [],
    nextAction: null,
    matchedRuleId: null,
    matchedRuleSummary: null,
    fieldMappingSource: null,
    duplicateRisk: null,
    readiness: null,
    planType: null,
    planPath: null,
    missingConfigFields: [],
    deliveryPlanStatus: null,
    adapterMode: null,
    liveRunStatus: null,
    liveRunFailure: null,
    liveRunStepSummary: [],
    contactIdGhl: null,
    opportunityIdGhl: null,
    apiBuildVersion: null,
    adminBuildCommitShort:
      process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT?.trim() || null,
    sourceLane: null,
    sourceLaneLabel: null,
  };
}

/** Defensive normalizer — never throws; safe for client render + server action return. */
export function normalizeDirectDemoResult(
  raw: unknown,
  fallbackMode: DirectDemoDeliveryMode = "simulate"
): DirectDemoDeliveryViewModel {
  if (!isRecord(raw)) {
    return createEmptyDirectDemoView("Unexpected empty response from server.", fallbackMode);
  }

  return {
    ok: raw.ok === true,
    mode: normalizeMode(raw.mode ?? fallbackMode),
    matched: raw.matched === true,
    destinationClientAccountId:
      typeof raw.destinationClientAccountId === "string"
        ? raw.destinationClientAccountId
        : raw.destinationClientAccountId == null
          ? null
          : displayText(raw.destinationClientAccountId),
    destinationSubaccountIdGhl:
      typeof raw.destinationSubaccountIdGhl === "string"
        ? raw.destinationSubaccountIdGhl
        : raw.destinationSubaccountIdGhl == null
          ? null
          : displayText(raw.destinationSubaccountIdGhl),
    routingDryRunDecisionId:
      typeof raw.routingDryRunDecisionId === "string" ? raw.routingDryRunDecisionId : null,
    deliveryPlanId: typeof raw.deliveryPlanId === "string" ? raw.deliveryPlanId : null,
    adapterRunId: typeof raw.adapterRunId === "string" ? raw.adapterRunId : null,
    liveRunId: typeof raw.liveRunId === "string" ? raw.liveRunId : null,
    externalCallExecuted: raw.externalCallExecuted === true,
    summary: typeof raw.summary === "string" ? raw.summary : null,
    reason: typeof raw.reason === "string" ? raw.reason : typeof raw.error === "string" ? raw.error : null,
    blockers: stringList(raw.blockers),
    warnings: stringList(raw.warnings),
    nextAction: typeof raw.nextAction === "string" ? raw.nextAction : null,
    matchedRuleId: typeof raw.matchedRuleId === "string" ? raw.matchedRuleId : null,
    matchedRuleSummary: normalizeMatchedRuleSummary(raw.matchedRuleSummary),
    fieldMappingSource:
      typeof raw.fieldMappingSource === "string" ? raw.fieldMappingSource : null,
    duplicateRisk: normalizeDuplicateRisk(raw.duplicateRisk),
    readiness: normalizeReadiness(raw.readiness),
    planType: typeof raw.planType === "string" ? raw.planType : null,
    planPath: typeof raw.planPath === "string" ? raw.planPath : null,
    missingConfigFields: stringList(raw.missingConfigFields),
    deliveryPlanStatus:
      typeof raw.deliveryPlanStatus === "string" ? raw.deliveryPlanStatus : null,
    adapterMode: typeof raw.adapterMode === "string" ? raw.adapterMode : null,
    liveRunStatus: typeof raw.liveRunStatus === "string" ? raw.liveRunStatus : null,
    liveRunFailure: normalizeLiveRunFailure(raw.liveRunFailure),
    liveRunStepSummary: normalizeLiveRunStepSummary(raw.liveRunStepSummary),
    contactIdGhl:
      typeof raw.contactIdGhl === "string"
        ? raw.contactIdGhl
        : typeof raw.liveRunFailure === "object" &&
            raw.liveRunFailure &&
            typeof (raw.liveRunFailure as Record<string, unknown>).contactIdGhl === "string"
          ? ((raw.liveRunFailure as Record<string, unknown>).contactIdGhl as string)
          : null,
    opportunityIdGhl: typeof raw.opportunityIdGhl === "string" ? raw.opportunityIdGhl : null,
    apiBuildVersion: normalizeApiBuildVersion(raw.apiBuildVersion),
    adminBuildCommitShort:
      process.env.NEXT_PUBLIC_SA360_BUILD_COMMIT_SHORT?.trim() || null,
    sourceLane: normalizeSourceLane(raw.sourceLane),
    sourceLaneLabel:
      typeof raw.sourceLaneLabel === "string" ? raw.sourceLaneLabel.trim() || null : null,
  };
}
