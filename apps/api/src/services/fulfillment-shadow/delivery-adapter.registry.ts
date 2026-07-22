export type DeliveryAdapterValidateResult =
  | { ok: true; readinessStatus: string }
  | { ok: false; readinessStatus: string; reason: string };

export type DeliveryAdapterContract = {
  adapterKey: string;
  validateTarget: (input: {
    configMetadata: Record<string, unknown>;
  }) => DeliveryAdapterValidateResult;
  buildPayload?: (input: Record<string, unknown>) => Record<string, unknown>;
  deliver?: (input: Record<string, unknown>) => Promise<{ ok: boolean }>;
};

const ghlCrmAdapter: DeliveryAdapterContract = {
  adapterKey: "ghl.crm.v1",
  validateTarget: ({ configMetadata }) => {
    const locationId =
      typeof configMetadata.destinationSubaccountIdGhl === "string"
        ? configMetadata.destinationSubaccountIdGhl.trim()
        : "";
    if (!locationId) {
      return { ok: false, readinessStatus: "not_configured", reason: "missing_location_id" };
    }
    return { ok: true, readinessStatus: "ready_for_shadow" };
  },
};

const webhookGenericAdapter: DeliveryAdapterContract = {
  adapterKey: "webhook.generic.v1",
  validateTarget: ({ configMetadata }) => {
    const endpoint =
      typeof configMetadata.endpointUrl === "string" ? configMetadata.endpointUrl.trim() : "";
    if (!endpoint) {
      return { ok: false, readinessStatus: "not_configured", reason: "missing_endpoint_url" };
    }
    return { ok: true, readinessStatus: "ready_for_shadow" };
  },
};

const googleSheetsAdapter: DeliveryAdapterContract = {
  adapterKey: "google_sheets.v1",
  validateTarget: ({ configMetadata }) => {
    const sheetId = typeof configMetadata.sheetId === "string" ? configMetadata.sheetId.trim() : "";
    if (!sheetId) {
      return { ok: false, readinessStatus: "not_configured", reason: "missing_sheet_id" };
    }
    return { ok: true, readinessStatus: "ready_for_shadow" };
  },
};

const fileExportAdapter: DeliveryAdapterContract = {
  adapterKey: "file_export.csv.v1",
  validateTarget: () => ({ ok: true, readinessStatus: "ready_for_shadow" }),
};

/** Simulation-only target used by the Fulfillment Ops Workbench (no external writes). */
const testSimulatedDeliveryAdapter: DeliveryAdapterContract = {
  adapterKey: "test.simulated.v1",
  validateTarget: () => ({ ok: true, readinessStatus: "ready_for_simulation" }),
};

const ADAPTER_REGISTRY = new Map<string, DeliveryAdapterContract>([
  [ghlCrmAdapter.adapterKey, ghlCrmAdapter],
  [webhookGenericAdapter.adapterKey, webhookGenericAdapter],
  [googleSheetsAdapter.adapterKey, googleSheetsAdapter],
  [fileExportAdapter.adapterKey, fileExportAdapter],
  [testSimulatedDeliveryAdapter.adapterKey, testSimulatedDeliveryAdapter],
]);

export function registerDeliveryAdapter(adapter: DeliveryAdapterContract): void {
  ADAPTER_REGISTRY.set(adapter.adapterKey, adapter);
}

export function getDeliveryAdapter(adapterKey: string): DeliveryAdapterContract | null {
  return ADAPTER_REGISTRY.get(adapterKey.trim()) ?? null;
}

export function listRegisteredDeliveryAdapterKeys(): string[] {
  return [...ADAPTER_REGISTRY.keys()].sort();
}
