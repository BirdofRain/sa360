import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { SourceLeadEvent } from "@prisma/client";
import { ADMIN_KEY_HEADER } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import {
  adminLeadDeliveryRoutes,
  type AdminLeadDeliveryRoutesOptions,
} from "./admin-lead-delivery.js";
import { clientPortalRoutes } from "./client-portal.js";
import type { LeadDeliveryJoinContext } from "../services/lead-delivery/lead-delivery-read.service.js";

const ADMIN_HEADER = ADMIN_KEY_HEADER;
const CLIENT_HEADER = CLIENT_PORTAL_KEY_HEADER;

function mockSourceLead(overrides: Partial<SourceLeadEvent> = {}): SourceLeadEvent {
  return {
    id: "evt_client",
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    sourceType: "lead_form",
    sourceRouteKey: null,
    sourceCampaignId: null,
    sourceCampaignName: null,
    sourceFunnelName: null,
    sourceLeadId: null,
    sourceLeadUid: "uid_client",
    clientAccountIdResolved: "acct_portal",
    destinationLocationIdResolved: null,
    routingRuleIdResolved: "rule_1",
    status: "routing_matched",
    rawPayloadJson: {},
    normalizedPayloadJson: {
      contact: { first_name: "Pat", email: "pat@client.com", phone_e164: "+15559876543" },
    },
    routingResultJson: { matched: true },
    duplicateRiskJson: null,
    deliveryResultJson: null,
    enrichmentMetadataJson: null,
    routingDryRunDecisionId: null,
    errorSummary: null,
    webhookRequestLogId: null,
    receivedAt: new Date("2026-06-01T12:00:00.000Z"),
    normalizedAt: new Date("2026-06-01T12:01:00.000Z"),
    routedAt: new Date("2026-06-01T12:02:00.000Z"),
    approvedAt: null,
    deliveredAt: null,
    approvedBy: null,
    bulkImportId: null,
    bulkImportRowId: null,
    createdAt: new Date("2026-06-01T12:00:00.000Z"),
    updatedAt: new Date("2026-06-01T12:02:00.000Z"),
    ...overrides,
  };
}

function mockContext(id: string, clientAccountId: string): LeadDeliveryJoinContext {
  return {
    sourceLead: mockSourceLead({ id, clientAccountIdResolved: clientAccountId }),
    decision: null,
    plan: null,
    adapterRun: null,
    liveRun: null,
    clientDisplayName: "Portal Client",
    timeline: null,
  };
}

function adminDeps(
  items: LeadDeliveryJoinContext[],
  byId?: Map<string, LeadDeliveryJoinContext>
): AdminLeadDeliveryRoutesOptions {
  return {
    listLeadDeliveryReadModelImpl: async () => ({ items, nextCursor: null }),
    getLeadDeliveryReadModelByIdImpl: async (id) => byId?.get(id) ?? items.find((c) => c.sourceLead.id === id) ?? null,
  };
}

async function buildAdminApp(deps: AdminLeadDeliveryRoutesOptions = {}) {
  const app = Fastify({ logger: false });
  await app.register(adminLeadDeliveryRoutes, { prefix: "/admin/v1", ...deps });
  return app;
}

test("GET /admin/v1/lead-delivery → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp();
  const res = await app.inject({ method: "GET", url: "/admin/v1/lead-delivery" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/lead-delivery returns safe rows with partial data", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const ctx = mockContext("evt_1", "client_a");
  const app = await buildAdminApp(adminDeps([ctx]));
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/lead-delivery",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { ok: boolean; items: { id: string; dataSource: string }[] };
  assert.equal(body.ok, true);
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0]?.id, "evt_1");
  assert.equal(body.items[0]?.dataSource, "partial_live");
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/lead-delivery/:id returns timeline with only real milestones", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const ctx = mockContext("evt_detail", "client_a");
  const app = await buildAdminApp(
    adminDeps([ctx], new Map([["evt_detail", ctx]]))
  );
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/lead-delivery/evt_detail",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    item: { timeline: { milestone: string }[]; rawPayloadJson?: unknown };
  };
  const names = body.item.timeline.map((m) => m.milestone);
  assert.ok(names.includes("source_lead_received"));
  assert.ok(!names.includes("sold"));
  assert.equal(body.item.rawPayloadJson, undefined);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/lead-delivery returns empty list", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp(adminDeps([]));
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/lead-delivery",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { items: unknown[] };
  assert.deepEqual(body.items, []);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("client scoping blocks cross-client detail access", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_portal";

  const otherCtx = mockContext("evt_other", "acct_other");
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: "/client/v1",
    leadDeliveryDeps: {
      listLeadDeliveryReadModelImpl: async () => ({ items: [otherCtx], nextCursor: null }),
      getLeadDeliveryReadModelByIdImpl: async () => otherCtx,
    },
  });

  const res = await app.inject({
    method: "GET",
    url: "/client/v1/lead-delivery/evt_other",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("client role output masks phone/email", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_portal";

  const ctx = mockContext("evt_client", "acct_portal");
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: "/client/v1",
    leadDeliveryDeps: adminDeps([ctx], new Map([["evt_client", ctx]])),
  });

  const res = await app.inject({
    method: "GET",
    url: "/client/v1/lead-delivery/evt_client",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    item: { phoneMasked: string; emailMasked: string; phoneE164?: string; adminDetail?: unknown };
  };
  assert.match(body.item.phoneMasked, /\*\*\*/);
  assert.equal(body.item.emailMasked, "p***@client.com");
  assert.equal(body.item.phoneE164, undefined);
  assert.equal(body.item.adminDetail, undefined);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});
