import type {
  LeadProofOverviewActivityRow,
  LeadProofOverviewRecentIntakeRow,
  LeadProofOverviewSummary,
} from "../../repositories/lead-proof.repository.js";

export type LeadFulfillmentOverviewKpiDto = {
  key: string;
  label: string;
  value: number | null;
  availability?: "ok" | "unavailable" | "not_wired";
  displayValue?: string;
  tone?: "neutral" | "good" | "bad" | "warn";
  hint?: string;
  group?: "intake" | "inventory" | "fulfillment";
  scope?: string;
};

export type LeadFulfillmentProofSummaryItemDto = {
  key: string;
  label: string;
  count: number;
  tone?: "neutral" | "good" | "bad" | "warn";
  scope?: string;
  hint?: string;
};

export type LeadFulfillmentRecentIntakeRowDto = {
  leadUid: string;
  sourceLane: string;
  state: string;
  niche: string;
  proofStatus: string;
  verificationStatus: string;
  inventoryStatus: string;
  inventoryLifecycle?: string;
  inventoryLifecycleLabel?: string;
  generatedAt?: string | null;
  ageDays?: number | null;
  artifactSummary?: {
    totalArtifacts: number;
    providers: string[];
    hasConsentCertificate: boolean;
    hasCryptographicIntegrity: boolean;
  } | null;
  createdAt: string;
};

export type LeadFulfillmentActivityEventDto = {
  id: string;
  kind: string;
  leadUid: string;
  summary: string;
  at: string;
};

export type LeadFulfillmentOverviewDto = {
  dataSource: "lead_fulfillment_overview_v2" | "lead_proof_vault";
  kpis: LeadFulfillmentOverviewKpiDto[];
  proofSummary: LeadFulfillmentProofSummaryItemDto[];
  recentIntake: LeadFulfillmentRecentIntakeRowDto[];
  activity: LeadFulfillmentActivityEventDto[];
  dataLimitations: string[];
  campaignHelpText?: string;
  queryEvidence?: unknown[];
};

function formatSourceLaneLabel(
  sourceLane: string | null,
  sourcePlatform: string | null
): string {
  if (sourceLane === "meta_lead_ads") return "Meta Lead Ads";
  if (sourceLane === "leadconduit_facebook") return "LeadConduit Facebook";
  if (sourceLane === "leadcapture_io") return "LeadCapture.io";
  if (sourceLane === "manual_direct_demo") return "Manual direct demo";
  if (sourcePlatform) return sourcePlatform;
  if (sourceLane && sourceLane !== "unknown") return sourceLane;
  return "Unknown source lane";
}

function presentProofStatus(status: string): string {
  switch (status) {
    case "PROOF_ATTACHED":
      return "attached";
    case "PROOF_MISSING":
      return "missing";
    case "NEEDS_REVIEW":
      return "needs_review";
    case "REJECTED":
      return "rejected";
    default:
      return "missing";
  }
}

function presentVerificationStatus(status: string | null): string {
  switch (status) {
    case "PASSED":
      return "passed";
    case "FAILED":
      return "failed";
    case "NEEDS_REVIEW":
      return "needs_review";
    default:
      return "unchecked";
  }
}

function presentInventoryStatus(
  proofStatus: string,
  verificationStatus: string | null
): string {
  if (verificationStatus === "PASSED" && proofStatus === "PROOF_ATTACHED") {
    return "available";
  }
  if (proofStatus === "REJECTED" || verificationStatus === "FAILED") {
    return "unavailable";
  }
  return "unavailable";
}

function activityFromProofRow(row: LeadProofOverviewActivityRow): LeadFulfillmentActivityEventDto {
  if (row.verificationStatus === "PASSED") {
    return {
      id: `${row.id}:verified`,
      kind: "lead_verified",
      leadUid: row.leadUid,
      summary: "Verification status passed — compliance review ready pending inventory rules.",
      at: row.updatedAt.toISOString(),
    };
  }
  if (row.proofStatus === "PROOF_ATTACHED") {
    return {
      id: `${row.id}:proof`,
      kind: "proof_packet_created",
      leadUid: row.leadUid,
      summary: "Proof packet stored for consent proof and source attribution review.",
      at: row.updatedAt.toISOString(),
    };
  }
  return {
    id: `${row.id}:received`,
    kind: "lead_received",
    leadUid: row.leadUid,
    summary: "Lead received with proof packet pending or incomplete.",
    at: row.createdAt.toISOString(),
  };
}

