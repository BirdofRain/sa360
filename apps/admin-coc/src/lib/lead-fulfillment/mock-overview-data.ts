import type { LeadFulfillmentOverviewData } from "./types";

/** Demo-only overview payload — replace with LF1 API wiring when available. */
export const LEAD_FULFILLMENT_MOCK_OVERVIEW: LeadFulfillmentOverviewData = {
  kpis: [
    { key: "leadsReceived", label: "Leads received", value: 1284, delta: "+12% vs last week", tone: "neutral" },
    { key: "proofAttached", label: "Proof attached", value: 946, delta: "74% attach rate", tone: "good" },
    { key: "needsReview", label: "Needs review", value: 37, delta: "12 urgent", tone: "warn" },
    { key: "availableInventory", label: "Available inventory", value: 412, hint: "Verified, unreserved units" },
    { key: "activeOrders", label: "Active orders", value: 18, hint: "Open fulfillment commitments" },
    { key: "deliveredLeads", label: "Delivered leads", value: 803, delta: "+6% vs last week", tone: "good" },
    { key: "deliveryFailures", label: "Delivery failures", value: 9, delta: "3 retriable", tone: "bad" },
  ],
  proofSummary: [
    { key: "proofAttached", label: "Proof attached", count: 946, tone: "good" },
    { key: "proofMissing", label: "Proof missing", count: 218, tone: "warn" },
    { key: "needsReview", label: "Needs review", count: 37, tone: "warn" },
    { key: "rejected", label: "Rejected", count: 14, tone: "bad" },
    { key: "verificationUnchecked", label: "Verification unchecked", count: 162, tone: "neutral" },
    { key: "passed", label: "Passed", count: 891, tone: "good" },
    { key: "failed", label: "Failed", count: 22, tone: "bad" },
  ],
  recentIntake: [
    {
      leadUid: "LF-2026-004821",
      sourceLane: "Vendor CSV · Aged",
      state: "TX",
      niche: "Solar",
      proofStatus: "attached",
      verificationStatus: "passed",
      inventoryStatus: "available",
      createdAt: "2026-06-30T14:22:00.000Z",
    },
    {
      leadUid: "LF-2026-004820",
      sourceLane: "Webhook · GHL",
      state: "FL",
      niche: "Insurance",
      proofStatus: "needs_review",
      verificationStatus: "needs_review",
      inventoryStatus: "reserved",
      createdAt: "2026-06-30T13:58:00.000Z",
    },
    {
      leadUid: "LF-2026-004819",
      sourceLane: "Bulk import · Q2 aged",
      state: "CA",
      niche: "HVAC",
      proofStatus: "missing",
      verificationStatus: "unchecked",
      inventoryStatus: "unavailable",
      createdAt: "2026-06-30T13:41:00.000Z",
    },
    {
      leadUid: "LF-2026-004818",
      sourceLane: "Vendor CSV · Fresh",
      state: "AZ",
      niche: "Roofing",
      proofStatus: "attached",
      verificationStatus: "passed",
      inventoryStatus: "delivered",
      createdAt: "2026-06-30T12:15:00.000Z",
    },
    {
      leadUid: "LF-2026-004817",
      sourceLane: "Webhook · GHL",
      state: "GA",
      niche: "Mortgage",
      proofStatus: "rejected",
      verificationStatus: "failed",
      inventoryStatus: "unavailable",
      createdAt: "2026-06-30T11:02:00.000Z",
    },
  ],
  activity: [
    {
      id: "evt-1",
      kind: "lead_received",
      leadUid: "LF-2026-004821",
      summary: "Lead received from vendor CSV lane",
      at: "2026-06-30T14:22:00.000Z",
    },
    {
      id: "evt-2",
      kind: "proof_packet_created",
      leadUid: "LF-2026-004821",
      summary: "Proof packet assembled for verification",
      at: "2026-06-30T14:23:12.000Z",
    },
    {
      id: "evt-3",
      kind: "lead_verified",
      leadUid: "LF-2026-004821",
      summary: "Verification passed — eligible for inventory",
      at: "2026-06-30T14:25:40.000Z",
    },
    {
      id: "evt-4",
      kind: "lead_reserved",
      leadUid: "LF-2026-004820",
      summary: "Reserved for order ORD-8842",
      at: "2026-06-30T13:59:05.000Z",
    },
    {
      id: "evt-5",
      kind: "lead_delivered",
      leadUid: "LF-2026-004818",
      summary: "Delivered to client subaccount via GHL adapter",
      at: "2026-06-30T12:18:33.000Z",
    },
    {
      id: "evt-6",
      kind: "delivery_failed",
      leadUid: "LF-2026-004815",
      summary: "Delivery failed — destination mapping missing",
      at: "2026-06-30T10:44:19.000Z",
    },
  ],
};

export function getLeadFulfillmentOverviewData(): LeadFulfillmentOverviewData {
  return LEAD_FULFILLMENT_MOCK_OVERVIEW;
}
