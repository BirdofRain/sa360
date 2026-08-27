import type { CreateLeadOrderInput, FrontOfficeRole, LeadOrder, LeadOrdersResponse } from "../types";

const SEED_ORDERS: LeadOrder[] = [
  {
    id: "ORD-1044",
    orderNumber: "LO-1044",
    clientName: "Pacific Solar Co",
    clientAccountId: "acct_pacific",
    niche: "Solar",
    productType: "Aged exclusive",
    states: ["AZ", "NV"],
    state: "AZ, NV",
    volume: 400,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro + SA360 routing",
    aiVoiceAddon: true,
    deliveryDestination: "GHL subaccount · Phoenix Solar",
    status: "submitted",
    adminStatus: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
    createdAt: "2026-08-27T15:10:00.000Z",
    submittedAt: "2026-08-27T15:10:00.000Z",
  },
  {
    id: "ORD-1043",
    orderNumber: "LO-1043",
    clientName: "Summit Insurance Group",
    clientAccountId: "acct_summit",
    niche: "Insurance",
    productType: "Final expense",
    states: ["TX"],
    state: "TX",
    volume: 200,
    campaignType: "Fresh leads",
    crmPackage: "GHL Starter + SA360 AI",
    aiVoiceAddon: false,
    deliveryDestination: "GHL subaccount · Summit TX",
    status: "submitted",
    adminStatus: "submitted",
    paymentConfirmationStatus: "confirmed",
    paymentConfirmedAt: "2026-08-27T16:05:00.000Z",
    paymentConfirmedBy: "front-office-operator",
    createdAt: "2026-08-26T18:20:00.000Z",
    submittedAt: "2026-08-26T18:20:00.000Z",
  },
  {
    id: "ORD-1042",
    orderNumber: "LO-1042",
    clientName: "Harbor Home Care",
    clientAccountId: "acct_harbor",
    niche: "Home care",
    productType: "Demo retainer",
    states: ["FL"],
    state: "FL",
    volume: 75,
    campaignType: "Aged leads",
    crmPackage: "GHL Starter",
    aiVoiceAddon: false,
    deliveryDestination: "GHL subaccount · Harbor FL",
    notes: "Internal demo — no Stripe charge.",
    status: "submitted",
    adminStatus: "submitted",
    paymentConfirmationStatus: "not_required",
    paymentConfirmedAt: "2026-08-27T12:00:00.000Z",
    paymentConfirmedBy: "front-office-operator",
    createdAt: "2026-08-25T11:00:00.000Z",
    submittedAt: "2026-08-25T11:00:00.000Z",
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
    paymentConfirmationStatus: "confirmed",
    paymentConfirmedAt: "2026-08-20T09:00:00.000Z",
    approvedAt: "2026-08-20T09:05:00.000Z",
    createdAt: "2026-08-10T09:15:00.000Z",
    submittedAt: "2026-08-10T09:15:00.000Z",
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
    paymentConfirmationStatus: "confirmed",
    createdAt: "2026-06-15T14:30:00.000Z",
    submittedAt: "2026-06-15T14:30:00.000Z",
    approvedAt: "2026-06-16T10:00:00.000Z",
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
    paymentConfirmationStatus: "confirmed",
    createdAt: "2026-05-22T16:45:00.000Z",
    submittedAt: "2026-05-22T16:45:00.000Z",
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
  const now = new Date().toISOString();
  const order: LeadOrder = {
    id: `ORD-${1045 + mockOrdersExtra.length}`,
    orderNumber: `LO-${1045 + mockOrdersExtra.length}`,
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
    paymentConfirmationStatus: "pending_confirmation",
    createdAt: now,
    submittedAt: role === "client" ? now : undefined,
  };
  mockOrdersExtra = [order, ...mockOrdersExtra];
  return order;
}
