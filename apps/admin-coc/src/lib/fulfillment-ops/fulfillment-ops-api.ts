import "server-only";

import { adminFetchJson, adminRequestJson, isAdminApiConfigured } from "@/lib/admin-api/server";
import type {
  ApiResult,
  FulfillmentOpsBootstrap,
  FulfillmentOpsEligibilityPreview,
  FulfillmentOpsEvidence,
  FulfillmentOpsOrder,
  FulfillmentOpsPrepareResult,
  FulfillmentOpsSafety,
} from "@/lib/fulfillment-ops/types";

import type { PplPricingCatalog } from "./ppl-pricing-catalog";
import { formatFulfillmentOpsAdminError } from "./fulfillment-ops-error";

export { formatFulfillmentOpsAdminError };

function formatError(status: number, body: string): string {
  return formatFulfillmentOpsAdminError(status, body);
}

const FALLBACK_SAFETY: FulfillmentOpsSafety = {
  simulationOnly: true,
  liveDeliveryEnabled: false,
  liveDeliveryStatus: "LIVE DISABLED",
  inventoryReviewEnabled: false,
  lf2ExecutionEnabled: false,
  lf2GhlCanaryEnabled: false,
  lf2AllowlistsConfigured: false,
  runtimeMode: "unknown",
  nodeEnv: "unknown",
  flags: {},
  safetyMessage: "Simulation only — no external delivery will occur.",
};

const EMPTY_BOOTSTRAP: FulfillmentOpsBootstrap = {
  safety: {
    simulationOnly: true,
    liveDeliveryEnabled: false,
    liveDeliveryStatus: "LIVE DISABLED",
    inventoryReviewEnabled: false,
    lf2ExecutionEnabled: false,
    lf2GhlCanaryEnabled: false,
    lf2AllowlistsConfigured: false,
    runtimeMode: "unknown",
    nodeEnv: "unknown",
    flags: {},
    safetyMessage: "Simulation only — no external delivery will occur.",
  },
  inventory: {
    summary: null,
    review: { featureEnabled: false },
    nicheDistribution: [],
    stateDistribution: [],
    invalidStateReviewCount: 0,
  },
  selectedOrder: null,
  latestEvidence: null,
  orderError: null,
  limitations: [],
};

export async function loadFulfillmentOpsPageData(orderId?: string | null): Promise<{
  bootstrap: FulfillmentOpsBootstrap;
  orders: FulfillmentOpsOrder[];
  clients: Array<{ id: string; label: string }>;
  pricingCatalog: import("./ppl-pricing-catalog").PplPricingCatalog | null;
  pricingError: string | null;
  loadError: string | null;
  dataSource: "live" | "empty";
}> {
  const boot = await loadFulfillmentOpsBootstrap(orderId);
  const bootstrap = boot.bootstrap ?? EMPTY_BOOTSTRAP;
  if (boot.dataSource === "empty") {
    return {
      bootstrap,
      orders: [],
      clients: [],
      pricingCatalog: null,
      pricingError: boot.loadError ?? "pricing_catalog_unavailable",
      loadError: boot.loadError,
      dataSource: "empty",
    };
  }

  const [ordersRes, clientsRes, pricingRes] = await Promise.all([
    fetchFulfillmentOpsOrders(),
    (async () => {
      const { fetchAdminClients } = await import("@/lib/admin-api/server");
      return fetchAdminClients();
    })(),
    fetchFulfillmentOpsPplPricingCatalog(),
  ]);

  const orders = ordersRes.ok ? ordersRes.data : [];
  const clients =
    clientsRes.error || !clientsRes.data
      ? []
      : (clientsRes.data.items ?? [])
          .map((row) => ({
            id: String(row.clientAccountId ?? ""),
            label: String(row.clientDisplayName ?? row.clientAccountId ?? "Client"),
          }))
          .filter((row) => row.id);

  return {
    bootstrap,
    orders,
    clients,
    pricingCatalog: pricingRes.ok ? pricingRes.data : null,
    pricingError: pricingRes.ok ? null : pricingRes.error,
    loadError: boot.loadError,
    dataSource: "live",
  };
}

export async function loadFulfillmentOpsBootstrap(
  orderId?: string | null
): Promise<{
  bootstrap: FulfillmentOpsBootstrap | null;
  loadError: string | null;
  dataSource: "live" | "empty";
}> {
  if (!isAdminApiConfigured()) {
    return {
      bootstrap: {
        safety: FALLBACK_SAFETY,
        inventory: {
          summary: null,
          review: { featureEnabled: false },
          nicheDistribution: [],
          stateDistribution: [],
          invalidStateReviewCount: 0,
        },
        selectedOrder: null,
        latestEvidence: null,
        orderError: null,
        limitations: ["Admin API is not configured for this app."],
      },
      loadError: "Admin API is not configured for this app.",
      dataSource: "empty",
    };
  }

  const qs = orderId?.trim() ? `?orderId=${encodeURIComponent(orderId.trim())}` : "";
  const res = await adminFetchJson<{ ok: boolean } & FulfillmentOpsBootstrap>(
    `/admin/v1/fulfillment-ops/bootstrap${qs}`
  );

  if (!res.ok) {
    return {
      bootstrap: {
        safety: FALLBACK_SAFETY,
        inventory: {
          summary: null,
          review: { featureEnabled: false },
          nicheDistribution: [],
          stateDistribution: [],
          invalidStateReviewCount: 0,
        },
        selectedOrder: null,
        latestEvidence: null,
        orderError: null,
        limitations: [],
        partial: true,
        unavailableSections: [
          {
            section: "bootstrap",
            code: res.status === 504 ? "dependency_timeout" : "admin_api_error",
            summary: formatError(res.status, res.body),
          },
        ],
      },
      loadError: formatError(res.status, res.body),
      dataSource: "empty",
    };
  }

  const unavailable = res.data.unavailableSections ?? [];
  const partialMessage =
    res.data.partial && unavailable.length > 0
      ? unavailable.map((s) => s.summary).join(" ")
      : null;

  return {
    bootstrap: res.data,
    loadError: partialMessage,
    dataSource: "live",
  };
}

