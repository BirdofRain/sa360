import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import {
  getActionDashboardToday,
  hasRelevantDashboardData,
  loadActionDashboardRawData,
  type ActionDashboardServiceDeps,
} from "./action-dashboard.service.js";
import { resolveActionDashboardScope } from "./action-dashboard-scope.js";

test("hasRelevantDashboardData is false when all sources empty", () => {
  assert.equal(
    hasRelevantDashboardData({
      scope: resolveActionDashboardScope({ clientAccountId: "x", now: new Date() }),
      clientName: null,
      contacts: [],
      lifecycleLookback: [],
      lifecycleToday: [],
      synthflowInbound: [],
      synthflowOutbound: [],
      lastWebhookSuccessAt: null,
      hasLifecycleRows: false,
      hasSynthflowInbound: false,
      hasSynthflowOutbound: false,
      hasWebhookSuccess: false,
      hasContacts: false,
    }),
    false
  );
});

test("getActionDashboardToday uses seed fallback in development when DB empty", async () => {
  const deps: ActionDashboardServiceDeps = {
    prisma: createEmptyPrismaMock(),
    now: () => new Date("2026-05-18T12:00:00.000Z"),
    nodeEnv: "development",
  };
  const res = await getActionDashboardToday({ clientAccountId: "demo" }, deps);
  assert.equal(res.ok, true);
  assert.ok(res.setupWarnings.some((w) => w.includes("seeded")));
  assert.ok(res.priorityLeads.length > 0);
});

test("getActionDashboardToday returns empty real payload in production when DB empty", async () => {
  const deps: ActionDashboardServiceDeps = {
    prisma: createEmptyPrismaMock(),
    now: () => new Date("2026-05-18T12:00:00.000Z"),
    nodeEnv: "production",
  };
  const res = await getActionDashboardToday({ clientAccountId: "demo" }, deps);
  assert.equal(res.ok, true);
  assert.equal(res.priorityLeads.length, 0);
  assert.equal(res.summary.callsLoggedToday, 0);
  assert.ok(res.setupWarnings.some((w) => w.includes("No SA360 records")));
  assert.equal(res.subaccount.connectionStatus, "disconnected");
});

test("loadActionDashboardRawData scopes clientAccountId", async () => {
  let capturedWhere: unknown;
  const prisma = {
    ...createEmptyPrismaMock(),
    inboundContactIndex: {
      findMany: async (args: { where: unknown }) => {
        capturedWhere = args.where;
        return [];
      },
      findFirst: async () => null,
    },
  } as unknown as PrismaClient;

  await loadActionDashboardRawData(
    { clientAccountId: "acct_99", locationId: "loc_1" },
    { prisma, now: () => new Date(), nodeEnv: "test" }
  );
  assert.deepEqual(capturedWhere, {
    clientAccountId: "acct_99",
    subaccountIdGhl: "loc_1",
  });
});
