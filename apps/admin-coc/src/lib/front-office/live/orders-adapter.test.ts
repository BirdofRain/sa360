import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "server-only") {
    return {};
  }
  return originalLoad.call(this, request, parent, isMain);
};

import type { CreateLeadOrderInput } from "../types";

const input: CreateLeadOrderInput = {
  clientAccountId: "client_1",
  clientName: "Client One",
  niche: "final_expense",
  states: ["NC"],
  volume: 20,
  campaignType: "exclusive",
  crmPackage: "ghl",
  aiVoiceAddon: false,
  deliveryDestination: "Primary",
};

type OrdersFetchers = {
  fetchAdminList: () => Promise<{ items: unknown[]; error: string | null }>;
  fetchAdminDetail: () => Promise<{ item: unknown; error: string | null }>;
  createAdmin: () => Promise<{ item: unknown; error: string | null }>;
  patchAdmin: () => Promise<{ item: unknown; error: string | null }>;
  fetchClientList: () => Promise<{ items: unknown[]; error: string | null }>;
  createClient: () => Promise<{ item: unknown; error: string | null }>;
};

function buildFetchers(overrides: Partial<OrdersFetchers> = {}): OrdersFetchers {
  return {
    fetchAdminList: async () => ({ items: [], error: null }),
    fetchAdminDetail: async () => ({ item: null, error: null }),
    createAdmin: async () => ({ item: null, error: "upstream_error" }),
    patchAdmin: async () => ({ item: null, error: null }),
    fetchClientList: async () => ({ items: [], error: null }),
    createClient: async () => ({ item: null, error: "upstream_error" }),
    ...overrides,
  };
}

function enableLiveBridgeEnv(): Record<string, string | undefined> {
  const snapshot = {
    ADMIN_API_KEY: process.env.ADMIN_API_KEY,
    NEXT_PUBLIC_SA360_API_BASE_URL: process.env.NEXT_PUBLIC_SA360_API_BASE_URL,
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  };
  process.env.ADMIN_API_KEY = "test-admin-key";
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.com";
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined) process.env[key] = value;
    else delete process.env[key];
  }
}

test("createLeadOrderLive returns explicit error when admin create fails", async () => {
  const env = enableLiveBridgeEnv();
  const { createLeadOrderLive } = await import("./orders-adapter.ts");
  const result = await createLeadOrderLive(input, { role: "admin" }, buildFetchers());
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "live_create_failed");
    assert.equal(result.error, "upstream_error");
  }
  restoreEnv(env);
});

test("createLeadOrderLive returns explicit error when client portal is unavailable", async () => {
  const env = enableLiveBridgeEnv();
  const { createLeadOrderLive } = await import("./orders-adapter.ts");
  const prevPortalKey = process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.CLIENT_PORTAL_API_KEY;

  const result = await createLeadOrderLive(
    input,
    { role: "client", clientAccountId: "client_1" },
    buildFetchers()
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "client_portal_not_configured");
  }

  if (prevPortalKey !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevPortalKey;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  restoreEnv(env);
});
