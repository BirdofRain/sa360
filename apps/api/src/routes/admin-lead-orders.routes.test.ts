import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { ADMIN_KEY_HEADER } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { adminLeadOrderRoutes } from "./admin-lead-orders.js";
import { clientPortalRoutes } from "./client-portal.js";
import type { LeadOrderFulfilledLeadsServiceDeps } from "../services/lead-order/lead-order-fulfilled-leads.service.js";
import type { LeadOrderStatus } from "../services/lead-order/lead-order.types.js";
import type { LeadOrderPaymentConfirmationStatus } from "../services/lead-order/lead-order-lifecycle.js";
import type { LeadDeliveryJoinContext } from "../services/lead-delivery/lead-delivery-read.service.js";

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
  paymentConfirmationStatus: LeadOrderPaymentConfirmationStatus;
  paymentConfirmedAt: Date | null;
  paymentConfirmedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  requestedQuantity?: number | null;
  reservedQuantity?: number;
  fulfilledQuantity?: number;
  committedAllocationCount?: number;
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
    paymentConfirmationStatus: "pending_confirmation",
    paymentConfirmedAt: null,
    paymentConfirmedBy: null,
    createdAt: now,
    updatedAt: now,
    requestedQuantity: null,
    reservedQuantity: 0,
    fulfilledQuantity: 0,
    committedAllocationCount: 0,
    ...overrides,
  };
}

function mockDeps(
  orders: MockOrder[],
  clientAccountId = "acct_a",
  accountStatus = "active"
) {
  return {
    findClientAccountByIdImpl: async (id: string) =>
      id === clientAccountId
        ? {
            clientAccountId: id,
            clientDisplayName: "Summit Insurance",
            status: accountStatus,
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
        paymentConfirmationStatus:
          (data.paymentConfirmationStatus as LeadOrderPaymentConfirmationStatus) ??
          "pending_confirmation",
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
        ...(data.approvedAt !== undefined ? { approvedAt: data.approvedAt as Date | null } : {}),
        ...(data.activatedAt !== undefined ? { activatedAt: data.activatedAt as Date | null } : {}),
        ...(data.paymentConfirmationStatus !== undefined
          ? {
              paymentConfirmationStatus:
                data.paymentConfirmationStatus as LeadOrderPaymentConfirmationStatus,
            }
          : {}),
        ...(data.paymentConfirmedAt !== undefined
          ? { paymentConfirmedAt: data.paymentConfirmedAt as Date | null }
          : {}),
        ...(data.paymentConfirmedBy !== undefined
          ? { paymentConfirmedBy: data.paymentConfirmedBy as string | null }
          : {}),
        updatedAt: new Date(),
      };
      orders[idx] = updated;
      return updated;
    },
  };
}

async function buildAdminApp(orders: MockOrder[], accountStatus = "active") {
  const app = Fastify({ logger: false });
  await app.register(adminLeadOrderRoutes, {
    prefix: "/admin/v1",
    ...(mockDeps(orders, "acct_a", accountStatus) as unknown as LeadOrderFulfilledLeadsServiceDeps),
  });
  return app;
}

