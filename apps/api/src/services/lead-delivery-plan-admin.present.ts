import type { LeadDeliveryPlan, LeadDeliveryPlanStep } from "@prisma/client";

export type LeadDeliveryPlanStepItem = {
  id: string;
  stepOrder: number;
  stepType: string;
  status: string;
  title: string;
  description: string | null;
  targetSystem: string | null;
  targetId: string | null;
  requestPreviewJson: unknown;
  resultPreviewJson: unknown;
  warnings: string[];
};

export type LeadDeliveryPlanItem = {
  id: string;
  routingDryRunDecisionId: string | null;
  lifecycleEventId: string | null;
  masterClientAccountId: string;
  sourceLeadUid: string | null;
  sourceContactIdGhl: string | null;
  sourcePhoneE164: string | null;
  sourceEmail: string | null;
  destinationClientAccountId: string;
  destinationSubaccountIdGhl: string;
  destinationClientDisplayName: string | null;
  nicheKey: string | null;
  productType: string | null;
  deliveryMode: string;
  status: string;
  planVersion: string;
  generatedAt: string;
  generatedBy: string;
  summary: string | null;
  warnings: string[];
  steps: LeadDeliveryPlanStepItem[];
};

export type LeadDeliveryPlanSummary = {
  id: string;
  status: string;
  deliveryMode: string;
  generatedAt: string;
};

function warningsArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((w): w is string => typeof w === "string");
}

function presentStep(step: LeadDeliveryPlanStep): LeadDeliveryPlanStepItem {
  return {
    id: step.id,
    stepOrder: step.stepOrder,
    stepType: step.stepType,
    status: step.status,
    title: step.title,
    description: step.description,
    targetSystem: step.targetSystem,
    targetId: step.targetId,
    requestPreviewJson: step.requestPreviewJson,
    resultPreviewJson: step.resultPreviewJson,
    warnings: warningsArray(step.warnings),
  };
}

export function presentLeadDeliveryPlan(
  plan: LeadDeliveryPlan & { steps: LeadDeliveryPlanStep[] }
): LeadDeliveryPlanItem {
  return {
    id: plan.id,
    routingDryRunDecisionId: plan.routingDryRunDecisionId,
    lifecycleEventId: plan.lifecycleEventId,
    masterClientAccountId: plan.masterClientAccountId,
    sourceLeadUid: plan.sourceLeadUid,
    sourceContactIdGhl: plan.sourceContactIdGhl,
    sourcePhoneE164: plan.sourcePhoneE164,
    sourceEmail: plan.sourceEmail,
    destinationClientAccountId: plan.destinationClientAccountId,
    destinationSubaccountIdGhl: plan.destinationSubaccountIdGhl,
    destinationClientDisplayName: plan.destinationClientDisplayName,
    nicheKey: plan.nicheKey,
    productType: plan.productType,
    deliveryMode: plan.deliveryMode,
    status: plan.status,
    planVersion: plan.planVersion,
    generatedAt: plan.generatedAt.toISOString(),
    generatedBy: plan.generatedBy,
    summary: plan.summary,
    warnings: warningsArray(plan.warnings),
    steps: plan.steps.map(presentStep),
  };
}

export function presentLeadDeliveryPlanSummary(
  plan: Pick<LeadDeliveryPlan, "id" | "status" | "deliveryMode" | "generatedAt">
): LeadDeliveryPlanSummary {
  return {
    id: plan.id,
    status: plan.status,
    deliveryMode: plan.deliveryMode,
    generatedAt: plan.generatedAt.toISOString(),
  };
}
