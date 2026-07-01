import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { ADMIN_KEY_HEADER } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { adminLeadOrderRoutes } from "./admin-lead-orders.js";
import { clientPortalRoutes } from "./client-portal.js";
import type { LeadOrderServiceDeps } from "../services/lead-order/lead-order.service.js";
import type { LeadOrderStatus } from "../services/lead-order/lead-order.types.js";

const ADMIN_HEADER = ADMIN_KEY_HEADER;
const CLIENT_HEADER = CLIENT_PORTAL_KEY_HEADER;

type MockOrder = {
  id: string;
  orderNumber: string;
  clientAccountId: string;
  clientDisplayName: string | null;
  status: LeadOrderStatus;
  nicheKey: string;
  productType: string | null;
  states: string[];
  leadVolume: number;
  deliveryCadence: string | null;
  campaignType: string;
  crmPackage: string;
  aiVoiceAddon: boolean;
  requestedStartDate: Date | null;
  deliveryDestinationType: string | null;
  deliveryDestinationLabel: string | null;
  notes: string | null;
  adminNotes: string | null;
  trustStatusSnapshotJson: unknown;
  routingRuleId: string | null;
  campaignId: string | null;
  createdByRole: "admin" | "client" | "system";
  createdByUserId: string | null;
  submittedAt: Date | null;
  approvedAt: Date | null;
  activatedAt: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function makeOrder(overrides: Partial<MockOrder> = {}): MockOrder {
  const now = new Date("2026-07-01T12:00:00.000Z");
  return {
    id: "ord_1",
    orderNumber: "LO-1043",
    clientAccountId: "acct_a",
    clientDisplayName: "Summit Insurance",
    status: "submitted",
    nicheKey: "Insurance",
    productType: null,
    states: ["TX"],
    leadVolume: 250,
    deliveryCadence: null,
    campaignType: "Fresh leads",
    crmPackage: "GHL Starter",
    aiVoiceAddon: false,
    requestedStartDate: null,
    deliveryDestinationType: null,
    deliveryDestinationLabel: "GHL · Summit TX",
    notes: "Client notes",
    adminNotes: "Internal setup pending",
    trustStatusSnapshotJson: null,
    routingRuleId: "rule_1",
    campaignId: "camp_1",
    createdByRole: "client",
    createdByUserId: null,
    submittedAt: now,
    approvedAt: null,
    activatedAt: null,
    pausedAt: null,
    completedAt: null,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function mockDeps(orders: MockOrder[], clientAccountId = "acct_a") {
  return {
    findClientAccountByIdImpl: async (id: string) =>
      id === clientAccountId
        ? {
            clientAccountId: id,
            clientDisplayName: "Summit Insurance",
          }
        : null,
    listLeadOrdersImpl: async (filters: {
      clientAccountId?: string;
      status?: LeadOrderStatus;
      nicheKey?: string;
    }) => {
      let items = [...orders];
      if (filters.clientAccountId) {
        items = items.filter((o) => o.clientAccountId === filters.clientAccountId);
      }
      if (filters.status) items = items.filter((o) => o.status === filters.status);
      if (filters.nicheKey) {
        items = items.filter(
          (o) => o.nicheKey.toLowerCase() === filters.nicheKey!.toLowerCase()
        );
      }
      return { items, nextCursor: null };
    },
    findLeadOrderByIdImpl: async (id: string) => orders.find((o) => o.id === id) ?? null,
    nextLeadOrderNumberImpl: async () => `LO-${1044 + orders.length}`,
    createLeadOrderRecordImpl: async (data: Record<string, unknown>) => {
      const row = makeOrder({
        id: `ord_${orders.length + 1}`,
        orderNumber: String(data.orderNumber ?? "LO-9999"),
        clientAccountId: String(data.clientAccountId),
        clientDisplayName: (data.clientDisplayName as string | null) ?? null,
        status: (data.status as LeadOrderStatus) ?? "submitted",
        nicheKey: String(data.nicheKey),
        states: (data.statesJson as string[]) ?? ["TX"],
        leadVolume: Number(data.leadVolume),
        campaignType: String(data.campaignType),
        crmPackage: String(data.crmPackage),
        deliveryDestinationLabel: String(data.deliveryDestinationLabel),
        notes: (data.notes as string | null) ?? null,
        adminNotes: (data.adminNotes as string | null) ?? null,
        createdByRole: (data.createdByRole as MockOrder["createdByRole"]) ?? "admin",
      });
      orders.push(row);
      return row;
    },
    updateLeadOrderRecordImpl: async (id: string, data: Record<string, unknown>) => {
      const idx = orders.findIndex((o) => o.id === id);
      if (idx < 0) return null;
      const existing = orders[idx]!;
      const updated = {
        ...existing,
        ...(data.status ? { status: data.status as LeadOrderStatus } : {}),
        ...(data.adminNotes !== undefined ? { adminNotes: data.adminNotes as string | null } : {}),
        ...(data.routingRuleId !== undefined
          ? { routingRuleId: data.routingRuleId as string | null }
          : {}),
        updatedAt: new Date(),
      };
      orders[idx] = updated;
      return updated;
    },
  };
}

async function buildAdminApp(orders: MockOrder[]) {
  const app = Fastify({ logger: false });
  await app.register(adminLeadOrderRoutes, {
    prefix: "/admin/v1",
    ...(mockDeps(orders) as unknown as LeadOrderServiceDeps),
  });
  return app;
}

async function buildClientApp(orders: MockOrder[], clientAccountId = "acct_a") {
  const row = {
    clientAccountId,
    clientDisplayName: "Summit Insurance",
    portalEnabled: true,
    portalDisplayName: "Summit",
    portalLoginEmail: "portal@example.com",
    primaryNicheKeys: [],
    primaryProductTypes: [],
    ghlDestination: null,
  };
  const base = createEmptyPrismaMock();
  const prisma = {
    ...base,
    clientAccount: {
      findUnique: async () => row,
      findFirst: async () => row,
    },
  } as unknown as ReturnType<typeof createEmptyPrismaMock>;

  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: "/client/v1",
    tenantDeps: { db: prisma },
    leadOrderDeps: mockDeps(orders) as unknown as LeadOrderServiceDeps,
  });
  return app;
}

test("GET /admin/v1/lead-orders → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp([makeOrder()]);
  const res = await app.inject({ method: "GET", url: "/admin/v1/lead-orders" });
  assert.equal(res.statusCode, 401);
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("admin can list/create/update lead orders", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const orders: MockOrder[] = [makeOrder()];
  const app = await buildAdminApp(orders);

  const list = await app.inject({
    method: "GET",
    url: "/admin/v1/lead-orders",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(list.statusCode, 200);
  const listBody = list.json() as { ok: boolean; items: Array<{ adminNotes?: string }> };
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0]?.adminNotes, "Internal setup pending");

  const create = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders",
    headers: { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" },
    payload: {
      clientAccountId: "acct_b",
      nicheKey: "Solar",
      states: ["AZ"],
      leadVolume: 500,
      campaignType: "Aged leads",
      crmPackage: "GHL Pro",
      deliveryDestinationLabel: "Phoenix Solar",
    },
  });
  assert.equal(create.statusCode, 201);
  assert.equal(orders.length, 2);

  const patch = await app.inject({
    method: "PATCH",
    url: "/admin/v1/lead-orders/ord_1",
    headers: { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" },
    payload: { status: "active", adminNotes: "Activated for demo" },
  });
  assert.equal(patch.statusCode, 200);
  const patchBody = patch.json() as { item: { status: string; adminNotes: string } };
  assert.equal(patchBody.item.status, "active");
  assert.equal(patchBody.item.adminNotes, "Activated for demo");

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("client can list only scoped orders", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_a";

  const orders = [
    makeOrder({ id: "ord_a", clientAccountId: "acct_a" }),
    makeOrder({ id: "ord_b", clientAccountId: "acct_b", clientDisplayName: "Other Co" }),
  ];
  const app = await buildClientApp(orders);

  const res = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { items: Array<{ id: string; adminNotes?: string }> };
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, "ord_a");
  assert.equal(body.items[0]?.adminNotes, undefined);

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("client cannot access cross-client order detail", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const orders = [makeOrder({ id: "ord_b", clientAccountId: "acct_b" })];
  const app = await buildClientApp(orders);

  const res = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_b?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 404);

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("client create defaults to submitted and strips admin fields", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const orders: MockOrder[] = [];
  const app = await buildClientApp(orders);

  const res = await app.inject({
    method: "POST",
    url: "/client/v1/lead-orders?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret", "content-type": "application/json" },
    payload: {
      nicheKey: "HVAC",
      states: ["NM", "AZ"],
      leadVolume: 150,
      campaignType: "Live transfer",
      crmPackage: "GHL Pro",
      deliveryDestinationLabel: "Desert HVAC",
      notes: "Need fast start",
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json() as {
    item: {
      status: string;
      clientAccountId: string;
      adminNotes?: string;
      routingRuleId?: string;
      setupWarnings: string[];
      fulfillmentSummary: string;
    };
  };
  assert.equal(body.item.status, "submitted");
  assert.equal(body.item.clientAccountId, "acct_a");
  assert.equal(body.item.adminNotes, undefined);
  assert.equal(body.item.routingRuleId, undefined);
  assert.ok(Array.isArray(body.item.setupWarnings));
  assert.ok(body.item.fulfillmentSummary.length > 0);
  assert.equal(orders[0]?.status, "submitted");
  assert.equal(orders[0]?.clientAccountId, "acct_a");

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("status transitions do not crash", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const orders = [makeOrder({ status: "submitted" })];
  const app = await buildAdminApp(orders);

  for (const status of [
    "needs_setup",
    "needs_compliance",
    "ready",
    "active",
    "paused",
    "completed",
  ] as LeadOrderStatus[]) {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/v1/lead-orders/ord_1",
      headers: { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" },
      payload: { status },
    });
    assert.equal(res.statusCode, 200, `transition to ${status}`);
  }

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
