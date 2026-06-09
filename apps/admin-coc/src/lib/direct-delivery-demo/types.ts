/** Must match API `LIVE_CANARY_CONFIRMATION_TEXT`. */
export const DIRECT_DEMO_LIVE_CONFIRMATION_TEXT = "DELIVER ONE LEAD";

export const DIRECT_DEMO_CLIENT_ACCOUNT_ID = "smart_agent_360_demo";
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
  duplicateRisk?: {
    riskLevel: string;
    blocksLiveDelivery: boolean;
    recommendedAction: string | null;
  } | null;
  readiness?: {
    canDeliverLive: boolean;
    blockers: string[];
  } | null;
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
    contactIdGhl: string | null;
    partialContactCreated: boolean;
  } | null;
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
  duplicateRisk: {
    riskLevel: string;
    blocksLiveDelivery: boolean;
    recommendedAction: string | null;
  } | null;
  readiness: {
    canDeliverLive: boolean;
    blockers: string[];
  } | null;
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
    contactIdGhl: string | null;
    partialContactCreated: boolean;
  } | null;
};
