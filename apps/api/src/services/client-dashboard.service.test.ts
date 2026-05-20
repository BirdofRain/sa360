import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { getClientDashboard } from "./client-dashboard.service.js";

const FIXED_NOW = new Date("2026-05-19T12:00:00.000Z");

const tenant = { clientAccountId: "acct_test", subaccountIdGhl: "loc_test" };

const range = {
  from: new Date("2026-05-12T00:00:00.000Z"),
  to: new Date("2026-05-19T23:59:59.999Z"),
  rangeKey: "7d" as const,
};

test("getClientDashboard returns 200 empty state when DB has no rows", async () => {
  const body = await getClientDashboard(
    { tenant, range },
    { prisma: createEmptyPrismaMock(), now: () => FIXED_NOW }
  );
  assert.equal(body.ok, true);
  assert.equal(body.funnel.leadsReceived, 0);
  assert.equal(body.funnel.replied, 0);
  assert.equal(body.recentActivity.length, 0);
  assert.match(body.systemHealth.headline, /Waiting for first leads/i);
  assert.equal(body.systemHealth.checks[0]?.detail, "Waiting for first leads");
  assert.equal(body.systemHealth.checks[1]?.detail, "No appointments in this range yet");
  assert.equal(body.aiVoice.enabled, false);
});

test("getClientDashboard maps funnel counts from lifecycle data", async () => {
  const prisma = {
    ...createEmptyPrismaMock(),
    lifecycleEvent: {
      count: async ({ where }: { where: { eventNameInternal?: string } }) => {
        if (where.eventNameInternal === "lead_created") return 4;
        if (where.eventNameInternal === "appointment_set") return 2;
        if (where.eventNameInternal === "appointment_showed") return 1;
        return 0;
      },
      findMany: async (args: {
        where?: { eventNameInternal?: string | { in: string[] } };
        distinct?: string[];
        orderBy?: unknown;
        take?: number;
        select?: unknown;
      }) => {
        if (args.distinct?.includes("leadUid")) {
          const ev = args.where?.eventNameInternal;
          if (ev === "lead_created") {
            return [{ leadUid: "l1" }, { leadUid: "l2" }, { leadUid: "l3" }, { leadUid: "l4" }];
          }
          if (typeof ev === "object" && ev.in?.includes("contact_replied")) {
            return [{ leadUid: "l1" }, { leadUid: "l2" }];
          }
          if (typeof ev === "object" && ev.in?.includes("sold")) {
            return [{ leadUid: "l1" }];
          }
        }
        if (args.orderBy && args.take === 30) {
          return [
            {
              id: "evt_1",
              receivedAt: new Date("2026-05-19T10:00:00.000Z"),
              eventNameInternal: "lead_created",
              payloadJson: { contact: { first_name: "Jane", last_name: "Doe" } },
              contactIdGhl: "c1",
            },
            {
              id: "evt_2",
              receivedAt: new Date("2026-05-19T09:00:00.000Z"),
              eventNameInternal: "signal_sent",
              payloadJson: {},
              contactIdGhl: "c1",
            },
          ];
        }
        return [];
      },
      findFirst: async () => ({ receivedAt: new Date("2026-05-19T10:00:00.000Z") }),
    },
    inboundContactIndex: { findMany: async () => [] },
    leadAttribution: { findMany: async () => [] },
    synthflowRequestLog: { count: async () => 0, findFirst: async () => null },
    synthflowOutboundResultLog: { count: async () => 0, findFirst: async () => null },
    webhookRequestLog: { count: async () => 0, findFirst: async () => null },
    clientConfig: {
      findUnique: async () => ({ clientName: "Test Client" }),
    },
  } as unknown as PrismaClient;

  const body = await getClientDashboard(
    { tenant, range },
    { prisma, now: () => FIXED_NOW }
  );

  assert.equal(body.funnel.leadsReceived, 4);
  assert.equal(body.funnel.replied, 2);
  assert.equal(body.funnel.appointmentsSet, 2);
  assert.equal(body.funnel.appointmentsShowed, 1);
  assert.equal(body.funnel.sold, 1);
  assert.equal(body.client.displayName, "Test Client");
  assert.equal(body.recentActivity.length, 1);
  assert.equal(body.recentActivity[0]?.title, "Lead received");
  assert.notEqual(body.recentActivity[0]?.title, "lead_created");
});
