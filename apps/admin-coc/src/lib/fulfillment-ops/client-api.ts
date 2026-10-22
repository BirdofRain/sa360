import type { PplPricingCatalog } from "@/lib/fulfillment-ops/ppl-pricing-catalog";
import type {
  ApiResult,
  FulfillmentOpsEligibilityPreview,
  FulfillmentOpsEvidence,
  FulfillmentOpsOrder,
  FulfillmentOpsPrepareResult,
} from "@/lib/fulfillment-ops/types";

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text.slice(0, 280) };
  }
}

function asError(payload: unknown, fallback: string): ApiResult<never> {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return {
    ok: false,
    error: typeof obj.error === "string" ? obj.error : fallback,
    details: obj.details ?? obj,
  };
}

export async function clientFetchPplPricingCatalog(): Promise<ApiResult<PplPricingCatalog>> {
  const res = await fetch("/api/fulfillment-ops/ppl-pricing", { cache: "no-store" });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  const catalog = (payload as { catalog?: PplPricingCatalog }).catalog;
  if (!catalog?.activeAgedBuckets) {
    return { ok: false, error: "pricing_catalog_unavailable" };
  }
  return { ok: true, data: catalog };
}

export async function clientListOrders(): Promise<ApiResult<FulfillmentOpsOrder[]>> {
  const res = await fetch("/api/fulfillment-ops/orders", { cache: "no-store" });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  const items = (payload as { items?: FulfillmentOpsOrder[] }).items ?? [];
  return { ok: true, data: items };
}

export async function clientCreateDemoOrder(
  body: Record<string, unknown>
): Promise<ApiResult<FulfillmentOpsOrder>> {
  return clientCreateClientLeadOrder(body);
}

/** Create a real internal client PPL order for CSV/manual fulfillment. */
export async function clientCreateClientLeadOrder(
  body: Record<string, unknown>
): Promise<ApiResult<FulfillmentOpsOrder>> {
  const res = await fetch("/api/fulfillment-ops/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: (payload as { item: FulfillmentOpsOrder }).item };
}

export async function clientRecordPortalAgePriceReview(orderId: string): Promise<
  ApiResult<{
    priceReviewedAt: string;
    priceReviewedBy: string;
    unitPriceCents: null;
    alreadyReviewed: boolean;
  }>
> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/review-portal-age-price`,
    { method: "POST" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  const item = (payload as { item?: { priceReviewedAt: string; priceReviewedBy: string; unitPriceCents: null; alreadyReviewed: boolean } }).item;
  if (!item?.priceReviewedAt) return { ok: false, error: "price_review_unavailable" };
  return { ok: true, data: item };
}

export async function clientActivateOrder(
  orderId: string
): Promise<ApiResult<FulfillmentOpsOrder>> {
  const res = await fetch(`/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/activate`, {
    method: "POST",
  });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: (payload as { order: FulfillmentOpsOrder }).order };
}

export async function clientEligibilityPreview(
  orderId: string
): Promise<ApiResult<FulfillmentOpsEligibilityPreview>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/eligibility-preview`,
    { cache: "no-store" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: (payload as { preview: FulfillmentOpsEligibilityPreview }).preview };
}

