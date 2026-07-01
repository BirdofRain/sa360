import type {
  LeadOrderAdminRow,
  LeadOrderAudience,
  LeadOrderClientRow,
  LeadOrderTrustSnapshot,
} from "./lead-order.types.js";
import type { mapLeadOrderRow } from "../../repositories/lead-order.repository.js";

type LeadOrderRecord = ReturnType<typeof mapLeadOrderRow>;

function parseTrustSnapshot(value: unknown): LeadOrderTrustSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const warnings = Array.isArray(obj.warnings)
    ? obj.warnings.map((w) => String(w).trim()).filter(Boolean)
    : undefined;
  return {
    status: typeof obj.status === "string" ? obj.status : undefined,
    warnings,
    checkedAt: typeof obj.checkedAt === "string" ? obj.checkedAt : undefined,
  };
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function buildSetupWarnings(snapshot: LeadOrderTrustSnapshot | null, status: string): string[] {
  const warnings: string[] = [];
  if (status === "needs_setup") {
    warnings.push("Your order is waiting on account setup before fulfillment can begin.");
  }
  if (status === "needs_compliance") {
    warnings.push("Compliance review is required before this order can go live.");
  }
  if (snapshot?.warnings?.length) {
    for (const w of snapshot.warnings.slice(0, 3)) {
      warnings.push(w);
    }
  } else if (snapshot?.status === "warning" || snapshot?.status === "needs_setup") {
    warnings.push("Trust checks indicate setup items still need attention.");
  }
  return warnings;
}

function baseFields(row: LeadOrderRecord) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    clientAccountId: row.clientAccountId,
    clientDisplayName: row.clientDisplayName,
    status: row.status,
    nicheKey: row.nicheKey,
    productType: row.productType,
    states: row.states,
    leadVolume: row.leadVolume,
    deliveryCadence: row.deliveryCadence,
    campaignType: row.campaignType,
    crmPackage: row.crmPackage,
    aiVoiceAddon: row.aiVoiceAddon,
    requestedStartDate: iso(row.requestedStartDate),
    deliveryDestinationType: row.deliveryDestinationType,
    deliveryDestinationLabel: row.deliveryDestinationLabel,
    notes: row.notes,
    createdByRole: row.createdByRole,
    submittedAt: iso(row.submittedAt),
    approvedAt: iso(row.approvedAt),
    activatedAt: iso(row.activatedAt),
    pausedAt: iso(row.pausedAt),
    completedAt: iso(row.completedAt),
    canceledAt: iso(row.canceledAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function presentLeadOrderListRow(
  row: LeadOrderRecord,
  audience: LeadOrderAudience
): LeadOrderAdminRow | LeadOrderClientRow {
  if (audience === "admin") {
    return {
      ...baseFields(row),
      adminNotes: row.adminNotes,
      trustStatusSnapshot: parseTrustSnapshot(row.trustStatusSnapshotJson),
      routingRuleId: row.routingRuleId,
      campaignId: row.campaignId,
      createdByUserId: row.createdByUserId,
    };
  }

  const snapshot = parseTrustSnapshot(row.trustStatusSnapshotJson);
  return {
    ...baseFields(row),
    setupWarnings: buildSetupWarnings(snapshot, row.status),
    fulfillmentSummary: "Fulfillment tracking will appear here once delivery is linked.",
  };
}

export function presentLeadOrderDetail(
  row: LeadOrderRecord,
  audience: LeadOrderAudience
): LeadOrderAdminRow | LeadOrderClientRow {
  return presentLeadOrderListRow(row, audience);
}
