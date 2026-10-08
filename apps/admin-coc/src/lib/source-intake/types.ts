export type SourceLeadListItem = {
  id: string;
  receivedAt: string;
  sourceProvider: string;
  sourceSystem: string;
  sourceType: string;
  sourceRouteKey: string | null;
  sourceLeadId: string | null;
  leadName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  matched: boolean;
  matchedRuleId: string | null;
  routingAuthority: string | null;
  /** Delivery destination (routing/approval). Null for capture-only rows. */
  destinationClientAccountId: string | null;
  destinationLocationIdGhl: string | null;
  /** True for capture-only Facebook rows (Zapier-first or Meta-first). */
  captureOnly?: boolean;
  intakeMethod?: string | null;
  intakeProvenance?: string | null;
  /** Source client decided by Page ID + Form ID association. Not a delivery destination. */
  sourceClientAccountId?: string | null;
  associationOutcome?: string | null;
  /** Direct Meta Lead Ads only: queue + Graph retrieval state (token-free). */
  metaLeadgenFetch?: MetaLeadgenFetchState | null;
  errorSummary: string | null;
};

export type MetaLeadgenFetchState = {
  state: string | null;
  jobId: string | null;
  attempt: number | null;
  queuedAt: string | null;
  requeuedAt: string | null;
  enqueueFailedAt: string | null;
  fetchStartedAt: string | null;
  fetchFinishedAt: string | null;
  graphOutcome: string | null;
  graphStatus: number | null;
  graphErrorCode: string | null;
  graphErrorMessage: string | null;
  tokenScope: string | null;
  liveDelivery: false;
  capiDispatched: false;
};

export type SourceLeadDetail = SourceLeadListItem & {
  sourceCampaignId: string | null;
  sourceCampaignName: string | null;
  sourceFunnelName: string | null;
  sourceLeadUid: string | null;
  rawPayloadJson: unknown;
  normalizedPayloadJson: unknown;
  routingResultJson: unknown;
  duplicateRiskJson: unknown;
  deliveryResultJson: unknown;
  enrichmentMetadataJson: unknown;
  enrichmentPreview: SourceLeadEnrichmentPreview | null;
  captureReview?: {
    captureOnly: boolean;
    intakeMethod: string | null;
    intakeProvenance?: string | null;
    originalIntakeMethod?: string | null;
    associationOutcome: string | null;
    associationClientAccountId: string | null;
    associationSourceFunnelId?: string | null;
    associationPageId?: string | null;
    associationFormId?: string | null;
    associationExplanation: string | null;
    inventoryTracked: boolean;
    inventorySaleEligible: boolean | string | null;
    inventoryReason: string | null;
    deliveryThisRequestAttempted: boolean | null;
    deliveryHistoricalOutcome: string | null;
    submittedAt: string | null;
    receivedAt: string | null;
  } | null;
  routingDryRunDecisionId: string | null;
  normalizedAt: string | null;
  routedAt: string | null;
  approvedAt: string | null;
  deliveredAt: string | null;
  approvedBy: string | null;
};

export type SourceLeadEnrichmentPreview = {
  intakeStatus: string;
  enrichmentStatus: string;
  automationReadiness: string;
  sourceSchemaStatus: string;
  deliveryEligible: boolean;
  deliveryBlockers: string[];
  deliveryWarnings: string[];
  mappedFieldCount: number;
  missingOptionalFields: string[];
  missingAiContextFields: string[];
  unmappedSourceFieldKeys: string[];
  schemaDriftWarnings: string[];
  duplicateBlocksDelivery: boolean;
  duplicateBlocksLiveDelivery: boolean;
  coreDelivery: {
    namePresent: boolean;
    phonePresent: boolean;
    routeMatched: boolean;
  };
  automation: {
    standardWorkflowReady: boolean;
    voiceAiReady: boolean;
    voiceAiLimited: boolean;
  };
};

export type SourceLeadListResponse = {
  ok: boolean;
  items: SourceLeadListItem[];
  nextCursor: string | null;
};

export const SOURCE_LEAD_APPROVE_CONFIRMATION = "APPROVE SOURCE LEAD DELIVERY";

export type SourceLeadApproveMode = "simulate" | "live_canary";
