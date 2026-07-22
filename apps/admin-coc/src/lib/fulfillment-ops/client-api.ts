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
