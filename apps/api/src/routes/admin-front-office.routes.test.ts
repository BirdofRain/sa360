import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { ADMIN_KEY_HEADER } from "../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import {
  adminFrontOfficeRoutes,
  type AdminFrontOfficeRoutesOptions,
} from "./admin-front-office.js";
import { clientPortalRoutes } from "./client-portal.js";
import type { FrontOfficeTrustCard } from "../services/front-office/front-office.types.js";

const ADMIN_HEADER = ADMIN_KEY_HEADER;
const CLIENT_HEADER = CLIENT_PORTAL_KEY_HEADER;

function sampleTrustCards(): FrontOfficeTrustCard[] {
  return [
    {
      key: "ghl_connection",
      title: "GHL Connection",
      status: "verified",
      source: "live",
      summary: "1/1 locations connected",
      lastCheckedAt: "2026-06-01T10:00:00.000Z",
      warnings: [],
      details: [
        {
          id: "ghl-1",
          label: "Main Location",
          status: "verified",
          detail: "Connected",
          adminDetail: "Probe ok; token expires 2026-12-01",
        },
      ],
    },
    {
      key: "webhook_health",
      title: "Webhook Health",
      status: "warning",
      source: "partial_live",
      summary: "Webhook pipeline monitored",
      lastCheckedAt: "2026-06-01T10:00:00.000Z",
      warnings: ["2 validation failures"],
      details: [
        {
          id: "wh-failures",
          label: "Failure rate",
          status: "warning",
          detail: "2 failures of 100 total",
          adminOnly: true,
          adminDetail: "Bearer sk_secret_token_here",
        },
      ],
    },
  ];
}

function adminDeps(): AdminFrontOfficeRoutesOptions {
  return {
    buildFrontOfficeTrustCenterImpl: async () => ({
      generatedAt: "2026-06-01T10:00:00.000Z",
      dataSource: "partial_live",
      cards: sampleTrustCards(),
    }),
    buildFrontOfficeSummaryImpl: async () => ({
      generatedAt: "2026-06-01T10:00:00.000Z",
      dataSource: "partial_live",
      kpis: {
        leadsReceived: 3,
        leadsMatched: 2,
        leadsDelivered: 1,
        deliveryFailures: 1,
        appointmentsSet: 0,
        soldLogged: 0,
        trustWarnings: 1,
        latestLeadEvent: "2026-06-01T09:00:00.000Z",
      },
      urgentTasks: [],
      recentLeadDelivery: [],
      trustSummary: {
        status: "warning",
        warningCount: 1,
        cardsNeedingAttention: ["Webhook Health"],
      },
    }),
  };
}

async function buildAdminApp(deps: AdminFrontOfficeRoutesOptions = adminDeps()) {
  const app = Fastify({ logger: false });
  await app.register(adminFrontOfficeRoutes, { prefix: "/admin/v1", ...deps });
  return app;
}

test("GET /admin/v1/front-office/trust → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp();
  const res = await app.inject({ method: "GET", url: "/admin/v1/front-office/trust" });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/front-office/trust returns expanded safe cards", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/front-office/trust",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    ok: boolean;
    cards: { details: { adminDetail?: string }[] }[];
  };
  assert.equal(body.ok, true);
  assert.ok(body.cards[0]?.details[0]?.adminDetail);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("trust endpoint handles missing slices without crashing", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp({
    buildFrontOfficeTrustCenterImpl: async () => ({
      generatedAt: "2026-06-01T10:00:00.000Z",
      dataSource: "mock",
      cards: [],
    }),
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/front-office/trust",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { cards: unknown[] };
  assert.deepEqual(body.cards, []);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("GET /admin/v1/front-office/summary returns partial_live when data incomplete", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp();
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/front-office/summary",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { dataSource: string; kpis: { leadsReceived: number } };
  assert.equal(body.dataSource, "partial_live");
  assert.equal(body.kpis.leadsReceived, 3);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("client trust endpoint strips adminDetail and unsafe fields", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_portal";

  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: "/client/v1",
    frontOfficeDeps: {
      buildFrontOfficeTrustCenterImpl: async () => ({
        generatedAt: "2026-06-01T10:00:00.000Z",
        dataSource: "partial_live",
        cards: sampleTrustCards(),
      }),
    },
  });

  const res = await app.inject({
    method: "GET",
    url: "/client/v1/trust",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    cards: { details: { adminDetail?: string; label: string }[] }[];
  };
  const webhookDetails = body.cards[1]?.details ?? [];
  assert.equal(webhookDetails.length, 0);
  assert.ok(!JSON.stringify(body).includes("sk_secret_token"));
  assert.ok(!JSON.stringify(body).includes("Bearer"));
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("client summary endpoint is client-scoped", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = "acct_portal";

  let scopedClient: string | undefined;
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: "/client/v1",
    frontOfficeDeps: {
      buildFrontOfficeSummaryImpl: async (clientAccountId) => {
        scopedClient = clientAccountId;
        return {
          generatedAt: "2026-06-01T10:00:00.000Z",
          dataSource: "live",
          kpis: {
            leadsReceived: 0,
            leadsMatched: 0,
            leadsDelivered: 0,
            deliveryFailures: 0,
            appointmentsSet: 0,
            soldLogged: 0,
            trustWarnings: 0,
            latestLeadEvent: null,
          },
          urgentTasks: [],
          recentLeadDelivery: [],
          trustSummary: {
            status: "verified",
            warningCount: 0,
            cardsNeedingAttention: [],
          },
        };
      },
    },
  });

  const res = await app.inject({
    method: "GET",
    url: "/client/v1/front-office/summary",
    headers: { [CLIENT_HEADER]: "portal-secret" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(scopedClient, "acct_portal");
  const body = JSON.parse(res.body) as { kpis: { leadsReceived: number } };
  assert.equal(body.kpis.leadsReceived, 0);
  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
  else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
});

test("empty lead-delivery data produces safe empty dashboard state", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = await buildAdminApp({
    buildFrontOfficeSummaryImpl: async () => ({
      generatedAt: "2026-06-01T10:00:00.000Z",
      dataSource: "live",
      kpis: {
        leadsReceived: 0,
        leadsMatched: 0,
        leadsDelivered: 0,
        deliveryFailures: 0,
        appointmentsSet: 0,
        soldLogged: 0,
        trustWarnings: 0,
        latestLeadEvent: null,
      },
      urgentTasks: [],
      recentLeadDelivery: [],
      trustSummary: {
        status: "verified",
        warningCount: 0,
        cardsNeedingAttention: [],
      },
    }),
  });
  const res = await app.inject({
    method: "GET",
    url: "/admin/v1/front-office/summary",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as {
    recentLeadDelivery: unknown[];
    urgentTasks: unknown[];
    kpis: { leadsReceived: number };
  };
  assert.deepEqual(body.recentLeadDelivery, []);
  assert.deepEqual(body.urgentTasks, []);
  assert.equal(body.kpis.leadsReceived, 0);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