async function buildClientApp(
  orders: MockOrder[],
  clientAccountId = "acct_a",
  extraLeadOrderDeps: Partial<LeadOrderFulfilledLeadsServiceDeps> = {},
  accountStatus = "active"
) {
  const accounts = new Map<string, Record<string, unknown>>([
    [
      clientAccountId,
      {
        clientAccountId,
        clientDisplayName: "Summit Insurance",
        status: accountStatus,
        portalEnabled: true,
        portalDisplayName: "Summit",
        portalLoginEmail: "portal@example.com",
        primaryNicheKeys: [],
        primaryProductTypes: [],
        ghlDestination: null,
      },
    ],
    [
      "acct_b",
      {
        clientAccountId: "acct_b",
        clientDisplayName: "Other Buyer",
        status: "active",
        portalEnabled: true,
        portalDisplayName: "Other",
        portalLoginEmail: "other@example.com",
        primaryNicheKeys: [],
        primaryProductTypes: [],
        ghlDestination: null,
      },
    ],
  ]);
  const base = createEmptyPrismaMock();
  const prisma = {
    ...base,
    clientAccount: {
      findUnique: async (args: { where?: { clientAccountId?: string } }) =>
        (args.where?.clientAccountId
          ? accounts.get(args.where.clientAccountId)
          : undefined) ?? null,
      findFirst: async () => accounts.get(clientAccountId) ?? null,
    },
  } as unknown as ReturnType<typeof createEmptyPrismaMock>;

  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: "/client/v1",
    tenantDeps: { db: prisma },
    leadOrderDeps: {
      ...(mockDeps(orders, clientAccountId, accountStatus) as unknown as LeadOrderFulfilledLeadsServiceDeps),
      ...extraLeadOrderDeps,
    },
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
  const listBody = list.json() as {
    ok: boolean;
    items: Array<{
      adminNotes?: string;
      fulfillment?: unknown;
      fulfillmentAvailable?: unknown;
      fulfillmentSummary?: unknown;
    }>;
  };
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0]?.adminNotes, "Internal setup pending");
  assert.equal(listBody.items[0]?.fulfillment, undefined);
  assert.equal(listBody.items[0]?.fulfillmentAvailable, undefined);
  assert.equal(listBody.items[0]?.fulfillmentSummary, undefined);

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
    payload: { adminNotes: "Activated for demo" },
  });
  assert.equal(patch.statusCode, 200);
  const patchBody = patch.json() as { item: { status: string; adminNotes: string } };
  assert.equal(patchBody.item.status, "submitted");
  assert.equal(patchBody.item.adminNotes, "Activated for demo");

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("admin create is not blocked when the client account is onboarding", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const orders: MockOrder[] = [];
  const app = await buildAdminApp(orders, "onboarding");
  const create = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders",
    headers: { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" },
    payload: {
      clientAccountId: "acct_a",
      nicheKey: "Solar",
      states: ["AZ"],
      leadVolume: 25,
      campaignType: "Aged leads",
      crmPackage: "GHL Pro",
      deliveryDestinationLabel: "Phoenix Solar",
    },
  });
  assert.equal(create.statusCode, 201);
  assert.equal(orders.length, 1);
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
      fulfillmentAvailable: boolean;
      fulfillment: unknown;
    };
  };
  assert.equal(body.item.status, "submitted");
  assert.equal(
    (body.item as { paymentConfirmationStatus?: string }).paymentConfirmationStatus,
    "pending_confirmation"
  );
  assert.equal(body.item.clientAccountId, "acct_a");
  assert.equal(body.item.adminNotes, undefined);
  assert.equal(body.item.routingRuleId, undefined);
  assert.ok(Array.isArray(body.item.setupWarnings));
  assert.ok(body.item.fulfillmentSummary.length > 0);
  assert.equal(body.item.fulfillmentAvailable, false);
  assert.equal(body.item.fulfillment, null);
  assert.equal(orders[0]?.status, "submitted");
  assert.equal(orders[0]?.clientAccountId, "acct_a");

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

const CLIENT_CREATE_PAYLOAD = {
  nicheKey: "HVAC",
  states: ["NM", "AZ"],
  leadVolume: 150,
  campaignType: "Live transfer",
  crmPackage: "GHL Pro",
  deliveryDestinationLabel: "Desert HVAC",
  notes: "Need fast start",
  status: "active",
  paymentConfirmationStatus: "confirmed",
  orderKind: "ppl",
};

async function postClientLeadOrder(accountStatus: string) {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const orders: MockOrder[] = [];
  const app = await buildClientApp(orders, "acct_a", {}, accountStatus);
  const res = await app.inject({
    method: "POST",
    url: "/client/v1/lead-orders?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret", "content-type": "application/json" },
    payload: CLIENT_CREATE_PAYLOAD,
  });
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  return { res, orders };
}

test("client create rejects onboarding tenants", async () => {
  const { res, orders } = await postClientLeadOrder("onboarding");
  assert.equal(res.statusCode, 409);
  const body = res.json() as { code?: string; error?: string };
  assert.equal(body.code, "ACCOUNT_NOT_READY_TO_ORDER");
  assert.equal(orders.length, 0);
});

test("client create rejects paused tenants", async () => {
  const { res, orders } = await postClientLeadOrder("paused");
  assert.equal(res.statusCode, 409);
  assert.equal((res.json() as { code?: string }).code, "ACCOUNT_NOT_READY_TO_ORDER");
  assert.equal(orders.length, 0);
});

test("client create rejects archived tenants", async () => {
  const { res, orders } = await postClientLeadOrder("archived");
  assert.equal(res.statusCode, 409);
  assert.equal((res.json() as { code?: string }).code, "ACCOUNT_NOT_READY_TO_ORDER");
  assert.equal(orders.length, 0);
});

