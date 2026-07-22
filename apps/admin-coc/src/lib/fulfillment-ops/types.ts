export type FulfillmentOpsSafety = {
  simulationOnly: true;
  liveDeliveryEnabled: false;
  liveDeliveryStatus: "LIVE DISABLED";
  inventoryReviewEnabled: boolean;
  lf2ExecutionEnabled: boolean;
  lf2GhlCanaryEnabled: boolean;
  lf2AllowlistsConfigured: boolean;
  runtimeMode: string;
  nodeEnv: string;
  flags: Record<string, boolean>;
  safetyMessage: string;
};

export type FulfillmentOpsOrder = {
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

export type FulfillmentOpsCandidate = {
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
  order: FulfillmentOpsOrder;
  limitations: string[];
  evaluatedAt: string;
  scanned: number;
  eligibleCount: number;
  excludedCount: number;
  exclusionReasonCounts: Record<string, number>;
  candidates: FulfillmentOpsCandidate[];
};

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

export type FulfillmentOpsBootstrap = {
  safety: FulfillmentOpsSafety;
  inventory: {
    summary: {
      totalItems?: number;
      available?: number;
      reserved?: number;
      committed?: number;
      quarantined?: number;
      expired?: number;
      lotsActive?: number;
      evaluatedAt?: string;
    } | null;
    review: {
      featureEnabled: boolean;
      counts?: {
        pendingReview?: number;
        eligibleNow?: number;
        blocked?: number;
        available?: number;
        quarantined?: number;
        rejected?: number;
      };
      evaluatedAt?: string;
    };
    nicheDistribution: Array<{ nicheKey: string; count: number }>;
    stateDistribution: Array<{ state: string; count: number }>;
  };
  selectedOrder: FulfillmentOpsOrder | null;
  latestEvidence: FulfillmentOpsEvidence | null;
  orderError: string | null;
  limitations: string[];
};

export type FulfillmentOpsPrepareResult = {
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
};

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details?: unknown };
