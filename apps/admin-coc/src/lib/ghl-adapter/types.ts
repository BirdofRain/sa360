export type GhlAdapterStepRunItem = {
  id: string;
  deliveryPlanStepId: string | null;
  stepOrder: number;
  stepType: string;
  targetSystem: string;
  targetId: string | null;
  mode: string;
  status: string;
  title: string;
  requestPreviewJson: unknown;
  responsePreviewJson: unknown;
  validationErrors: string[];
  warnings: string[];
};

export type GhlAdapterRunItem = {
  id: string;
  leadDeliveryPlanId: string;
  routingDryRunDecisionId: string | null;
  masterClientAccountId: string;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  mode: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  warnings: string[];
  errors: string[];
  createdBy: string;
  stepRuns: GhlAdapterStepRunItem[];
};

export type GhlAdapterValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  missingConfig: string[];
};

export type GhlAdapterSimulateResponse = {
  ok: boolean;
  adapterRun: GhlAdapterRunItem;
  validation: GhlAdapterValidation;
  safetyMessage: string;
  adapterMode: string;
  blockedReason: string | null;
};

export const GHL_ADAPTER_SAFETY_COPY =
  "Simulation only — no GHL contact was created. No workflow was started.";
