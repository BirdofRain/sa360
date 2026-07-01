export const LEAD_ORDER_STATUSES = [
  "draft",
  "submitted",
  "needs_setup",
  "needs_compliance",
  "ready",
  "active",
  "paused",
  "completed",
  "canceled",
] as const;

export type LeadOrderStatus = (typeof LEAD_ORDER_STATUSES)[number];

export const LEAD_ORDER_CREATED_BY_ROLES = ["admin", "client", "system"] as const;
export type LeadOrderCreatedByRole = (typeof LEAD_ORDER_CREATED_BY_ROLES)[number];

export type LeadOrderAudience = "admin" | "client";

export type LeadOrderTrustSnapshot = {
  status?: string;
  warnings?: string[];
  checkedAt?: string;
};

export type LeadOrderAdminRow = {
  id: string;
  orderNumber: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  status: LeadOrderStatus;
  nicheKey: string;
  productType: string | null;
  states: string[];
  leadVolume: number;
  deliveryCadence: string | null;
  campaignType: string;
  crmPackage: string;
  aiVoiceAddon: boolean;
  requestedStartDate: string | null;
  deliveryDestinationType: string | null;
  deliveryDestinationLabel: string | null;
  notes: string | null;
  adminNotes: string | null;
  trustStatusSnapshot: LeadOrderTrustSnapshot | null;
  routingRuleId: string | null;
  campaignId: string | null;
  createdByRole: LeadOrderCreatedByRole;
  createdByUserId: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LeadOrderClientRow = Omit<
  LeadOrderAdminRow,
  "adminNotes" | "routingRuleId" | "campaignId" | "createdByUserId" | "trustStatusSnapshot"
> & {
  setupWarnings: string[];
  fulfillmentSummary: string;
};

export type LeadOrderListResponse = {
  ok: true;
  items: LeadOrderAdminRow[] | LeadOrderClientRow[];
  nextCursor: string | null;
};

export type LeadOrderDetailResponse = {
  ok: true;
  item: LeadOrderAdminRow | LeadOrderClientRow;
};

export type LeadOrderCreateResponse = {
  ok: true;
  item: LeadOrderAdminRow | LeadOrderClientRow;
};

export type LeadOrderUpdateResponse = {
  ok: true;
  item: LeadOrderAdminRow;
};

export type LeadOrderStats = {
  submitted: number;
  needsSetup: number;
  active: number;
  paused: number;
};