test("client create ignores spoofed ready status on the request body", async () => {
  const { res, orders } = await postClientLeadOrder("onboarding");
  assert.equal(res.statusCode, 409);
  assert.equal(orders.length, 0);
});

test("status transitions honor payment and ready prerequisites", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const orders = [makeOrder({ status: "submitted" })];
  const app = await buildAdminApp(orders);
  const headers = { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" };

  for (const status of ["needs_setup", "needs_compliance"] as LeadOrderStatus[]) {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/v1/lead-orders/ord_1",
      headers,
      payload: { status },
    });
    assert.equal(res.statusCode, 200, `transition to ${status}`);
  }

  const blockedReady = await app.inject({
    method: "PATCH",
    url: "/admin/v1/lead-orders/ord_1",
    headers,
    payload: { status: "ready" },
  });
  assert.equal(blockedReady.statusCode, 409);
  assert.equal((blockedReady.json() as { error: string }).error, "payment_confirmation_required");

  const blockedActive = await app.inject({
    method: "PATCH",
    url: "/admin/v1/lead-orders/ord_1",
    headers,
    payload: { status: "active" },
  });
  assert.equal(blockedActive.statusCode, 409);
  assert.equal((blockedActive.json() as { error: string }).error, "activation_requires_ready");

  const confirm = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders/ord_1/confirm-payment",
    headers,
    payload: { confirmedBy: "alex" },
  });
  assert.equal(confirm.statusCode, 200);

  const ready = await app.inject({
    method: "PATCH",
    url: "/admin/v1/lead-orders/ord_1",
    headers,
    payload: { status: "ready" },
  });
  assert.equal(ready.statusCode, 200);
  assert.equal((ready.json() as { item: { status: string } }).item.status, "ready");

  const active = await app.inject({
    method: "PATCH",
    url: "/admin/v1/lead-orders/ord_1",
    headers,
    payload: { status: "active" },
  });
  assert.equal(active.statusCode, 200);
  assert.equal((active.json() as { item: { status: string } }).item.status, "active");

  for (const status of ["paused", "completed"] as LeadOrderStatus[]) {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/v1/lead-orders/ord_1",
      headers,
      payload: { status },
    });
    assert.equal(res.statusCode, 200, `transition to ${status}`);
  }

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("client order detail returns structured fulfillment from committed allocations", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const orders = [
    makeOrder({
      id: "ord_partial",
      requestedQuantity: 25,
      reservedQuantity: 4,
      fulfilledQuantity: 0,
      committedAllocationCount: 5,
      status: "active",
    }),
  ];
  const app = await buildClientApp(orders);

  const res = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_partial?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    item: {
      fulfillmentAvailable: boolean;
      fulfillmentSummary: string;
      fulfillment: {
        requestedQuantity: number;
        fulfilledQuantity: number;
        remainingQuantity: number;
        status: string;
      } | null;
      reservedQuantity?: number;
    };
  };
  assert.equal(body.item.fulfillmentAvailable, true);
  assert.equal(body.item.fulfillmentSummary, "5 of 25 delivered");
  assert.deepEqual(body.item.fulfillment, {
    requestedQuantity: 25,
    fulfilledQuantity: 5,
    remainingQuantity: 20,
    status: "in_progress",
  });
  assert.equal(body.item.reservedQuantity, undefined);

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("client order-linked leads are tenant scoped, masked, and 404 equivalently", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";

  const ownCtx: LeadDeliveryJoinContext = {
    sourceLead: {
      id: "evt_own",
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceType: "lead_form",
      sourceRouteKey: null,
      sourceCampaignId: null,
      sourceCampaignName: null,
      sourceFunnelName: null,
      sourceLeadId: null,
      sourceLeadUid: "uid_own",
      clientAccountIdResolved: "acct_a",
      destinationLocationIdResolved: null,
      routingRuleIdResolved: null,
      status: "delivered",
      rawPayloadJson: {},
      normalizedPayloadJson: {
        contact: { first_name: "Pat", email: "pat@client.com", phone_e164: "+15559876543" },
      },
      routingResultJson: null,
      duplicateRiskJson: null,
      deliveryResultJson: null,
      enrichmentMetadataJson: null,
      routingDryRunDecisionId: null,
      errorSummary: null,
      webhookRequestLogId: null,
      receivedAt: new Date("2026-07-01T10:00:00.000Z"),
      normalizedAt: null,
      routedAt: null,
      approvedAt: null,
      deliveredAt: new Date("2026-07-01T10:05:00.000Z"),
      approvedBy: null,
      bulkImportId: null,
      bulkImportRowId: null,
      cleanupStatus: null,
      cleanupReason: null,
      cleanupMarkedAt: null,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:05:00.000Z"),
    },
    decision: null,
    plan: null,
    adapterRun: null,
    liveRun: null,
    clientDisplayName: "Summit",
    timeline: null,
  };

  const orders = [makeOrder({ id: "ord_a", requestedQuantity: 2, committedAllocationCount: 1 })];
  const app = await buildClientApp(orders, "acct_a", {
    listCommittedAllocationsForOrderImpl: async () => ({
      items: [{ id: "alloc_1", sourceLeadEventId: "evt_own", committedAt: new Date() }],
      nextCursor: null,
    }),
    listLeadDeliveryReadModelByIdsImpl: async () => [ownCtx],
  });

  const ok = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_a/leads?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(ok.statusCode, 200);
  const okBody = ok.json() as {
    items: Array<{
      id: string;
      leadOrderId: string;
      phoneMasked: string;
      emailMasked: string;
      phoneE164?: string;
      adminDetail?: unknown;
    }>;
  };
  assert.equal(okBody.items.length, 1);
  assert.equal(okBody.items[0]?.id, "evt_own");
  assert.equal(okBody.items[0]?.leadOrderId, "ord_a");
  assert.match(okBody.items[0]?.phoneMasked ?? "", /\*\*\*/);
  assert.equal(okBody.items[0]?.emailMasked, "p***@client.com");
  assert.equal(okBody.items[0]?.phoneE164, undefined);
  assert.equal(okBody.items[0]?.adminDetail, undefined);

  const foreign = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_b/leads?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  const missing = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_missing/leads?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(foreign.statusCode, 404);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(foreign.json(), missing.json());
  assert.deepEqual(foreign.json(), { ok: false, error: "Lead order not found" });

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("PPL aged-inventory committed allocations return buyer-safe linked leads", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";

  const agedCtx = (id: string): LeadDeliveryJoinContext => ({
    sourceLead: {
      id,
      sourceProvider: "facebook",
      sourceSystem: "meta_lead_ads",
      sourceType: "lead_form",
      sourceRouteKey: null,
      sourceCampaignId: null,
      sourceCampaignName: null,
      sourceFunnelName: null,
      sourceLeadId: null,
      sourceLeadUid: `uid_${id}`,
      clientAccountIdResolved: "acct_inventory_owner",
      destinationLocationIdResolved: "loc_original",
      routingRuleIdResolved: "rule_original",
      status: "delivered",
      rawPayloadJson: {},
      normalizedPayloadJson: {
        contact: { first_name: "Pat", email: "pat@client.com", phone_e164: "+15559876543" },
      },
      routingResultJson: null,
      duplicateRiskJson: null,
      deliveryResultJson: { contactIdGhl: "ghl_original" },
      enrichmentMetadataJson: null,
      routingDryRunDecisionId: null,
      errorSummary: null,
      webhookRequestLogId: null,
      receivedAt: new Date("2026-07-01T10:00:00.000Z"),
      normalizedAt: null,
      routedAt: null,
      approvedAt: null,
      deliveredAt: new Date("2026-07-01T10:05:00.000Z"),
      approvedBy: null,
      bulkImportId: null,
      bulkImportRowId: null,
      cleanupStatus: null,
      cleanupReason: null,
      cleanupMarkedAt: null,
      createdAt: new Date("2026-07-01T10:00:00.000Z"),
      updatedAt: new Date("2026-07-01T10:05:00.000Z"),
    },
    decision: null,
    plan: null,
    adapterRun: null,
    liveRun: null,
    clientDisplayName: "Original Inventory Owner LLC",
    timeline: null,
  });

  const orders = [
    makeOrder({
      id: "ord_ppl",
      requestedQuantity: 5,
      committedAllocationCount: 2,
      status: "active",
    }),
  ];
  const app = await buildClientApp(orders, "acct_a", {
    listCommittedAllocationsForOrderImpl: async () => ({
      items: [
        { id: "alloc_1", sourceLeadEventId: "evt_aged_1", committedAt: new Date() },
        { id: "alloc_2", sourceLeadEventId: "evt_aged_2", committedAt: new Date() },
      ],
      nextCursor: null,
    }),
    listLeadDeliveryReadModelByIdsImpl: async () => [agedCtx("evt_aged_1"), agedCtx("evt_aged_2")],
  });

  const ok = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_ppl/leads?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(ok.statusCode, 200);
  const okBody = ok.json() as {
    items: Array<{
      id: string;
      leadOrderId: string;
      clientAccountId: string | null;
      clientDisplayName: string | null;
      matchedClient: string | null;
      phoneMasked: string;
      emailMasked: string;
      phoneE164?: string;
      adminDetail?: unknown;
    }>;
  };
  assert.equal(okBody.items.length, 2);
  assert.deepEqual(
    okBody.items.map((row) => row.id),
    ["evt_aged_1", "evt_aged_2"]
  );
  assert.equal(okBody.items[0]?.leadOrderId, "ord_ppl");
  assert.equal(okBody.items[0]?.clientAccountId, "acct_a");
  assert.equal(okBody.items[0]?.clientDisplayName, "Summit Insurance");
  assert.equal(okBody.items[0]?.matchedClient, "Summit Insurance");
  assert.match(okBody.items[0]?.phoneMasked ?? "", /\*\*\*/);
  assert.equal(okBody.items[0]?.emailMasked, "p***@client.com");
  assert.equal(okBody.items[0]?.phoneE164, undefined);
  assert.equal(okBody.items[0]?.adminDetail, undefined);
  assert.doesNotMatch(
    JSON.stringify(okBody),
    /acct_inventory_owner|Original Inventory Owner|alloc_1|rule_original|ghl_original/
  );

  const detail = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_ppl?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(detail.statusCode, 200);
  const detailBody = detail.json() as {
    item: { fulfillmentSummary: string; fulfillment: { fulfilledQuantity: number; requestedQuantity: number } };
  };
  assert.equal(detailBody.item.fulfillmentSummary, "2 of 5 delivered");
  assert.equal(detailBody.item.fulfillment.fulfilledQuantity, 2);
  assert.equal(detailBody.item.fulfillment.requestedQuantity, 5);

  const otherTenant = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_ppl/leads?clientAccountId=acct_b",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  const missing = await app.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_missing/leads?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(otherTenant.statusCode, 404);
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(otherTenant.json(), missing.json());
  assert.deepEqual(otherTenant.json(), { ok: false, error: "Lead order not found" });

  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("customer create is submitted + pending_confirmation and confirm is idempotent", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const orders = [makeOrder({ status: "submitted" })];
  const app = await buildAdminApp(orders);
  const headers = { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" };

  const first = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders/ord_1/confirm-payment",
    headers,
    payload: { confirmedBy: "alex" },
  });
  assert.equal(first.statusCode, 200);
  const firstItem = first.json() as {
    item: {
      paymentConfirmationStatus: string;
      paymentConfirmedBy: string | null;
      paymentConfirmedAt: string | null;
      status: string;
    };
  };
  assert.equal(firstItem.item.status, "submitted");
  assert.equal(firstItem.item.paymentConfirmationStatus, "confirmed");
  assert.equal(firstItem.item.paymentConfirmedBy, "alex");
  assert.ok(firstItem.item.paymentConfirmedAt);

  const repeat = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders/ord_1/confirm-payment",
    headers,
    payload: { confirmedBy: "other" },
  });
  assert.equal(repeat.statusCode, 200);
  const repeatItem = repeat.json() as {
    item: { paymentConfirmationStatus: string; paymentConfirmedBy: string | null };
  };
  assert.equal(repeatItem.item.paymentConfirmationStatus, "confirmed");
  assert.equal(repeatItem.item.paymentConfirmedBy, "alex");

  const approved = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders/ord_1/approve",
    headers,
    payload: {},
  });
  assert.equal(approved.statusCode, 200);
  assert.equal((approved.json() as { item: { status: string } }).item.status, "ready");
  assert.equal(
    (approved.json() as { item: { paymentConfirmationStatus: string } }).item
      .paymentConfirmationStatus,
    "confirmed"
  );

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("mark payment not required then approve; pending cannot approve", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const pending = makeOrder({ id: "ord_pending", status: "submitted" });
  const comp = makeOrder({ id: "ord_comp", status: "submitted" });
  const orders = [pending, comp];
  const app = await buildAdminApp(orders);
  const headers = { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" };

  const blocked = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders/ord_pending/approve",
    headers,
    payload: {},
  });
  assert.equal(blocked.statusCode, 409);
  assert.equal((blocked.json() as { error: string }).error, "payment_confirmation_required");
  assert.equal(pending.status, "submitted");

  const mark = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders/ord_comp/mark-payment-not-required",
    headers,
    payload: { confirmedBy: "alex" },
  });
  assert.equal(mark.statusCode, 200);
  assert.equal(
    (mark.json() as { item: { paymentConfirmationStatus: string } }).item.paymentConfirmationStatus,
    "not_required"
  );

  const approved = await app.inject({
    method: "POST",
    url: "/admin/v1/lead-orders/ord_comp/approve",
    headers,
    payload: {},
  });
  assert.equal(approved.statusCode, 200);
  const approvedItem = approved.json() as {
    item: { status: string; paymentConfirmationStatus: string };
  };
  assert.equal(approvedItem.item.status, "ready");
  assert.equal(approvedItem.item.paymentConfirmationStatus, "not_required");

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("submitted cannot jump to active; ready can activate via PATCH", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const orders = [
    makeOrder({ id: "ord_jump", status: "submitted" }),
    makeOrder({
      id: "ord_ready",
      status: "ready",
      paymentConfirmationStatus: "confirmed",
      approvedAt: new Date("2026-07-01T12:00:00.000Z"),
    }),
  ];
  const app = await buildAdminApp(orders);
  const headers = { [ADMIN_HEADER]: "admin-secret", "content-type": "application/json" };

  const jump = await app.inject({
    method: "PATCH",
    url: "/admin/v1/lead-orders/ord_jump",
    headers,
    payload: { status: "active" },
  });
  assert.equal(jump.statusCode, 409);
  assert.equal((jump.json() as { error: string }).error, "submitted_cannot_activate");
  assert.equal(orders.find((o) => o.id === "ord_jump")?.status, "submitted");

  const activate = await app.inject({
    method: "PATCH",
    url: "/admin/v1/lead-orders/ord_ready",
    headers,
    payload: { status: "active" },
  });
  assert.equal(activate.statusCode, 200);
  assert.equal((activate.json() as { item: { status: string } }).item.status, "active");

  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("legacy active/completed orders stay readable and tenant auth is unchanged", async () => {
  const prevA = process.env.ADMIN_API_KEY;
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";

  const orders = [
    makeOrder({
      id: "ord_legacy_active",
      status: "active",
      paymentConfirmationStatus: "pending_confirmation",
      activatedAt: new Date("2026-06-01T00:00:00.000Z"),
    }),
    makeOrder({
      id: "ord_legacy_done",
      status: "completed",
      paymentConfirmationStatus: "pending_confirmation",
      completedAt: new Date("2026-06-02T00:00:00.000Z"),
    }),
  ];
  const adminApp = await buildAdminApp(orders);
  const clientApp = await buildClientApp(orders);

  const admin = await adminApp.inject({
    method: "GET",
    url: "/admin/v1/lead-orders/ord_legacy_active",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(admin.statusCode, 200);
  const adminItem = admin.json() as {
    item: { status: string; paymentConfirmationStatus: string; paymentConfirmedBy: string | null };
  };
  assert.equal(adminItem.item.status, "active");
  assert.equal(adminItem.item.paymentConfirmationStatus, "pending_confirmation");
  assert.equal(adminItem.item.paymentConfirmedBy, null);

  const client = await clientApp.inject({
    method: "GET",
    url: "/client/v1/lead-orders/ord_legacy_done?clientAccountId=acct_a",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(client.statusCode, 200);
  const clientItem = client.json() as {
    item: {
      status: string;
      paymentConfirmationStatus: string;
      paymentConfirmedBy?: string;
      adminNotes?: string;
    };
  };
  assert.equal(clientItem.item.status, "completed");
  assert.equal(clientItem.item.paymentConfirmationStatus, "pending_confirmation");
  assert.equal(clientItem.item.paymentConfirmedBy, undefined);
  assert.equal(clientItem.item.adminNotes, undefined);

  const unauth = await adminApp.inject({ method: "GET", url: "/admin/v1/lead-orders" });
  assert.equal(unauth.statusCode, 401);

  if (prevA !== undefined) process.env.ADMIN_API_KEY = prevA;
  else delete process.env.ADMIN_API_KEY;
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});
