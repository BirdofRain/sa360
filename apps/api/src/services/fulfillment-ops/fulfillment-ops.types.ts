export type FulfillmentOpsSafetyPosture = {
  simulationOnly: true;
  liveDeliveryEnabled: false;
  liveDeliveryStatus: "LIVE DISABLED";
  inventoryReviewEnabled: boolean;
  lf2ExecutionEnabled: boolean;
  lf2GhlCanaryEnabled: boolean;
  lf2AllowlistsConfigured: boolean;
  runtimeMode: string;
  nodeEnv: string;
  flags: {
    SA360_LEAD_INVENTORY_REVIEW_ENABLED: boolean;
    SA360_LF2_EXECUTION_ENABLED: boolean;
    SA360_LF2_GHL_CANARY_ENABLED: boolean;
    SA360_LF2_GHL_ALLOWED_CLIENT_IDS: boolean;
    SA360_LF2_GHL_ALLOWED_LOCATION_IDS: boolean;
    SA360_LF2_GHL_ALLOWED_ORDER_IDS: boolean;
    SA360_LF2_GHL_ALLOWED_SOURCE_LANES: boolean;
  };
  safetyMessage: string;
};

export type FulfillmentOpsOrderSummary = {
  id: string;
  orderNumber: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  status: string;
  nicheKey: string;
  productType: string | null;
  states: string[];
  leadVolume: number;
  requestedQuantity: number | null;
  proposedQuantity: number;
  reservedQuantity: number;
  fulfilledQuantity: number;
  remainingCapacity: number | null;
  orderKind: string | null;
  fulfillmentMode: string | null;
  activatedAt: string | null;
  allocationReady: boolean;
  allocationBlockers: string[];
  createdAt: string;
  updatedAt: string;
};

export type FulfillmentOpsCandidateRow = {
  inventoryItemId: string;
  maskedItemId: string;
  sourceLeadEventId: string;
  maskedSourceLeadUid: string | null;
  normalizedState: string;
  nicheKey: string;
  ageDays: number;
  ageBandKey: string | null;
  inventoryStatus: string;
  proofStatus: string | null;
  verificationStatus: string | null;
  duplicateStatus: string | null;
  predictedEligibilityStatus: "eligible" | "review_required" | "ineligible" | "skipped";
  predictedReasonCodes: string[];
  reservationPermitted: boolean;
  warnings: string[];
};

export type FulfillmentOpsEligibilityPreview = {
  order: FulfillmentOpsOrderSummary;
  limitations: string[];
  evaluatedAt: string;
  scanned: number;
  eligibleCount: number;
  excludedCount: number;
  exclusionReasonCounts: Record<string, number>;
  candidates: FulfillmentOpsCandidateRow[];
};

export type FulfillmentOpsPrepareResult =
  | {
      ok: true;
      allocationId: string;
      allocationStatus: string;
      leadOrderId: string;
      sourceLeadEventId: string;
      inventoryItemId: string | null;
      deliveryInstructionId: string;
      deliveryTargetAdapterKey: string;
      simulationReady: boolean;
      createdAllocation: boolean;
      createdInstruction: boolean;
      externalWriteOccurred: false;
      safetyMessage: string;
    }
  | { ok: false; error: string; reasons: string[] };

export type FulfillmentOpsEvidence = {
  allocationId: string;
  allocationStatus: string;
  reservedAt: string | null;
  committedAt: string | null;
  leadOrderId: string;
  orderNumber: string;
  orderCounters: {
    requestedQuantity: number | null;
    proposedQuantity: number;
    reservedQuantity: number;
    fulfilledQuantity: number;
  };
  instructions: Array<{
    id: string;
    status: string;
    adapterKey: string;
    isRequired: boolean;
    attemptCount: number;
    latestAttempt: {
      id: string;
      attemptNumber: number;
      status: string;
      executionMode: string;
      startedAt: string | null;
      completedAt: string | null;
      errorCode: string | null;
      errorSummary: string | null;
    } | null;
  }>;
  simulationAttemptCount: number;
  simulationSucceededCount: number;
  simulationFailedCount: number;
  liveAttemptCount: number;
  externalWriteOccurred: boolean;
  safetyMessage: string;
};
