export type UnifiedLeadDeliveryDataSource = "live" | "partial_live" | "mock";

export type UnifiedLeadDeliveryListRow = {
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
  routingStatus: string;
  deliveryStatus: string;
  ghlContactStatus: string | null;
  workflowStarted: boolean | null;
  appointmentStatus: string | null;
  soldStatus: string | null;
  errorCode: string | null;
  errorSummary: string | null;
  warnings: string[];
  dataSource: UnifiedLeadDeliveryDataSource;
};

export type UnifiedLeadDeliveryTimelineEntry = {
  milestone: string;
  at?: string;
  status: string;
  detail?: string;
};

export type UnifiedLeadDeliveryDetail = UnifiedLeadDeliveryListRow & {
  attribution: {
    sourceCampaignId: string | null;
    sourceCampaignName: string | null;
    sourceFunnelName: string | null;
    adId: string | null;
    adName: string | null;
    sourceAttributes: Record<string, string | number | boolean | null>;
  };
  routing: Record<string, unknown>;
  delivery: Record<string, unknown>;
  lifecycle: Record<string, unknown>;
  timeline: UnifiedLeadDeliveryTimelineEntry[];
  adminDetail?: Record<string, unknown>;
};

export type UnifiedLeadDeliveryListResponse = {
  ok: boolean;
  items: UnifiedLeadDeliveryListRow[];
  nextCursor: string | null;
};

export type UnifiedLeadDeliveryDetailResponse = {
  ok: boolean;
  item: UnifiedLeadDeliveryDetail;
};
