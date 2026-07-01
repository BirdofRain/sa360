import type {
  NormalizedDeliveryStatus,
  NormalizedGhlContactStatus,
  NormalizedRoutingStatus,
} from "./lead-delivery-status.js";

export type LeadDeliveryDataSource = "live" | "partial_live" | "mock";

export type LeadDeliveryTimelineMilestoneName =
  | "source_lead_received"
  | "lead_created"
  | "lead_matched"
  | "lead_routed"
  | "lead_delivery_started"
  | "lead_delivered"
  | "client_contact_created"
  | "client_workflow_started"
  | "first_touch_sent"
  | "contact_replied"
  | "appointment_set"
  | "appointment_showed"
  | "sold";

export type LeadDeliveryTimelineMilestone = {
  milestone: LeadDeliveryTimelineMilestoneName;
  at?: string;
  status: "complete" | "pending" | "failed" | "skipped";
  detail?: string;
};

export type LeadDeliveryListRow = {
  id: string;
  sourceLeadId: string | null;
  leadUid: string | null;
  contactIdGhl: string | null;
  clientAccountId: string | null;
  clientDisplayName: string | null;
  subaccountIdGhl: string | null;
  leadName: string | null;
  phoneMasked: string | null;
  phoneE164?: string | null;
  emailMasked: string | null;
  email?: string | null;
  sourcePlatform: string;
  sourceType: string;
  campaignId: string | null;
  campaignName: string | null;
  adId: string | null;
  adName: string | null;
  receivedAt: string;
  lastEventAt: string | null;
  lastEventName: string | null;
  matchedClient: string | null;
  routingStatus: NormalizedRoutingStatus;
  deliveryStatus: NormalizedDeliveryStatus;
  ghlContactStatus: NormalizedGhlContactStatus | null;
  workflowStarted: boolean | null;
  appointmentStatus: string | null;
  soldStatus: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  warnings: string[];
  dataSource: LeadDeliveryDataSource;
};

export type LeadDeliveryAttributionBlock = {
  sourceCampaignId: string | null;
  sourceCampaignName: string | null;
  sourceFunnelName: string | null;
  adId: string | null;
  adName: string | null;
  sourceAttributes: Record<string, string | number | boolean | null>;
};

export type LeadDeliveryRoutingBlock = {
  matched: boolean;
  matchType: string | null;
  routingRuleId: string | null;
  routingDryRunDecisionId: string | null;
  destinationClientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  deliveryMode: string | null;
  reason: string | null;
  validationStatus: string | null;
};

export type LeadDeliveryDeliveryBlock = {
  planId: string | null;
  planStatus: string | null;
  deliveryMode: string | null;
  adapterRunId: string | null;
  adapterRunStatus: string | null;
  liveRunId: string | null;
  liveRunStatus: string | null;
  deliveredAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
};

export type LeadDeliveryLifecycleBlock = {
  intakeStatus: string | null;
  enrichmentStatus: string | null;
  automationReadiness: string | null;
  lifecycleStage: string | null;
  agentDisposition: string | null;
  aiStatus: string | null;
};

export type LeadDeliveryAdminDetail = {
  routingDryRunDecisionId: string | null;
  deliveryPlanId: string | null;
  webhookRequestLogId: string | null;
  duplicateRiskSummary: string | null;
  enrichmentWarnings: string[];
};

export type LeadDeliveryDetail = LeadDeliveryListRow & {
  attribution: LeadDeliveryAttributionBlock;
  routing: LeadDeliveryRoutingBlock;
  delivery: LeadDeliveryDeliveryBlock;
  lifecycle: LeadDeliveryLifecycleBlock;
  timeline: LeadDeliveryTimelineMilestone[];
  adminDetail?: LeadDeliveryAdminDetail;
};

export type LeadDeliveryListResponse = {
  ok: true;
  items: LeadDeliveryListRow[];
  nextCursor: string | null;
};

export type LeadDeliveryDetailResponse = {
  ok: true;
  item: LeadDeliveryDetail;
};
