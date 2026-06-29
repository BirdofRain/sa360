/** Must match API `LIVE_CANARY_CONFIRMATION_TEXT`. */
export const DIRECT_DEMO_LIVE_CONFIRMATION_TEXT = "DELIVER ONE LEAD";

// Active SA360 Demo destination used by the Direct Delivery Demo fallback payload and the
// live-canary guard. Matches the destination used by current Google Sheet routing / delivery-plan
// testing. The legacy `smart_agent_360_demo` is not used here unless selected from a routing decision.
export const DIRECT_DEMO_CLIENT_ACCOUNT_ID = "smart_agent_360_demo_2";
export const DIRECT_DEMO_LOCATION_ID = "VPuMIhN6JpxdoXvvlekZ";

export type DirectDemoDeliveryMode = "simulate" | "live_canary";

/** Raw API shape (may include extra nested fields). */
export type DirectDemoDeliveryResponse = {
  ok: boolean;
  mode: DirectDemoDeliveryMode;
  matched?: boolean;
  destinationClientAccountId?: string | null;
  destinationSubaccountIdGhl?: string | null;
  routingDryRunDecisionId?: string | null;
  deliveryPlanId?: string | null;
  adapterRunId?: string | null;
  liveRunId?: string | null;
  externalCallExecuted?: boolean;
  summary?: string;
  error?: string;
  reason?: string;
  blockers?: string[];
  warnings?: string[];
  nextAction?: string;
  matchedRuleId?: string | null;
  matchedRuleSummary?: {
    id: string;
    matchType: string;
    matchValue: string | null;
    clientAccountId: string;
    destinationSubaccountIdGhl: string;
  } | null;
  fieldMappingSource?: string | null;
  duplicateRisk?: {
    riskLevel: string;
    blocksLiveDelivery: boolean;
    recommendedAction: string | null;
  } | null;
  readiness?: {
    canDeliverLive: boolean;
    readyForDirectCanary?: boolean;
    blockers: string[];
  } | null;
  planType?: string | null;
  planPath?: string | null;
  missingConfigFields?: string[];
  deliveryPlanStatus?: string;
  adapterMode?: string;
  liveRunStatus?: string | null;
  liveRunFailure?: {
    failedStepType: string;
    failedStepLabel: string;
    httpMethod: string | null;
    httpPath: string | null;
    httpStatus: number | null;
    errorCode: string | null;
    errorMessage: string;
    requestBodyKeys: string[];
    requestId?: string | null;
    responseBody?: Record<string, unknown> | null;
    contactIdGhl: string | null;
    partialContactCreated: boolean;
  } | null;
  liveRunStepSummary?: DirectDemoLiveRunStepSummary[];
  contactIdGhl?: string | null;
  opportunityIdGhl?: string | null;
  apiBuildVersion?: {
    commitSha?: string | null;
    commitShort?: string | null;
    buildLabel?: string | null;
    buildSource?: string | null;
  } | null;
  sourceLane?: string | null;
  sourceLaneLabel?: string | null;
};

export type DirectDemoSourceLane = "meta_lead_ads" | "leadcapture_io" | "manual_direct_demo" | "unknown";

export type DirectDemoLiveRunStepSummary = {
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
  requestBodyPreview: {
    locationId: string | null;
    pipelineId: string | null;
    pipelineStageId: string | null;
    contactId: string | null;
    namePresent: boolean;
    statusPresent: boolean;
    name: string | null;
    status: string | null;
  } | null;
  configuredOwnerId: string | null;
  customFieldStampSummary: string | null;
  requestId: string | null;
  responseBody: Record<string, unknown> | null;
  externalCallExecuted: boolean;
};

/** Normalized client-safe view — all list fields are string[]. */
export type DirectDemoDeliveryViewModel = {
  ok: boolean;
  mode: DirectDemoDeliveryMode;
  matched: boolean;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  routingDryRunDecisionId: string | null;
  deliveryPlanId: string | null;
  adapterRunId: string | null;
  liveRunId: string | null;
  externalCallExecuted: boolean;
  summary: string | null;
  reason: string | null;
  blockers: string[];
  warnings: string[];
  nextAction: string | null;
  matchedRuleId: string | null;
  matchedRuleSummary: {
    id: string;
    matchType: string;
    matchValue: string | null;
    clientAccountId: string;
    destinationSubaccountIdGhl: string;
  } | null;
  fieldMappingSource: string | null;
  duplicateRisk: {
    riskLevel: string;
    blocksLiveDelivery: boolean;
    recommendedAction: string | null;
  } | null;
  readiness: {
    canDeliverLive: boolean;
    readyForDirectCanary: boolean;
    blockers: string[];
  } | null;
  planType: string | null;
  planPath: string | null;
  missingConfigFields: string[];
  deliveryPlanStatus: string | null;
  adapterMode: string | null;
  liveRunStatus: string | null;
  liveRunFailure: {
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
  } | null;
  liveRunStepSummary: DirectDemoLiveRunStepSummary[];
  contactIdGhl: string | null;
  opportunityIdGhl: string | null;
  apiBuildVersion: {
    commitSha: string | null;
    commitShort: string | null;
    buildLabel: string | null;
    buildSource: string | null;
  } | null;
  adminBuildCommitShort: string | null;
  sourceLane: DirectDemoSourceLane | null;
  sourceLaneLabel: string | null;
};

export const DIRECT_DEMO_LIVE_CANARY_SUCCESS_SUMMARY =
  "Live canary delivery completed successfully.";

export const DIRECT_DEMO_POST_CANARY_CHECKLIST = [
  "Verify contact in destination GHL.",
  "Verify opportunity pipeline/stage.",
  "Verify SA360 fields populated.",
  "Verify workflow started from SA360::TRIGGER::NEW_LEAD.",
  "Return runtime mode to simulate.",
] as const;
