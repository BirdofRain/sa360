export type LeadFulfillmentKpiKey =
  | "leadsReceived"
  | "proofAttached"
  | "needsReview"
  | "availableInventory"
  | "activeOrders"
  | "deliveredLeads"
  | "deliveryFailures";

export type LeadFulfillmentKpi = {
  key: LeadFulfillmentKpiKey;
  label: string;
  value: number;
  delta?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
  hint?: string;
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
};

export type LeadProofStatus = "attached" | "missing" | "needs_review" | "rejected";
export type LeadVerificationStatus = "unchecked" | "passed" | "failed" | "needs_review";
export type LeadInventoryStatus = "available" | "reserved" | "delivered" | "unavailable";

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
};