export async function clientPrepareCandidate(input: {
  leadOrderId: string;
  inventoryItemId: string;
}): Promise<ApiResult<FulfillmentOpsPrepareResult>> {
  const res = await fetch("/api/fulfillment-ops/prepare-candidate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as FulfillmentOpsPrepareResult };
}

export async function clientReserveAllocation(
  allocationId: string
): Promise<ApiResult<Record<string, unknown>>> {
  const res = await fetch(
    `/api/fulfillment-ops/allocations/${encodeURIComponent(allocationId)}/reserve`,
    { method: "POST" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as Record<string, unknown> };
}

export async function clientSimulateInstruction(
  instructionId: string
): Promise<ApiResult<Record<string, unknown>>> {
  const res = await fetch(
    `/api/fulfillment-ops/instructions/${encodeURIComponent(instructionId)}/simulate`,
    { method: "POST" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as Record<string, unknown> };
}

export async function clientFetchEvidence(
  allocationId: string
): Promise<ApiResult<FulfillmentOpsEvidence>> {
  const res = await fetch(
    `/api/fulfillment-ops/allocations/${encodeURIComponent(allocationId)}/evidence`,
    { cache: "no-store" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: (payload as { evidence: FulfillmentOpsEvidence }).evidence };
}

export async function clientFetchOrderLatestEvidence(
  orderId: string
): Promise<ApiResult<FulfillmentOpsEvidence | null>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/latest-evidence`,
    { cache: "no-store" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: (payload as { evidence: FulfillmentOpsEvidence | null }).evidence ?? null };
}

export type PplExclusionCounts = {
  sameBuyerPriorDelivery: number;
  currentBatchDuplicate: number;
  protectedAgent: number;
  invalidIdentity: number;
  unavailableInventory: number;
  ageBucketMismatch: number;
  notBuyerReady?: number;
  phoneMissing?: number;
  phoneTruncated?: number;
  phoneOverlong?: number;
  phoneStructurallyInvalid?: number;
  nameHasDigits?: number;
  nameReviewFlagged?: number;
};

export type InventorySelectionFunnelReport = {
  orderId: string;
  orderNumber: string;
  nicheKey: string;
  nicheDisplayName: string | null;
  nicheAliases: string[];
  nicheMatchPolicy: string;
  states: string[];
  commerceAgeBucketKeys: string[];
  ageDayRanges: Array<{ minDaysInclusive: number; maxDaysExclusive: number | null }>;
  requestedQuantity: number;
  evaluatedAt: string;
  stages: {
    nicheMatch: number;
    states: number;
    ageBucket: number;
    inventoryClassAged: number;
    activeLot: number;
    status: {
      available: number;
      pending_review: number;
      reserved: number;
      committed: number;
      other: number;
    };
    commerceExcludedAt: { set: number; null: number };
    commerceIncluded: number;
    validIdentity: number;
    invalidIdentity: number;
    buyerReady: {
      ready: number;
      rejected: number;
      missing_consumer_age: number;
      first_name_too_short: number;
      last_name_too_short: number;
      first_name_multipart: number;
      last_name_multipart: number;
      first_name_has_digits?: number;
      last_name_has_digits?: number;
      phone_missing?: number;
      phone_truncated?: number;
      phone_overlong?: number;
      phone_structurally_invalid?: number;
      name_review_flagged?: number;
    };
    protectedAgentExcluded: number;
    afterProtectedAgent: number;
    originClientExcluded: number;
    afterOriginClient: number;
    sameBuyerPriorDelivery: number;
    afterSameBuyer: number;
    withinSelectionDuplicate: number;
    finalEligible: number;
  };
  otherwiseEligibleBlockedByMissingConsumerAge: number;
  eligibleMissingConsumerAge: number;
  recoverableStoredConsumerAge: number;
  noStoredConsumerAge: number;
  pendingReviewConsumerAge: {
    scanned: number;
    normalizedReadable: number;
    recoverableFromStoredSource: number;
    noStoredConsumerAge: number;
  };
  agedImportFieldLoss: {
    summary: string;
    historicalCanonicalMappingOmittedConsumerAge: boolean;
    currentCanonicalMappingSupportsConsumerAge: boolean;
    historicalRawPayloadRetainsSourceCells: boolean;
    historicalInitialStatus: string;
  };
  causes: {
    inventoryActivation: boolean;
    importFieldLoss: boolean;
    buyerReadyPolicy: boolean;
  };
  primaryDisappearance: string;
  summary: string;
  cohortScanTruncated: boolean;
};

export type PplSelectionDiagnostics = {
  rowsScanned: number;
  pagesRead: number;
  eligibleQuantity: number;
  selectedQuantity: number;
  shortfallQuantity: number;
  scanCeilingHit: boolean;
  selectionComplete: boolean;
};

export type PplSelectionEconomics = {
  requestedQuantity: number;
  selectedQuantity: number;
  shortfallQuantity: number;
  unitPriceCents: number;
  requestedOrderValueCents: number;
  deliveredValueCents: number;
  potentialCreditCents: number | null;
  creditStatus: "confirmed_shortfall" | "search_incomplete" | "exact_fill";
  label: string;
};

export type PplSelectionResult = {
  ok: true;
  orderId: string;
  requestedQuantity: number;
  selectedQuantity: number;
  eligibleQuantity: number;
  shortfallQuantity: number;
  selectedItemIds: string[];
  allocationIds?: string[];
  commerceAgeBucketKeys: string[];
  exclusionCounts?: PplExclusionCounts;
  diagnostics?: PplSelectionDiagnostics;
  inventoryFunnel?: InventorySelectionFunnelReport;
  economics?: PplSelectionEconomics;
  pricedCommerceAgeBucketKey?: string;
  unitPriceCents?: number;
  pricingVersion?: string;
};

/** Domain failure payload from selection preview/commit (HTTP 409). */
export type PplSelectionFailure = {
  ok: false;
  code: string;
  reasons?: string[];
  requestedQuantity?: number;
  eligibleQuantity?: number;
  selectedQuantity?: number;
  shortfallQuantity?: number;
  exclusionCounts?: PplExclusionCounts;
  diagnostics?: PplSelectionDiagnostics;
  inventoryFunnel?: InventorySelectionFunnelReport;
};

function asSelectionError(
  payload: unknown,
  fallback: string
): ApiResult<never> & { selectionFailure?: PplSelectionFailure } {
  const obj = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const code = typeof obj.code === "string" ? obj.code : undefined;
  const selectionFailure =
    code != null
      ? ({
          ok: false as const,
          code,
          reasons: Array.isArray(obj.reasons)
            ? obj.reasons.filter((value): value is string => typeof value === "string")
            : undefined,
          requestedQuantity:
            typeof obj.requestedQuantity === "number" ? obj.requestedQuantity : undefined,
          eligibleQuantity:
            typeof obj.eligibleQuantity === "number" ? obj.eligibleQuantity : undefined,
          selectedQuantity:
            typeof obj.selectedQuantity === "number" ? obj.selectedQuantity : undefined,
          shortfallQuantity:
            typeof obj.shortfallQuantity === "number" ? obj.shortfallQuantity : undefined,
          exclusionCounts: obj.exclusionCounts as PplExclusionCounts | undefined,
          diagnostics: obj.diagnostics as PplSelectionDiagnostics | undefined,
          inventoryFunnel: obj.inventoryFunnel as InventorySelectionFunnelReport | undefined,
        } satisfies PplSelectionFailure)
      : undefined;
  return {
    ok: false,
    error: code ?? (typeof obj.error === "string" ? obj.error : fallback),
    details: obj.details ?? obj,
    selectionFailure,
  };
}

export type BuyerAvailabilityTier = {
  commerceAgeBucketKey: string;
  minDaysInclusive: number;
  maxDaysExclusive: number | null;
  eligible: number | null;
  classified: number;
  countSemantics: "exact" | "lower_bound" | "not_reached";
};

export type BuyerAvailabilityCounted = {
  count: number;
  countSemantics: "exact" | "lower_bound";
};

export type BuyerInventoryAvailabilityReport = {
  ok: true;
  readOnly: true;
  evaluatedAt: string;
  snapshot?: {
    isolation: "repeatable_read";
    consistent: true;
    readOnly: true;
    scope: "transaction_start";
  };
  buyer: { clientAccountId: string; clientDisplayName: string };
  nicheKey: string;
  states: string[];
  allAgedTiers: boolean;
  queryCompleteness: "complete" | "incomplete";
  eligibleCountSemantics: "exact" | "lower_bound";
  eligibleTotal: number;
  ageTiers: BuyerAvailabilityTier[];
  structuralCohort: {
    countSemantics: "exact";
    rows: number;
    availableActiveLot: number;
    reserved: number;
    committed: number;
    commerceExcluded: number;
    openAllocationOnAvailable: number;
    stampedSameOrigin: number;
    stampedOtherOrigin: number;
    unstampedSelectable: number;
    unstampedNotReconcilable: number;
  };
  exclusionReasons: Record<string, BuyerAvailabilityCounted | Record<string, number>>;
  provenance: {
    stampedConfirmed: number;
    reconciledFromSourceFunnel: number;
    unresolvedOrigin: number;
    unresolvedReasons: Record<string, number>;
    unstampedNotClassified: number;
    coverageNote: string;
  };
  scan: {
    rowsClassified: number;
    selectableRowsExact: number;
    rowsUnclassified: number;
    ceilingHit: boolean;
    usesSelectionRowCap: false;
  };
  summary: string;
};

export async function clientLookupBuyerAvailability(
  body: Record<string, unknown>
): Promise<ApiResult<BuyerInventoryAvailabilityReport>> {
  const res = await fetch("/api/fulfillment-ops/buyer-availability", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as BuyerInventoryAvailabilityReport };
}

export async function clientPplSelectionPreview(
  orderId: string,
  body: Record<string, unknown>
): Promise<ApiResult<PplSelectionResult> & { selectionFailure?: PplSelectionFailure }> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/selection/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asSelectionError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as PplSelectionResult };
}

export async function clientPplSelectionCommit(
  orderId: string,
  body: Record<string, unknown>
): Promise<ApiResult<PplSelectionResult> & { selectionFailure?: PplSelectionFailure }> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/selection/commit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asSelectionError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as PplSelectionResult };
}

export type PplExportPreviewResult = {
  ok: true;
  orderId: string;
  clientAccountId: string;
  orderNumber: string;
  rowCount: number;
  allocationIds: string[];
  fieldSchemaVersion: string;
  contentSha256: string;
  columns: string[];
  niche?: string;
  optionalFieldCoverage?: Record<string, { populated: number; total: number }>;
};

export type PplExportCommitResult = {
  ok: true;
  exportId: string;
  orderId: string;
  clientAccountId: string;
  orderNumber: string;
  rowCount: number;
  allocationIds: string[];
  fieldSchemaVersion: string;
  contentSha256: string;
  filename: string;
  idempotentReplay: boolean;
};

export async function clientPplExportPreview(
  orderId: string
): Promise<ApiResult<PplExportPreviewResult>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/exports/preview`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as PplExportPreviewResult };
}

export async function clientPplExportCommit(
  orderId: string,
  body: Record<string, unknown>
): Promise<ApiResult<PplExportCommitResult>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/exports/commit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as PplExportCommitResult };
}

