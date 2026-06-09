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
    contactIdGhl: typeof value.contactIdGhl === "string" ? value.contactIdGhl : null,
    partialContactCreated: value.partialContactCreated === true,
  };
}

export function directDemoOutcomeLabel(result: Pick<
  DirectDemoDeliveryViewModel,
  "ok" | "externalCallExecuted" | "liveRunStatus"
>): "success" | "blocked" | "failed" | "partial_failure" {
  if (result.ok) return "success";
  if (result.externalCallExecuted) {
    return result.liveRunStatus === "partial_success" ? "partial_failure" : "failed";
  }
  return "blocked";
}

function normalizeReadiness(value: unknown): DirectDemoDeliveryViewModel["readiness"] {
  if (!isRecord(value)) return null;
  return {
    canDeliverLive: value.canDeliverLive === true,
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
    duplicateRisk: null,
    readiness: null,
    deliveryPlanStatus: null,
    adapterMode: null,
    liveRunStatus: null,
    liveRunFailure: null,
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
    duplicateRisk: normalizeDuplicateRisk(raw.duplicateRisk),
    readiness: normalizeReadiness(raw.readiness),
    deliveryPlanStatus:
      typeof raw.deliveryPlanStatus === "string" ? raw.deliveryPlanStatus : null,
    adapterMode: typeof raw.adapterMode === "string" ? raw.adapterMode : null,
    liveRunStatus: typeof raw.liveRunStatus === "string" ? raw.liveRunStatus : null,
    liveRunFailure: normalizeLiveRunFailure(raw.liveRunFailure),
  };
}
