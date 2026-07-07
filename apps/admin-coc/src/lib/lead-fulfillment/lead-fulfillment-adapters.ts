import type {
  FulfillmentActivityEvent,
  FulfillmentActivityKind,
  LeadFulfillmentKpi,
  LeadFulfillmentKpiKey,
  LeadFulfillmentOverviewData,
  LeadInventoryStatus,
  LeadProofStatus,
  LeadVerificationStatus,
  ProofVerificationSummaryItem,
  ProofVerificationSummaryKey,
  RecentLeadIntakeRow,
} from "@/lib/lead-fulfillment/types";

export type LeadFulfillmentOverviewApiResponse = LeadFulfillmentOverviewData & {
  dataSource: "lead_proof_vault";
  dataLimitations: string[];
};

const KPI_KEYS: LeadFulfillmentKpiKey[] = [
  "leadsReceived",
  "proofAttached",
  "needsReview",
  "availableInventory",
  "activeOrders",
  "deliveredLeads",
  "deliveryFailures",
];

const PROOF_SUMMARY_KEYS: ProofVerificationSummaryKey[] = [
  "proofAttached",
  "proofMissing",
  "needsReview",
  "rejected",
  "verificationUnchecked",
  "passed",
  "failed",
];

const ACTIVITY_KINDS: FulfillmentActivityKind[] = [
  "lead_received",
  "proof_packet_created",
  "lead_verified",
  "lead_reserved",
  "lead_delivered",
  "delivery_failed",
];

function asKpiKey(value: string): LeadFulfillmentKpiKey | null {
  return KPI_KEYS.includes(value as LeadFulfillmentKpiKey)
    ? (value as LeadFulfillmentKpiKey)
    : null;
}

function asProofSummaryKey(value: string): ProofVerificationSummaryKey | null {
  return PROOF_SUMMARY_KEYS.includes(value as ProofVerificationSummaryKey)
    ? (value as ProofVerificationSummaryKey)
    : null;
}

function asProofStatus(value: string): LeadProofStatus {
  if (value === "attached" || value === "missing" || value === "needs_review" || value === "rejected") {
    return value;
  }
  return "missing";
}

function asVerificationStatus(value: string): LeadVerificationStatus {
  if (
    value === "unchecked" ||
    value === "passed" ||
    value === "failed" ||
    value === "needs_review"
  ) {
    return value;
  }
  return "unchecked";
}

function asInventoryStatus(value: string): LeadInventoryStatus {
  if (
    value === "available" ||
    value === "reserved" ||
    value === "delivered" ||
    value === "unavailable"
  ) {
    return value;
  }
  return "unavailable";
}

function asActivityKind(value: string): FulfillmentActivityKind {
  return ACTIVITY_KINDS.includes(value as FulfillmentActivityKind)
    ? (value as FulfillmentActivityKind)
    : "lead_received";
}

function asTone(value: unknown): LeadFulfillmentKpi["tone"] | undefined {
  if (value === "neutral" || value === "good" || value === "bad" || value === "warn") {
    return value;
  }
  return undefined;
}

export function adaptLeadFulfillmentOverviewApiResponse(
  payload: LeadFulfillmentOverviewApiResponse
): LeadFulfillmentOverviewData {
  return {
    kpis: payload.kpis.flatMap((item) => {
      const key = asKpiKey(item.key);
      if (!key) return [];
      return [
        {
          key,
          label: item.label,
          value: item.value,
          delta: item.delta,
          tone: asTone(item.tone),
          hint: item.hint,
        } satisfies LeadFulfillmentKpi,
      ];
    }),
    proofSummary: payload.proofSummary.flatMap((item) => {
      const key = asProofSummaryKey(item.key);
      if (!key) return [];
      return [
        {
          key,
          label: item.label,
          count: item.count,
          tone: asTone(item.tone),
        } satisfies ProofVerificationSummaryItem,
      ];
    }),
    recentIntake: payload.recentIntake.map(
      (row): RecentLeadIntakeRow => ({
        leadUid: row.leadUid,
        sourceLane: row.sourceLane,
        state: row.state,
        niche: row.niche,
        proofStatus: asProofStatus(row.proofStatus),
        verificationStatus: asVerificationStatus(row.verificationStatus),
        inventoryStatus: asInventoryStatus(row.inventoryStatus),
        artifactSummary: row.artifactSummary ?? null,
        createdAt: row.createdAt,
      })
    ),
    activity: payload.activity.map(
      (event): FulfillmentActivityEvent => ({
        id: event.id,
        kind: asActivityKind(event.kind),
        leadUid: event.leadUid,
        summary: event.summary,
        at: event.at,
      })
    ),
  };
}

export function hasLimitedLf1ModuleKpis(data: LeadFulfillmentOverviewData): boolean {
  return data.kpis.some(
    (kpi) =>
      (kpi.key === "availableInventory" ||
        kpi.key === "activeOrders" ||
        kpi.key === "deliveredLeads" ||
        kpi.key === "deliveryFailures") &&
      Boolean(kpi.hint?.toLowerCase().includes("not implemented") || kpi.hint?.toLowerCase().includes("not wired"))
  );
}
