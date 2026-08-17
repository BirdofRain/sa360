export type LeadFulfillmentKpiKey =
  | "leadsReceived"
  | "proofAttached"
  | "needsReview"
  | "availableInventory"
  | "inventoryTracked"
  | "freshHold"
  | "semiFreshHold"
  | "agedAvailable"
  | "reserved"
  | "blockedReview"
  | "activeOrders"
  | "deliveredLeads"
  | "deliveryFailures";

export type LeadFulfillmentKpiAvailability = "ok" | "unavailable" | "not_wired";

export type LeadFulfillmentKpi = {
  key: LeadFulfillmentKpiKey;
  label: string;
  value: number | null;
  availability?: LeadFulfillmentKpiAvailability;
  displayValue?: string;
  delta?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
  hint?: string;
  group?: "intake" | "inventory" | "fulfillment";
  scope?: string;
};

export type ProofVerificationSummaryKey =
  | "proofAttached"
  | "proofMissing"
  | "needsReview"
  | "rejected"
  | "verificationUnchecked"
  | "passed"
  | "failed";

export type ProofVerificationSummaryItem = {
  key: ProofVerificationSummaryKey;
  label: string;
  count: number;
  tone?: "neutral" | "good" | "bad" | "warn";
  scope?: string;
  hint?: string;
};

export type LeadProofStatus = "attached" | "missing" | "needs_review" | "rejected";
export type LeadVerificationStatus = "unchecked" | "passed" | "failed" | "needs_review";
export type LeadInventoryStatus =
  | "available"
  | "reserved"
  | "delivered"
  | "unavailable"
  | "INTAKE_ONLY"
  | "DATE_MISSING"
  | "FRESH_HOLD"
  | "SEMI_FRESH_HOLD"
  | "AGED_AVAILABLE"
  | "AGED_RESERVED"
  | "AGED_BLOCKED_REVIEW"
  | "DELIVERED"
  | "QUARANTINED";

export type LeadProofArtifactSummary = {
  totalArtifacts: number;
  providers: string[];
  hasConsentCertificate: boolean;
  hasCryptographicIntegrity: boolean;
};

export type RecentLeadIntakeRow = {
  leadUid: string;
  sourceLane: string;
  state: string;
  niche: string;
  proofStatus: LeadProofStatus;
  verificationStatus: LeadVerificationStatus;
  inventoryStatus: LeadInventoryStatus;
  inventoryLifecycle?: string;
  inventoryLifecycleLabel?: string;
  generatedAt?: string | null;
  ageDays?: number | null;
  artifactSummary?: LeadProofArtifactSummary | null;
  createdAt: string;
};

export type FulfillmentActivityKind =
  | "lead_received"
  | "proof_packet_created"
  | "lead_verified"
  | "lead_reserved"
  | "lead_delivered"
  | "delivery_failed";

export type FulfillmentActivityEvent = {
  id: string;
  kind: FulfillmentActivityKind;
  leadUid: string;
  summary: string;
  at: string;
};

export type LeadFulfillmentOverviewData = {
  kpis: LeadFulfillmentKpi[];
  proofSummary: ProofVerificationSummaryItem[];
  recentIntake: RecentLeadIntakeRow[];
  activity: FulfillmentActivityEvent[];
  campaignHelpText?: string;
};
