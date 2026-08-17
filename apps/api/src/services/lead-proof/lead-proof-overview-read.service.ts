import { prisma } from "../../lib/db.js";
import { getLeadProofOverviewSummary } from "../../repositories/lead-proof.repository.js";
import {
  loadFulfillmentOverviewCounts,
  loadInventoryLifecycleAggregates,
  type OverviewCountMetric,
} from "../lead-fulfillment-overview/inventory-lifecycle-aggregates.service.js";
import { loadRecentCampaignIntake } from "../lead-fulfillment-overview/recent-campaign-intake.service.js";
import {
  presentLeadFulfillmentOverview,
  type LeadFulfillmentOverviewDto,
  type LeadFulfillmentOverviewKpiDto,
} from "./lead-proof-overview.present.js";

const CAMPAIGN_HELP_TEXT =
  "Campaign leads are inventory-tracked from intake. Fresh and Semi-Fresh leads remain on HOLD and automatically enter aged commerce eligibility as their generated date crosses 30 days, subject to review and other eligibility rules.";

function metricToKpi(
  metric: OverviewCountMetric,
  group: LeadFulfillmentOverviewKpiDto["group"]
): LeadFulfillmentOverviewKpiDto {
  const displayValue =
    metric.availability === "not_wired"
      ? "Not wired"
      : metric.availability === "unavailable"
        ? "Unavailable"
        : undefined;
  return {
    key: metric.key,
    label: metric.label,
    value: metric.value,
    availability: metric.availability,
    displayValue,
    hint: metric.hint,
    group,
    tone: metric.availability === "ok" ? "neutral" : "warn",
  };
}

async function safeSourceLeadCount(): Promise<LeadFulfillmentOverviewKpiDto> {
  try {
    const value = await prisma.sourceLeadEvent.count();
    return {
      key: "leadsReceived",
      label: "Leads received",
      value,
      availability: "ok",
      group: "intake",
      scope: "source_lead_event",
      hint: "COUNT(*) on SourceLeadEvent. Distinct from LF1 proof-vault and inventory-verification populations.",
      tone: "neutral",
    };
  } catch (err) {
    return {
      key: "leadsReceived",
      label: "Leads received",
      value: null,
      availability: "unavailable",
      displayValue: "Unavailable",
      group: "intake",
      scope: "source_lead_event",
      hint: err instanceof Error ? err.message : "source_lead_count_failed",
      tone: "warn",
    };
  }
}