export async function fetchFulfillmentOpsPplPricingCatalog(): Promise<
  ApiResult<PplPricingCatalog>
> {
  const res = await adminFetchJson<{ ok: boolean; catalog: PplPricingCatalog }>(
    "/admin/v1/fulfillment-ops/ppl-pricing"
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  if (!res.data.catalog?.activeAgedBuckets) {
    return { ok: false, error: "pricing_catalog_unavailable" };
  }
  return { ok: true, data: res.data.catalog };
}

export async function fetchFulfillmentOpsOrders(): Promise<ApiResult<FulfillmentOpsOrder[]>> {
  const res = await adminFetchJson<{ ok: boolean; items: FulfillmentOpsOrder[] }>(
    "/admin/v1/fulfillment-ops/orders?limit=50"
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  return { ok: true, data: res.data.items ?? [] };
}

export async function createFulfillmentOpsDemoOrder(body: Record<string, unknown>): Promise<
  ApiResult<FulfillmentOpsOrder>
> {
  const res = await adminRequestJson<{ ok: boolean; item: FulfillmentOpsOrder }>(
    "POST",
    "/admin/v1/fulfillment-ops/demo-orders",
    body
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  return { ok: true, data: res.data.item };
}

/** Real internal client PPL order for CSV/manual fulfillment (no live CRM). */
export async function createFulfillmentOpsClientLeadOrder(
  body: Record<string, unknown>
): Promise<ApiResult<FulfillmentOpsOrder>> {
  const res = await adminRequestJson<{ ok: boolean; item: FulfillmentOpsOrder }>(
    "POST",
    "/admin/v1/fulfillment-ops/client-lead-orders",
    body
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  return { ok: true, data: res.data.item };
}

export async function activateFulfillmentOpsOrder(
  orderId: string
): Promise<ApiResult<FulfillmentOpsOrder>> {
  const res = await adminRequestJson<{ ok: boolean; order: FulfillmentOpsOrder }>(
    "POST",
    `/admin/v1/fulfillment-ops/orders/${encodeURIComponent(orderId)}/activate`
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  return { ok: true, data: res.data.order };
}

export async function fetchEligibilityPreview(
  orderId: string
): Promise<ApiResult<FulfillmentOpsEligibilityPreview>> {
  const res = await adminFetchJson<{ ok: boolean; preview: FulfillmentOpsEligibilityPreview }>(
    `/admin/v1/fulfillment-ops/orders/${encodeURIComponent(orderId)}/eligibility-preview`
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  return { ok: true, data: res.data.preview };
}

export async function prepareFulfillmentOpsCandidate(body: {
  leadOrderId: string;
  inventoryItemId: string;
}): Promise<ApiResult<FulfillmentOpsPrepareResult>> {
  const res = await adminRequestJson<FulfillmentOpsPrepareResult>(
    "POST",
    "/admin/v1/fulfillment-ops/prepare-candidate",
    body
  );
  if (!res.ok) {
    let details: unknown;
    try {
      details = JSON.parse(res.body);
    } catch {
      details = res.body;
    }
    return { ok: false, error: formatError(res.status, res.body), details };
  }
  return { ok: true, data: res.data };
}

export async function reserveFulfillmentOpsAllocation(
  allocationId: string
): Promise<ApiResult<Record<string, unknown>>> {
  const res = await adminRequestJson<Record<string, unknown>>(
    "POST",
    `/admin/v1/fulfillment-ops/allocations/${encodeURIComponent(allocationId)}/reserve`
  );
  if (!res.ok) {
    let details: unknown;
    try {
      details = JSON.parse(res.body);
    } catch {
      details = res.body;
    }
    return { ok: false, error: formatError(res.status, res.body), details };
  }
  return { ok: true, data: res.data };
}

export async function simulateFulfillmentOpsInstruction(
  instructionId: string
): Promise<ApiResult<Record<string, unknown>>> {
  const res = await adminRequestJson<Record<string, unknown>>(
    "POST",
    `/admin/v1/fulfillment-ops/instructions/${encodeURIComponent(instructionId)}/simulate`
  );
  if (!res.ok) {
    let details: unknown;
    try {
      details = JSON.parse(res.body);
    } catch {
      details = res.body;
    }
    return { ok: false, error: formatError(res.status, res.body), details };
  }
  return { ok: true, data: res.data };
}

export async function fetchFulfillmentOpsEvidence(
  allocationId: string
): Promise<ApiResult<FulfillmentOpsEvidence>> {
  const res = await adminFetchJson<{ ok: boolean; evidence: FulfillmentOpsEvidence }>(
    `/admin/v1/fulfillment-ops/allocations/${encodeURIComponent(allocationId)}/evidence`
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  return { ok: true, data: res.data.evidence };
}

export async function fetchFulfillmentOpsOrderLatestEvidence(
  orderId: string
): Promise<ApiResult<FulfillmentOpsEvidence | null>> {
  const res = await adminFetchJson<{ ok: boolean; evidence: FulfillmentOpsEvidence | null }>(
    `/admin/v1/fulfillment-ops/orders/${encodeURIComponent(orderId)}/latest-evidence`
  );
  if (!res.ok) return { ok: false, error: formatError(res.status, res.body) };
  return { ok: true, data: res.data.evidence ?? null };
}
