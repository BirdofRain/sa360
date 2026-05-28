import type { GhlDeliveryAdapterRun, GhlDeliveryAdapterStepRun } from "@prisma/client";

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

function stringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

function presentStep(step: GhlDeliveryAdapterStepRun): GhlAdapterStepRunItem {
  return {
    id: step.id,
    deliveryPlanStepId: step.deliveryPlanStepId,
    stepOrder: step.stepOrder,
    stepType: step.stepType,
    targetSystem: step.targetSystem,
    targetId: step.targetId,
    mode: step.mode,
    status: step.status,
    title: step.title,
    requestPreviewJson: step.requestPreviewJson,
    responsePreviewJson: step.responsePreviewJson,
    validationErrors: stringArray(step.validationErrors),
    warnings: stringArray(step.warnings),
  };
}

export function presentGhlAdapterRun(
  run: GhlDeliveryAdapterRun & { stepRuns: GhlDeliveryAdapterStepRun[] }
): GhlAdapterRunItem {
  return {
    id: run.id,
    leadDeliveryPlanId: run.leadDeliveryPlanId,
    routingDryRunDecisionId: run.routingDryRunDecisionId,
    masterClientAccountId: run.masterClientAccountId,
    destinationClientAccountId: run.destinationClientAccountId,
    destinationSubaccountIdGhl: run.destinationSubaccountIdGhl,
    mode: run.mode,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
    summary: run.summary,
    warnings: stringArray(run.warnings),
    errors: stringArray(run.errors),
    createdBy: run.createdBy,
    stepRuns: run.stepRuns.map(presentStep),
  };
}

export const GHL_ADAPTER_SAFETY_MESSAGE =
  "No external GHL actions were executed.";