export function pplExportDownloadUrl(exportId: string): string {
  return `/api/fulfillment-ops/exports/${encodeURIComponent(exportId)}/download`;
}

export type PplCustomerNotification = {
  status: string;
  reason?: string;
};

export type PplSpreadsheetDeliveryResult = {
  ok: true;
  exportId: string;
  orderId: string;
  clientAccountId: string;
  contentSha256: string;
  allocationIds: string[];
  identityCount: number;
  evidenceNote: string;
  deliveredAt: string;
  deliveredBy: string | null;
  idempotentReplay: boolean;
  externalWriteOccurred: false;
  customerNotification?: PplCustomerNotification;
};

export async function clientPplMarkSpreadsheetDelivered(
  exportId: string,
  body: Record<string, unknown>
): Promise<ApiResult<PplSpreadsheetDeliveryResult>> {
  const res = await fetch(
    `/api/fulfillment-ops/exports/${encodeURIComponent(exportId)}/mark-spreadsheet-delivered`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as PplSpreadsheetDeliveryResult };
}

export type PplReplacementItem = {
  id: string;
  clientAccountId: string;
  leadOrderId: string;
  originalAllocationId: string;
  originalInventoryItemId: string | null;
  status: string;
  reason: string;
  reasonCode: string;
  replacementAllocationId: string | null;
  replacementInventoryItemId: string | null;
  decisionNote: string | null;
  requestId: string;
  createdAt: string;
};