function presentRecentIntakeRow(row: LeadProofOverviewRecentIntakeRow): LeadFulfillmentRecentIntakeRowDto {
  return {
    leadUid: row.leadUid,
    sourceLane: formatSourceLaneLabel(row.sourceLane, row.sourcePlatform),
    state: row.state ?? "—",
    niche: row.niche ?? "—",
    proofStatus: presentProofStatus(row.proofStatus),
    verificationStatus: presentVerificationStatus(row.verificationStatus),
    inventoryStatus: presentInventoryStatus(row.proofStatus, row.verificationStatus),
    artifactSummary: row.artifactSummary,
    createdAt: row.createdAt.toISOString(),
  };
}

export function presentLeadFulfillmentOverview(
  summary: LeadProofOverviewSummary
): LeadFulfillmentOverviewDto {
  const proofAttached = summary.proofStatusCounts.PROOF_ATTACHED;
  const needsReview =
    summary.proofStatusCounts.NEEDS_REVIEW + summary.verificationStatusCounts.NEEDS_REVIEW;
  const proofMissing = summary.proofStatusCounts.PROOF_MISSING + summary.proofStatusCounts.UNREVIEWED;

  return {
    dataSource: "lead_proof_vault",
    kpis: [
      {
        key: "leadsReceived",
        label: "Leads received",
        value: summary.totalLeads,
        availability: "ok",
        tone: "neutral",
        group: "intake",
        scope: "lf1_proof_vault",
        hint: "LF1 LeadProof intake count. Not the same population as inventory verification.",
      },
      {
        key: "proofAttached",
        label: "LF1 proof attached",
        value: proofAttached,
        availability: "ok",
        tone: "good",
        scope: "lf1_proof_vault",
      },
      {
        key: "needsReview",
        label: "LF1 proof needs review",
        value: needsReview,
        availability: "ok",
        tone: needsReview > 0 ? "warn" : "neutral",
        scope: "lf1_proof_vault",
      },
      {
        key: "availableInventory",
        label: "Available inventory",
        value: null,
        availability: "unavailable",
        displayValue: "Unavailable",
        hint: "Replaced by inventory lifecycle aggregates on the composed overview.",
      },
      {
        key: "activeOrders",
        label: "Active orders",
        value: null,
        availability: "unavailable",
        displayValue: "Unavailable",
        hint: "Replaced by LeadOrder aggregates on the composed overview.",
      },
      {
        key: "deliveredLeads",
        label: "Buyer deliveries",
        value: null,
        availability: "unavailable",
        displayValue: "Unavailable",
        hint: "Replaced by BuyerDeliveredIdentity count on the composed overview.",
      },
      {
        key: "deliveryFailures",
        label: "Delivery failures",
        value: null,
        availability: "not_wired",
        displayValue: "Not wired",
        hint: "Delivery failure ledger is not wired.",
      },
    ],
    proofSummary: [
      {
        key: "proofAttached",
        label: "LF1 proof attached",
        count: proofAttached,
        tone: "good",
        scope: "lf1_proof_vault",
        hint: "Counted from LeadProof rows, not LeadInventoryItem.",
      },
      {
        key: "proofMissing",
        label: "LF1 proof missing",
        count: proofMissing,
        tone: "warn",
        scope: "lf1_proof_vault",
        hint: "Counted from LeadProof rows, not LeadInventoryItem.",
      },
      {
        key: "needsReview",
        label: "LF1 proof needs review",
        count: needsReview,
        tone: "warn",
        scope: "lf1_proof_vault",
      },
      {
        key: "rejected",
        label: "LF1 proof rejected",
        count: summary.proofStatusCounts.REJECTED,
        tone: "bad",
        scope: "lf1_proof_vault",
      },
      {
        key: "verificationUnchecked",
        label: "Inventory verification unchecked",
        count: summary.verificationStatusCounts.UNCHECKED,
        tone: "neutral",
        scope: "lead_verification_result",
        hint: "Counted from LeadVerificationResult, a different population than LF1 intake.",
      },
      {
        key: "passed",
        label: "Inventory verification passed",
        count: summary.verificationStatusCounts.PASSED,
        tone: "good",
        scope: "lead_verification_result",
        hint: "Counted from LeadVerificationResult, not comparable to LF1 leads received.",
      },
      {
        key: "failed",
        label: "Inventory verification failed",
        count: summary.verificationStatusCounts.FAILED,
        tone: "bad",
        scope: "lead_verification_result",
      },
    ],
    recentIntake: summary.recentIntake.map(presentRecentIntakeRow),
    activity: summary.recentActivity.map(activityFromProofRow),
    dataLimitations: [
      "Inventory, orders, and delivery KPIs remain placeholders until LF2-LF5 modules are implemented.",
      "Fulfillment activity is derived from proof vault timestamps, not a dedicated activity ledger yet.",
      "Suppression check status and external verification integrations are not active in this phase.",
    ],
  };
}
