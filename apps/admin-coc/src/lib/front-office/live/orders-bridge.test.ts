import test from "node:test";
import assert from "node:assert/strict";

import { getMockOrders } from "../mock/orders";
import {
  getLeadOrdersLiveWithFetchers,
  getLeadOrdersWithFallback,
  mapApiLeadOrderToFrontOffice,
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

test("maps admin payment confirmation fields from the PR #90 presenter", () => {
  const mapped = mapApiLeadOrderToFrontOffice({
    id: "ord_1",
    orderNumber: "LO-1001",
    clientAccountId: "acct_pacific",
    clientDisplayName: "Pacific Solar Co",
    status: "submitted",
    nicheKey: "Solar",
    states: ["AZ"],
    leadVolume: 100,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro",
    aiVoiceAddon: false,
    deliveryDestinationLabel: "GHL",
    createdAt: "2026-08-27T12:00:00.000Z",
    submittedAt: "2026-08-27T12:00:00.000Z",
    approvedAt: null,
    paymentConfirmationStatus: "confirmed",
    paymentConfirmedAt: "2026-08-27T13:00:00.000Z",
    paymentConfirmedBy: "Operator",
  });
  assert.equal(mapped.paymentConfirmationStatus, "confirmed");
  assert.equal(mapped.paymentConfirmedAt, "2026-08-27T13:00:00.000Z");
  assert.equal(mapped.clientName, "Pacific Solar Co");
  assert.equal(mapped.orderNumber, "LO-1001");
  assert.equal(mapped.niche, "Solar");
  assert.equal(mapped.availabilityInterest, null);
});

test("maps coming-soon interest without exposing the notes marker", () => {
  const mapped = mapApiLeadOrderToFrontOffice({
    id: "ord_interest",
    orderNumber: "LO-2001",
    clientAccountId: "acct_vet",
    clientDisplayName: "Valley Vet",
    status: "submitted",
    nicheKey: "vet_fex",
    states: ["TX"],
    leadVolume: 50,
    campaignType: "Live transfer",
    crmPackage: "lead_delivery",
    aiVoiceAddon: false,
    deliveryDestinationLabel: "Valley Vet",
    notes:
      'Call after 4\n---\nsa360.availabilityInterest.v1 {"requestedOffering":"live_transfer","notifyWhenAvailable":true,"capturedAt":"2026-10-05T00:00:00.000Z"}',
    createdAt: "2026-10-05T12:00:00.000Z",
    submittedAt: "2026-10-05T12:00:00.000Z",
    paymentConfirmationStatus: "pending_confirmation",
  });
  assert.equal(mapped.niche, "Veteran");
  assert.equal(mapped.notes, "Call after 4");
  assert.equal(String(mapped.notes).includes("sa360.availabilityInterest"), false);
  assert.deepEqual(mapped.availabilityInterest, {
    requestedOffering: "live_transfer",
    notifyWhenAvailable: true,
  });
});

test("sentinel campaign type still presents interest after the notes marker is gone", () => {
  const mapped = mapApiLeadOrderToFrontOffice({
    id: "ord_interest",
    orderNumber: "LO-2002",
    clientAccountId: "acct_vet",
    clientDisplayName: "Valley Vet",
    status: "submitted",
    nicheKey: "vet",
    states: ["TX"],
    leadVolume: 25,
    campaignType: "availability_interest:fresh_leads",
    crmPackage: "lead_delivery",
    aiVoiceAddon: false,
    deliveryDestinationLabel: "Valley Vet",
    notes: "Call after 4",
    createdAt: "2026-10-05T12:00:00.000Z",
  });
  assert.deepEqual(mapped.availabilityInterest, {
    requestedOffering: "fresh_leads",
    notifyWhenAvailable: true,
  });
  assert.equal(mapped.notes, "Call after 4");
});
