export type CutoverChecklistItem = {
  key: string;
  label: string;
  complete: boolean;
  detail?: string;
};

export type CutoverSectionKey =
  | "client_account"
  | "ghl_destination"
  | "routing_rules"
  | "portal_access"
  | "delivery_readiness"
  | "environment";

export type CutoverReadinessSection = {
  key: CutoverSectionKey;
  label: string;
  complete: boolean;
  items: CutoverChecklistItem[];
};

export type ClientCutoverOverallStatus =
  | "not_ready"
  | "ready_for_shadow"
  | "ready_for_live_review"
  | "blocked";

export type ClientCutoverReadinessReport = {
  clientAccountId: string;
  clientDisplayName: string;
  status: string;
  generatedAt: string;
  overallStatus: ClientCutoverOverallStatus;
  sections: CutoverReadinessSection[];
  blockers: string[];
  warnings: string[];
  manualNextSteps: string[];
};

export type ClientCutoverReadinessResponse = {
  ok: boolean;
  report: ClientCutoverReadinessReport;
};
