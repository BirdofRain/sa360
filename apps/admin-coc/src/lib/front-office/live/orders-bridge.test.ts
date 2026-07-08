import test from "node:test";
import assert from "node:assert/strict";

import { getMockOrders } from "../mock/orders";
import {
  getLeadOrdersLiveWithFetchers,
  getLeadOrdersWithFallback,
} from "./orders-bridge";

test("Front Office orders adapter falls back to mock on API failure", async () => {
  const failingFetchers = {
    fetchAdminList: async () => ({ items: [], error: "network error" }),
    fetchClientList: async () => ({ items: [], error: "network error" }),
  };

  const result = await getLeadOrdersWithFallback(
    { role: "admin" },
    {},
    failingFetchers,
    {
      liveEnabled: true,
      clientPortalConfigured: false,
      mockOrders: getMockOrders("admin"),
    }
  );
  assert.equal(result.dataSource, "mock");
  assert.ok(result.orders.length > 0);
});

test("empty orders state from live API renders safely", async () => {
  const emptyFetchers = {
    fetchAdminList: async () => ({ items: [], error: null }),
    fetchClientList: async () => ({ items: [], error: null }),
  };

  const live = await getLeadOrdersLiveWithFetchers(
    { role: "admin" },
    {},
    emptyFetchers,
    { liveEnabled: true, clientPortalConfigured: false }
  );
  assert.ok(live);
  assert.equal(live!.orders.length, 0);
  assert.equal(live!.dataSource, "partial_live");

  const fallback = await getLeadOrdersWithFallback(
    { role: "admin" },
    {},
    emptyFetchers,
    {
      liveEnabled: true,
      clientPortalConfigured: false,
      mockOrders: getMockOrders("admin"),
    }
  );
  assert.equal(fallback.orders.length, 0);
  assert.equal(fallback.dataSource, "partial_live");
});

test("mock orders empty filter for unknown client role still safe", () => {
  const mock = getMockOrders("client");
  assert.ok(Array.isArray(mock.orders));
});
