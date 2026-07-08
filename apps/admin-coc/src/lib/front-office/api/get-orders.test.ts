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

import type { LeadOrder } from "../types";

const input = {
  clientAccountId: "client_1",
  clientName: "Client One",
  niche: "final_expense",
  states: ["NC"],
  volume: 25,
  campaignType: "exclusive",
  crmPackage: "ghl",
  aiVoiceAddon: false,
  deliveryDestination: "Primary",
};

function buildMockOrder(): LeadOrder {
  return {
    id: "mock_1",
    orderNumber: "FO-10001",
    clientName: "Demo Client",
    clientAccountId: "client_1",
    niche: "final_expense",
    states: ["NC"],
    state: "NC",
    volume: 25,
    campaignType: "exclusive",
    crmPackage: "ghl",
    aiVoiceAddon: false,
    deliveryDestination: "Primary",
    status: "submitted",
    adminStatus: "submitted",
    createdAt: new Date().toISOString(),
  };
}

test("createOrder returns explicit failure for client when live create fails", async () => {
  const { createOrder } = await import("./get-orders.ts");
  const prevDemo = process.env.SA360_FRONT_OFFICE_DEMO_MODE;
  delete process.env.SA360_FRONT_OFFICE_DEMO_MODE;
  let mockCalled = false;

  const result = await createOrder(input, "client", "client_1", {
    createLeadOrderLiveImpl: async () => ({
      ok: false,
      code: "live_create_failed",
      error: "API unavailable",
    }),
    addMockOrderImpl: () => {
      mockCalled = true;
      return buildMockOrder();
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
    assert.equal(result.code, "live_create_failed");
  }
  assert.equal(mockCalled, false);

  if (prevDemo !== undefined) process.env.SA360_FRONT_OFFICE_DEMO_MODE = prevDemo;
});

test("createOrder only falls back to mock in explicit admin demo mode", async () => {
  const { createOrder } = await import("./get-orders.ts");
  const prevDemo = process.env.SA360_FRONT_OFFICE_DEMO_MODE;
  process.env.SA360_FRONT_OFFICE_DEMO_MODE = "true";
  let mockCalled = false;

  const result = await createOrder(input, "admin", "client_1", {
    createLeadOrderLiveImpl: async () => ({
      ok: false,
      code: "live_create_failed",
      error: "API unavailable",
    }),
    addMockOrderImpl: () => {
      mockCalled = true;
      return buildMockOrder();
    },
  });

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.dataSource, "mock");
    assert.equal(result.demoMode, true);
    assert.ok(result.warning?.includes("SA360_FRONT_OFFICE_DEMO_MODE=true"));
  }
  assert.equal(mockCalled, true);

  if (prevDemo !== undefined) process.env.SA360_FRONT_OFFICE_DEMO_MODE = prevDemo;
  else delete process.env.SA360_FRONT_OFFICE_DEMO_MODE;
});
