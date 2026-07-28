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
  const res = await fetch("/api/fulfillment-ops/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: (payload as { item: FulfillmentOpsOrder }).item };
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

export type PplSelectionResult = {
  ok: true;
  orderId: string;
  requestedQuantity: number;
  selectedQuantity: number;
  eligibleQuantity: number;
  selectedItemIds: string[];
  allocationIds?: string[];
  commerceAgeBucketKeys: string[];
};

export async function clientPplSelectionPreview(
  orderId: string,
  body: Record<string, unknown>
): Promise<ApiResult<PplSelectionResult>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/selection/preview`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
  return { ok: true, data: payload as PplSelectionResult };
}

export async function clientPplSelectionCommit(
  orderId: string,
  body: Record<string, unknown>
): Promise<ApiResult<PplSelectionResult>> {
  const res = await fetch(
    `/api/fulfillment-ops/orders/${encodeURIComponent(orderId)}/selection/commit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) return asError(payload, `HTTP ${res.status}`);
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
