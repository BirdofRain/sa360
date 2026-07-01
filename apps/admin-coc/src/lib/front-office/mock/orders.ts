import type { CreateLeadOrderInput, FrontOfficeRole, LeadOrder, LeadOrdersResponse } from "../types";

const SEED_ORDERS: LeadOrder[] = [
  {
    id: "ORD-1042",
    orderNumber: "LO-1042",
    clientName: "Pacific Solar Co",
    clientAccountId: "acct_pacific",
    niche: "Solar",
    states: ["AZ"],
    state: "AZ",
    volume: 500,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro + SA360 routing",
    aiVoiceAddon: true,
    deliveryDestination: "GHL subaccount · Phoenix Solar",
    status: "needs_compliance",
    adminStatus: "needs_compliance",
    createdAt: "2026-06-28T10:00:00.000Z",
  },
  {
    id: "ORD-1041",
    orderNumber: "LO-1041",
    clientName: "Summit Insurance Group",
    clientAccountId: "acct_summit",
    niche: "Insurance",
    states: ["TX"],
    state: "TX",
    volume: 250,
    campaignType: "Fresh leads",
    crmPackage: "GHL Starter + SA360 AI",
    aiVoiceAddon: false,
    deliveryDestination: "GHL subaccount · Summit TX",
    status: "active",
    adminStatus: "active",
    createdAt: "2026-06-15T14:30:00.000Z",
  },
  {
    id: "ORD-1040",
    orderNumber: "LO-1040",
    clientName: "Desert HVAC Pros",
    clientAccountId: "acct_desert",
    niche: "HVAC",
    states: ["NM"],
    state: "NM",
    volume: 150,
    campaignType: "Live transfer",
    crmPackage: "GHL Pro",
    aiVoiceAddon: true,
    deliveryDestination: "GHL subaccount · Desert HVAC",
    status: "ready",
    adminStatus: "ready",
    createdAt: "2026-06-10T09:15:00.000Z",
  },
  {
    id: "ORD-1039",
    orderNumber: "LO-1039",
    clientName: "Summit Insurance Group",
    clientAccountId: "acct_summit",
    niche: "Insurance",
    states: ["FL"],
    state: "FL",
    volume: 100,
    campaignType: "Aged leads",
    crmPackage: "GHL Starter",
    aiVoiceAddon: false,
    deliveryDestination: "GHL subaccount · Summit FL",
    status: "paused",
    adminStatus: "paused",
    createdAt: "2026-05-22T16:45:00.000Z",
  },
];

let mockOrdersExtra: LeadOrder[] = [];

export function getMockOrders(
  role: FrontOfficeRole = "admin"
): LeadOrdersResponse {
  const all = [...SEED_ORDERS, ...mockOrdersExtra];
  const orders =
    role === "client"
      ? all.filter((o) => o.clientName === "Summit Insurance Group")
      : all;
  return { orders, dataSource: "mock" };
}

export function addMockOrder(
  input: CreateLeadOrderInput,
  role: FrontOfficeRole = "admin"
): LeadOrder {
  const states =
    input.states?.length > 0
      ? input.states
      : input.state
        ? [input.state]
        : ["—"];
  const order: LeadOrder = {
    id: `ORD-${1043 + mockOrdersExtra.length}`,
    orderNumber: `LO-${1043 + mockOrdersExtra.length}`,
    clientName: input.clientName ?? (role === "client" ? "Summit Insurance Group" : "New Client"),
    clientAccountId: input.clientAccountId,
    niche: input.niche,
    productType: input.productType,
    states,
    state: states.join(", "),
    volume: input.volume,
    deliveryCadence: input.deliveryCadence,
    campaignType: input.campaignType,
    crmPackage: input.crmPackage,
    aiVoiceAddon: input.aiVoiceAddon,
    requestedStartDate: input.requestedStartDate,
    deliveryDestination: input.deliveryDestination,
    notes: input.notes,
    status: role === "client" ? "submitted" : "needs_setup",
    adminStatus: role === "client" ? "submitted" : "needs_setup",
    createdAt: new Date().toISOString(),
    submittedAt: role === "client" ? new Date().toISOString() : undefined,
  };
  mockOrdersExtra = [order, ...mockOrdersExtra];
  return order;
}