export async function clientPplReplacementRequest(
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: PplReplacementItem; idempotentReplay: boolean }>> {
  const res = await fetch("/api/fulfillment-ops/replacements", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return {
    ok: true,
    data: payload as { ok: true; item: PplReplacementItem; idempotentReplay: boolean },
  };
}

export async function clientPplReplacementPreview(
  id: string
): Promise<ApiResult<Record<string, unknown>>> {
  const res = await fetch(
    `/api/fulfillment-ops/replacements/${encodeURIComponent(id)}/preview`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as Record<string, unknown> };
}

export async function clientPplReplacementDecision(
  id: string,
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: PplReplacementItem; idempotentReplay: boolean }>> {
  const res = await fetch(
    `/api/fulfillment-ops/replacements/${encodeURIComponent(id)}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return {
    ok: true,
    data: payload as { ok: true; item: PplReplacementItem; idempotentReplay: boolean },
  };
}

export async function clientPplListReplacements(
  orderId: string
): Promise<ApiResult<PplReplacementItem[]>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/replacements`
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  const items = (payload as { items?: PplReplacementItem[] }).items ?? [];
  return { ok: true, data: items };
}

export type OperatorReviewItem = {
  id: string;
  allocationId: string;
  role: string;
  status: string;
  rejectionReason: string | null;
  reviewFlags: string[];
};

export type OperatorReviewBatch = {
  id: string;
  status: string;
  purchasedQuantity: number;
  bufferQuantity: number;
  acceptedCount: number;
  rejectedCount: number;
  unusedBufferCount: number;
  shortfallCount: number;
  billedQuantity: number | null;
  billingStatus: string;
  items: OperatorReviewItem[];
  rejectionReport: {
    billedQuantity: null;
    billingNote: string;
    rejectionReasons: Record<string, number>;
  };
};

export async function clientOperatorReviewList(
  orderId: string
): Promise<ApiResult<OperatorReviewBatch[]>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/operator-review`
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: (payload as { items?: OperatorReviewBatch[] }).items ?? [] };
}

export async function clientOperatorReviewOpen(
  orderId: string,
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: OperatorReviewBatch; idempotentReplay: boolean }>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/operator-review`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return {
    ok: true,
    data: payload as { ok: true; item: OperatorReviewBatch; idempotentReplay: boolean },
  };
}

export async function clientOperatorReviewDecide(
  itemId: string,
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: OperatorReviewItem; batch: OperatorReviewBatch }>> {
  const res = await fetch(
    `/api/fulfillment-ops/operator-review/items/${encodeURIComponent(itemId)}/decision`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return {
    ok: true,
    data: payload as { ok: true; item: OperatorReviewItem; batch: OperatorReviewBatch },
  };
}

export async function clientOperatorReviewClose(
  batchId: string,
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: OperatorReviewBatch }>> {
  const res = await fetch(
    `/api/fulfillment-ops/operator-review/batches/${encodeURIComponent(batchId)}/close`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as { ok: true; item: OperatorReviewBatch } };
}

export const OPERATOR_REJECTION_REASON_CODES = [
  "phone_quality",
  "name_quality",
  "placeholder_identity",
  "duplicate",
  "wrong_demographic",
  "structurally_invalid",
] as const;

export async function clientOperatorReviewFillShortfall(
  batchId: string,
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: OperatorReviewBatch; supplemental?: { id: string } }>> {
  const res = await fetch(
    `/api/fulfillment-ops/operator-review/batches/${encodeURIComponent(batchId)}/shortfall`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return {
    ok: true,
    data: payload as { ok: true; item: OperatorReviewBatch; supplemental?: { id: string } },
  };
}

export async function clientOperatorReviewDownloadSupplemental(
  supplementalId: string
): Promise<ApiResult<{ filename: string; csv: string }>> {
  const res = await fetch(
    `/api/fulfillment-ops/operator-review/supplementals/${encodeURIComponent(supplementalId)}/download`
  );
  if (!res.ok) {
    const payload = await parseJson(res);
    return asError(payload, `HTTP ${res.status}`);
  }
  const csv = await res.text();
  const disposition = res.headers.get("content-disposition") ?? "";
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  return {
    ok: true,
    data: {
      filename: filenameMatch?.[1] ?? `sa360-supplemental_${supplementalId}.csv`,
      csv,
    },
  };
}

export type ExternalReceiptBatch = {
  id: string;
  status: string;
  applyMode: string;
  sourceFilename: string | null;
  contentChecksum: string | null;
  occupiedRowCount: number;
  uniqueLeadCount: number;
  extraOccupiedRowCount: number;
  connectedIdentityCount?: number;
  identityConflictCount?: number;
  blankRowCount: number;
  headerRowCount?: number;
  malformedCount?: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousCount?: number;
  rejectedBeforeDeliveryCount: number;
  confirmedUnmatchedCount?: number;
  sourceEvidence?: string | null;
  unmatchedDeliveriesConfirmed?: boolean;
  receipts?: Array<{
    rowNumber: number;
    occupancyStatus: string;
    matchStatus: string;
    applyStatus: string;
    deliveryEvidenceStatus?: string;
  }>;
  wroteBuyerDeliveredIdentity: false;
};

export async function clientExternalReceiptPreview(
  clientAccountId: string,
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: ExternalReceiptBatch }>> {
  const res = await fetch(
    `/api/fulfillment-ops/external-receipts/preview?clientAccountId=${encodeURIComponent(clientAccountId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as { ok: true; item: ExternalReceiptBatch } };
}

export async function clientExternalReceiptBatch(
  batchId: string,
  page?: { offset?: number; limit?: number }
): Promise<ApiResult<{ ok: true; item: ExternalReceiptBatch; receiptTotal: number }>> {
  const params = new URLSearchParams();
  if (page?.offset != null) params.set("offset", String(page.offset));
  if (page?.limit != null) params.set("limit", String(page.limit));
  const query = params.toString();
  const res = await fetch(
    `/api/fulfillment-ops/external-receipts/${encodeURIComponent(batchId)}${query ? `?${query}` : ""}`
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as { ok: true; item: ExternalReceiptBatch; receiptTotal: number } };
}

export async function clientExternalReceiptApply(
  batchId: string,
  body: Record<string, unknown>
): Promise<ApiResult<{ ok: true; item: ExternalReceiptBatch }>> {
  const res = await fetch(
    `/api/fulfillment-ops/external-receipts/${encodeURIComponent(batchId)}/apply`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as { ok: true; item: ExternalReceiptBatch } };
}
