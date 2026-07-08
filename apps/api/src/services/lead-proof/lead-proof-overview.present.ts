import type {
  LeadProofOverviewActivityRow,
  LeadProofOverviewRecentIntakeRow,
  LeadProofOverviewSummary,
} from "../../repositories/lead-proof.repository.js";

export type LeadFulfillmentOverviewKpiDto = {
  key: string;
  label: string;
  value: number;
  tone?: "neutral" | "good" | "bad" | "warn";
  hint?: string;
};

export type LeadFulfillmentProofSummaryItemDto = {
  key: string;
  label: string;
  count: number;
  tone?: "neutral" | "good" | "bad" | "warn";
};

export type LeadFulfillmentRecentIntakeRowDto = {
  leadUid: string;
  sourceLane: string;
  state: string;
  niche: string;
  proofStatus: string;
  verificationStatus: string;
  inventoryStatus: string;
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
  dataSource: "lead_proof_vault";
  kpis: LeadFulfillmentOverviewKpiDto[];
  proofSummary: LeadFulfillmentProofSummaryItemDto[];
  recentIntake: LeadFulfillmentRecentIntakeRowDto[];
  activity: LeadFulfillmentActivityEventDto[];
  dataLimitations: string[];
};

function formatSourceLaneLabel(
  sourceLane: string | null,
  sourcePlatform: string | null
): string {
  if (sourceLane === "meta_lead_ads") return "Meta Lead Ads";
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
        tone: "neutral",
      },
      {
        key: "proofAttached",
        label: "Proof attached",
        value: proofAttached,
        tone: "good",
      },
      {
        key: "needsReview",
        label: "Needs review",
        value: needsReview,
        tone: needsReview > 0 ? "warn" : "neutral",
      },
      {
        key: "availableInventory",
        label: "Available inventory",
        value: 0,
        hint: "Inventory module not implemented yet.",
      },
      {
        key: "activeOrders",
        label: "Active orders",
        value: 0,
        hint: "Order module not implemented yet.",
      },
      {
        key: "deliveredLeads",
        label: "Delivered leads",
        value: 0,
        hint: "Fulfillment delivery audit counts not wired yet.",
      },
      {
        key: "deliveryFailures",
        label: "Delivery failures",
        value: 0,
        hint: "Delivery failure counts not wired yet.",
      },
    ],
    proofSummary: [
      {
        key: "proofAttached",
        label: "Proof attached",
        count: proofAttached,
        tone: "good",
      },
      {
        key: "proofMissing",
        label: "Proof missing",
        count: proofMissing,
        tone: "warn",
      },
      {
        key: "needsReview",
        label: "Needs review",
        count: needsReview,
        tone: "warn",
      },
      {
        key: "rejected",
        label: "Rejected",
        count: summary.proofStatusCounts.REJECTED,
        tone: "bad",
      },
      {
        key: "verificationUnchecked",
        label: "Verification unchecked",
        count: summary.verificationStatusCounts.UNCHECKED,
        tone: "neutral",
      },
      {
        key: "passed",
        label: "Passed",
        count: summary.verificationStatusCounts.PASSED,
        tone: "good",
      },
      {
        key: "failed",
        label: "Failed",
        count: summary.verificationStatusCounts.FAILED,
        tone: "bad",
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
