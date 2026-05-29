export const GHL_LIVE_CANARY_SAFETY_COPY =
  "Live canary mode is not automatic delivery. Zapier/legacy delivery remains active unless manually paused outside SA360.";

export const LIVE_CANARY_CONFIRMATION_TEXT = "DELIVER ONE LEAD";

export type GhlLiveCanaryPreflight = {
  canExecute: boolean;
  blockers: string[];
  warnings: string[];
  adapterMode: string;
  idempotencyKey: string;
  lastAdapterSimulationStatus: string | null;
  lastAdapterSimulationPassed: boolean;
  lastLiveRunStatus: string | null;
  duplicateRiskLevel: string | null;
  duplicateBlocksLive: boolean;
  readinessCanDeliverLive: boolean;
};

export type GhlLiveDeliveryStepRunItem = {
  id: string;
  stepOrder: number;
  stepType: string;
  targetSystem: string;
  targetId: string | null;
  status: string;
  externalId: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  warnings: string[];
  requestRedactedJson: unknown;
  responseRedactedJson: unknown;
  externalCallExecuted: boolean;
  startedAt: string | null;
  completedAt: string | null;
};

export type GhlLiveDeliveryRunItem = {
  id: string;
  leadDeliveryPlanId: string;
  status: string;
  idempotencyKey: string;
  summary: string | null;
  warnings: string[];
  errors: string[];
  stepRuns: GhlLiveDeliveryStepRunItem[];
  contactIdGhl: string | null;
  opportunityIdGhl: string | null;
  workflowStarted: boolean | null;
  startedAt: string;
  completedAt: string | null;
};

export type GhlLiveCanaryPreflightResponse = {
  ok: boolean;
  preflight: GhlLiveCanaryPreflight;
  safetyMessage: string;
  adapterMode: string;
};

export type GhlLiveCanaryExecuteResponse = {
  ok: boolean;
  liveRun?: GhlLiveDeliveryRunItem;
  contactIdGhl?: string | null;
  opportunityIdGhl?: string | null;
  workflowStarted?: boolean;
  externalCallExecuted?: boolean;
  skippedDuplicate?: boolean;
  blockers?: string[];
  safetyMessage?: string;
  error?: string;
};
