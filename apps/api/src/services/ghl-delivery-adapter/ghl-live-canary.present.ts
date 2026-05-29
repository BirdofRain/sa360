import type { GhlLiveDeliveryRun, GhlLiveDeliveryStepRun } from "@prisma/client";

export const GHL_LIVE_CANARY_SAFETY_COPY =
  "Live canary mode is not automatic delivery. Zapier/legacy delivery remains active unless manually paused outside SA360.";

export type GhlLiveDeliveryRunItem = {
  id: string;
  leadDeliveryPlanId: string;
  routingDryRunDecisionId: string | null;
  campaignRoutingRuleId: string | null;
  masterClientAccountId: string;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  mode: string;
  status: string;
  idempotencyKey: string;
  operatorConfirmationText: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  executedBy: string | null;
  summary: string | null;
  warnings: string[];
  errors: string[];
  stepRuns: GhlLiveDeliveryStepRunItem[];
  contactIdGhl: string | null;
  opportunityIdGhl: string | null;
  workflowStarted: boolean | null;
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

function jsonStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function externalCallExecutedFromResponse(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return (v as Record<string, unknown>).externalCallExecuted === true;
}

export function presentGhlLiveDeliveryStepRun(step: GhlLiveDeliveryStepRun): GhlLiveDeliveryStepRunItem {
  return {
    id: step.id,
    stepOrder: step.stepOrder,
    stepType: step.stepType,
    targetSystem: step.targetSystem,
    targetId: step.targetId,
    status: step.status,
    externalId: step.externalId,
    errorCode: step.errorCode,
    errorSummary: step.errorSummary,
    warnings: jsonStringArray(step.warnings),
    requestRedactedJson: step.requestRedactedJson,
    responseRedactedJson: step.responseRedactedJson,
    externalCallExecuted: externalCallExecutedFromResponse(step.responseRedactedJson),
    startedAt: step.startedAt?.toISOString() ?? null,
    completedAt: step.completedAt?.toISOString() ?? null,
  };
}

export function presentGhlLiveDeliveryRun(
  run: GhlLiveDeliveryRun & { stepRuns: GhlLiveDeliveryStepRun[] }
): GhlLiveDeliveryRunItem {
  const contactStep = run.stepRuns.find((s) => s.stepType === "create_or_update_contact");
  const oppStep = run.stepRuns.find((s) => s.stepType === "create_or_update_opportunity");
  const wfStep = run.stepRuns.find((s) => s.stepType === "start_workflow");
  const wfResponse =
    wfStep?.responseRedactedJson && typeof wfStep.responseRedactedJson === "object"
      ? (wfStep.responseRedactedJson as Record<string, unknown>)
      : null;

  return {
    id: run.id,
    leadDeliveryPlanId: run.leadDeliveryPlanId,
    routingDryRunDecisionId: run.routingDryRunDecisionId,
    campaignRoutingRuleId: run.campaignRoutingRuleId,
    masterClientAccountId: run.masterClientAccountId,
    destinationClientAccountId: run.destinationClientAccountId,
    destinationSubaccountIdGhl: run.destinationSubaccountIdGhl,
    mode: run.mode,
    status: run.status,
    idempotencyKey: run.idempotencyKey,
    operatorConfirmationText: run.operatorConfirmationText,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    durationMs: run.durationMs,
    executedBy: run.executedBy,
    summary: run.summary,
    warnings: jsonStringArray(run.warnings),
    errors: jsonStringArray(run.errors),
    stepRuns: run.stepRuns.map(presentGhlLiveDeliveryStepRun),
    contactIdGhl: contactStep?.externalId ?? null,
    opportunityIdGhl: oppStep?.externalId ?? null,
    workflowStarted:
      wfResponse?.workflowStarted === true
        ? true
        : wfStep?.status === "succeeded"
          ? true
          : wfStep?.status === "skipped"
            ? null
            : false,
  };
}
