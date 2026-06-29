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
  status: string;
  deliveryMode: string;
  summary: string | null;
  warnings: string[];
  generatedAt: string;
  steps: LeadDeliveryPlanStepItem[];
};

export type LeadDeliveryPlanSummary = {
  id: string;
  status: string;
  deliveryMode: string;
  generatedAt: string;
};
