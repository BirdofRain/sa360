import type { CreateLeadOrderInput, LeadOrder, LeadOrdersResponse } from "../types";

const SEED_ORDERS: LeadOrder[] = [
  {
    id: "ORD-1042",
    clientName: "Pacific Solar Co",
    niche: "Solar",
    state: "AZ",
    volume: 500,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro + SA360 routing",
    aiVoiceAddon: true,
    deliveryDestination: "GHL subaccount · Phoenix Solar",
    adminStatus: "needs_compliance",
    createdAt: "2026-06-28T10:00:00.000Z",
  },
  {
    id: "ORD-1041",
    clientName: "Summit Insurance Group",
    niche: "Insurance",
    state: "TX",
    volume: 250,
    campaignType: "Fresh leads",
    crmPackage: "GHL Starter + SA360 AI",
    aiVoiceAddon: false,
    deliveryDestination: "GHL subaccount · Summit TX",
    adminStatus: "active",
    createdAt: "2026-06-15T14:30:00.000Z",
  },
  {
    id: "ORD-1040",
    clientName: "Desert HVAC Pros",
    niche: "HVAC",
    state: "NM",
    volume: 150,
    campaignType: "Live transfer",
    crmPackage: "GHL Pro",
    aiVoiceAddon: true,
    deliveryDestination: "GHL subaccount · Desert HVAC",
    adminStatus: "ready",
    createdAt: "2026-06-10T09:15:00.000Z",
  },
  {
    id: "ORD-1039",
    clientName: "Summit Insurance Group",
    niche: "Insurance",
    state: "FL",
    volume: 100,
    campaignType: "Aged leads",
    crmPackage: "GHL Starter",
    aiVoiceAddon: false,
    deliveryDestination: "GHL subaccount · Summit FL",
    adminStatus: "paused",
    createdAt: "2026-05-22T16:45:00.000Z",
  },
];

let mockOrdersExtra: LeadOrder[] = [];

export function getMockOrders(
  role: "admin" | "client" | "agent" = "admin"
): LeadOrdersResponse {
  const all = [...SEED_ORDERS, ...mockOrdersExtra];
  const orders =
    role === "client"
      ? all.filter((o) => o.clientName === "Summit Insurance Group")
      : all;
  return { orders, dataSource: "mock" };
}

export function addMockOrder(input: CreateLeadOrderInput): LeadOrder {
  const order: LeadOrder = {
    ...input,
    id: `ORD-${1043 + mockOrdersExtra.length}`,
    adminStatus: "needs_setup",
    createdAt: new Date().toISOString(),
  };
  mockOrdersExtra = [order, ...mockOrdersExtra];
  return order;
}