/** Backend DTO for Admin C.O.C. Lead Fulfillment Overview. */
export async function getLeadFulfillmentOverviewForAdmin(options?: {
  recentLimit?: number;
}): Promise<LeadFulfillmentOverviewDto> {
  try {
  const [proofResult, inventoryResult, fulfillmentResult, recentResult, intakeCount] =
    await Promise.allSettled([
      getLeadProofOverviewSummary(options),
      loadInventoryLifecycleAggregates(),
      loadFulfillmentOverviewCounts(),
      loadRecentCampaignIntake(undefined, { limit: options?.recentLimit }),
      safeSourceLeadCount(),
    ]);

  const proofSummary =
    proofResult.status === "fulfilled"
      ? presentLeadFulfillmentOverview(proofResult.value)
      : null;

  const dataLimitations: string[] = [];
  if (proofResult.status === "rejected") {
    dataLimitations.push("LF1 proof/verification summary unavailable.");
  }
  if (inventoryResult.status === "rejected") {
    dataLimitations.push("Inventory lifecycle aggregates unavailable.");
  }
  if (fulfillmentResult.status === "rejected") {
    dataLimitations.push("Fulfillment order/delivery aggregates unavailable.");
  }
  if (recentResult.status === "rejected" || (recentResult.status === "fulfilled" && !recentResult.value.ok)) {
    dataLimitations.push("Recent campaign intake unavailable.");
  }

  const inventoryMetrics =
    inventoryResult.status === "fulfilled"
      ? inventoryResult.value.metrics.map((metric) => metricToKpi(metric, "inventory"))
      : [
          "inventoryTracked",
          "freshHold",
          "semiFreshHold",
          "agedAvailable",
          "reserved",
          "blockedReview",
        ].map((key) => ({
          key,
          label: key,
          value: null,
          availability: "unavailable" as const,
          displayValue: "Unavailable",
          group: "inventory" as const,
          tone: "warn" as const,
        }));

  const fulfillment =
    fulfillmentResult.status === "fulfilled"
      ? fulfillmentResult.value
      : null;

  const fulfillmentKpis: LeadFulfillmentOverviewKpiDto[] = fulfillment
    ? [
        metricToKpi(fulfillment.activePricedOrders, "fulfillment"),
        metricToKpi(fulfillment.deliveredLeads, "fulfillment"),
        metricToKpi(fulfillment.deliveryFailures, "fulfillment"),
      ]
    : [
        {
          key: "activeOrders",
          label: "Active priced orders",
          value: null,
          availability: "unavailable",
          displayValue: "Unavailable",
          group: "fulfillment",
          tone: "warn",
        },
        {
          key: "deliveredLeads",
          label: "Buyer deliveries",
          value: null,
          availability: "unavailable",
          displayValue: "Unavailable",
          group: "fulfillment",
          tone: "warn",
        },
        {
          key: "deliveryFailures",
          label: "Delivery failures",
          value: null,
          availability: "not_wired",
          displayValue: "Not wired",
          group: "fulfillment",
          tone: "warn",
        },
      ];

  const leadsReceived =
    intakeCount.status === "fulfilled"
      ? intakeCount.value
      : {
          key: "leadsReceived",
          label: "Leads received",
          value: null,
          availability: "unavailable" as const,
          displayValue: "Unavailable",
          group: "intake" as const,
          tone: "warn" as const,
        };

  const recentIntake =
    recentResult.status === "fulfilled" && recentResult.value.ok
      ? recentResult.value.rows
      : [];

  const queryEvidence = [
    ...(inventoryResult.status === "fulfilled" ? inventoryResult.value.queryEvidence : []),
    {
      queryType: "count",
      predicates: ["SourceLeadEvent"],
      indexesUsed: ["SourceLeadEvent_pkey"],
      maxResultCardinality: 1,
      jsonCorpusScan: false,
      nodeMaterializesInventoryRows: false,
    },
    {
      queryType: "bounded_findMany",
      predicates: ["SourceLeadEvent orderBy receivedAt desc"],
      indexesUsed: ["SourceLeadEvent_receivedAt_idx"],
      maxResultCardinality: 25,
      jsonCorpusScan: false,
      nodeMaterializesInventoryRows: false,
    },
  ];

  return {
    dataSource: "lead_fulfillment_overview_v2",
    kpis: [leadsReceived, ...inventoryMetrics, ...fulfillmentKpis],
    proofSummary: proofSummary?.proofSummary ?? [],
    recentIntake,
    activity: proofSummary?.activity ?? [],
    dataLimitations: [
      ...dataLimitations,
      "Proof metrics are LF1 LeadProof / LeadVerificationResult populations and are not directly comparable to inventory counts.",
      "Buyer deliveries count BuyerDeliveredIdentity records only. CSV download is not delivered.",
      "LeadConduit Facebook campaign inventory tracking is not hooked yet.",
    ],
    campaignHelpText: CAMPAIGN_HELP_TEXT,
    queryEvidence,
  };
  } catch (err) {
    return {
      dataSource: "lead_fulfillment_overview_v2",
      kpis: [
        {
          key: "leadsReceived",
          label: "Leads received",
          value: null,
          availability: "unavailable",
          displayValue: "Unavailable",
          group: "intake",
          tone: "warn",
        },
      ],
      proofSummary: [],
      recentIntake: [],
      activity: [],
      dataLimitations: [
        err instanceof Error ? err.message : "overview_compose_failed",
      ],
      campaignHelpText: CAMPAIGN_HELP_TEXT,
    };
  }
}
