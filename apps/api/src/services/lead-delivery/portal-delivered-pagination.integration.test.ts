/**
 * Customer Delivered pages, followed the way the portal page follows its links.
 *
 * The page reads status, q, from, to, and cursor from the URL. The tenant id
 * comes from the signed-in session, not from that URL. Each request keeps the
 * 200-row scan budget.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient, SourceLeadEventStatus } from "@prisma/client";
import Fastify from "fastify";

import { ADMIN_KEY_HEADER } from "../../lib/admin-auth.js";
import { CLIENT_PORTAL_KEY_HEADER } from "../../lib/client-portal-auth.js";
import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  listSourceLeadEvents,
  type SourceLeadEventListFilters,
} from "../../repositories/source-lead-event.repository.js";
import { adminLeadDeliveryRoutes } from "../../routes/admin-lead-delivery.js";
import { clientPortalRoutes } from "../../routes/client-portal.js";
import { PORTAL_DELIVERED_MAX_SCAN, PORTAL_DELIVERED_SCAN_BATCH } from "./portal-delivered-membership.js";

const integrationUrl = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const enabled = Boolean(integrationUrl);
const db = prisma as PrismaClient;

const FROM = "2026-11-01T00:00:00.000Z";
const TO = "2026-11-30T23:59:59.999Z";

function portalPageSearch(q: string, cursor?: string): URLSearchParams {
  const params = new URLSearchParams();
  params.set("status", "delivered");
  params.set("q", q);
  params.set("from", FROM);
  params.set("to", TO);
  if (cursor) params.set("cursor", cursor);
  return params;
}

function leadRow(input: {
  id: string;
  clientAccountId: string;
  status: SourceLeadEventStatus;
  receivedAt: string;
  campaign?: string;
}): Prisma.SourceLeadEventCreateManyInput {
  return {
    id: input.id,
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_nextgen",
    sourceType: "webhook",
    sourceLeadUid: input.id,
    sourceCampaignName: input.campaign ?? "Quartz",
    clientAccountIdResolved: input.clientAccountId,
    status: input.status,
    rawPayloadJson: { contact: { first_name: "Alex", last_name: "Gross" } },
    receivedAt: new Date(input.receivedAt),
  };
}

test("portal Delivered links page 51 leads and continue past a bounded empty scan", { skip: !enabled, timeout: 120_000 }, async () => {
  assertSafeTestDatabaseUrl(integrationUrl);
  const stamp = `${Date.now()}`;
  const clientAccountId = `page_${stamp}`;
  const otherClientId = `page_${stamp}_other`;
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (input) => {
    fetches += 1;
    throw new Error(`portal read called the network: ${String(input)}`);
  };
  const previousPortalKey = process.env.CLIENT_PORTAL_API_KEY;
  const previousAdminKey = process.env.ADMIN_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.ADMIN_API_KEY = "admin-secret";

  let rowsThisRequest = 0;
  let maxBatch = 0;
  const countingList = async (filters: SourceLeadEventListFilters, pageDb?: PrismaClient) => {
    maxBatch = Math.max(maxBatch, filters.limit ?? 0);
    assert.equal(filters.clientAccountIdResolved, clientAccountId);
    assert.equal(filters.status, undefined);
    const page = await listSourceLeadEvents(filters, pageDb);
    rowsThisRequest += page.items.length;
    assert.ok(rowsThisRequest <= PORTAL_DELIVERED_MAX_SCAN);
    return page;
  };

  try {
    await db.clientAccount.createMany({
      data: [
        { clientAccountId, clientDisplayName: "Alex Gross", status: "active", portalEnabled: true },
        { clientAccountId: otherClientId, clientDisplayName: "Other", status: "active", portalEnabled: true },
      ],
    });
    const fiftyOne = Array.from({ length: 51 }, (_, index) =>
      leadRow({
        id: `p51_${stamp}_${String(index).padStart(2, "0")}`,
        clientAccountId,
        status: "delivered",
        receivedAt: new Date(Date.parse("2026-11-02T00:00:00.000Z") + index * 1000).toISOString(),
      })
    );
    const buriedId = `buried_${stamp}`;
    const nonmatches = Array.from({ length: 1600 }, (_, index) =>
      leadRow({
        id: `nm_${stamp}_${String(index).padStart(4, "0")}`,
        clientAccountId,
        status: "routing_matched",
        campaign: "Noise",
        receivedAt: new Date(Date.parse("2026-11-10T00:00:00.000Z") + index * 1000).toISOString(),
      })
    );
    await db.sourceLeadEvent.createMany({
      data: [
        ...fiftyOne,
        leadRow({
          id: `decoy_${stamp}`,
          clientAccountId,
          status: "routing_matched",
          receivedAt: "2026-11-28T00:00:00.000Z",
        }),
        leadRow({
          id: `pebble_${stamp}`,
          clientAccountId,
          status: "delivered",
          campaign: "Pebble",
          receivedAt: "2026-11-15T00:00:00.000Z",
        }),
        leadRow({
          id: `october_${stamp}`,
          clientAccountId,
          status: "delivered",
          receivedAt: "2026-10-15T00:00:00.000Z",
        }),
        leadRow({
          id: `other_${stamp}`,
          clientAccountId: otherClientId,
          status: "delivered",
          receivedAt: "2026-11-20T00:00:00.000Z",
        }),
        ...nonmatches,
        leadRow({
          id: buriedId,
          clientAccountId,
          status: "delivered",
          campaign: "Noise",
          receivedAt: "2026-11-01T00:00:01.000Z",
        }),
      ],
    });

    const runsBefore = await db.ghlLiveDeliveryRun.count({
      where: { destinationClientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const outboxBefore = await db.ghlAssociationDispatchOutbox.count({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const eventsBefore = await db.lifecycleEvent.count({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const leadsBefore = await db.sourceLeadEvent.count({
      where: { clientAccountIdResolved: { in: [clientAccountId, otherClientId] } },
    });

    const portal = Fastify({ logger: false });
    await portal.register(clientPortalRoutes, {
      prefix: "/client/v1",
      leadDeliveryDeps: { listSourceLeadEventsImpl: countingList },
    });
    const admin = Fastify({ logger: false });
    await admin.register(adminLeadDeliveryRoutes, { prefix: "/admin/v1" });

    async function loadPortalPage(search: URLSearchParams) {
      rowsThisRequest = 0;
      assert.equal(search.get("clientAccountId"), null);
      const api = new URLSearchParams({ clientAccountId, limit: "50" });
      for (const key of ["status", "q", "from", "to", "cursor"]) {
        const value = search.get(key);
        if (value) api.set(key, value);
      }
      const response = await portal.inject({
        method: "GET",
        url: `/client/v1/lead-delivery?${api.toString()}`,
        headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret" },
      });
      assert.equal(response.statusCode, 200);
      assert.ok(maxBatch <= PORTAL_DELIVERED_SCAN_BATCH);
      assert.ok(rowsThisRequest <= PORTAL_DELIVERED_MAX_SCAN);
      return response.json() as {
        items: Array<{ id: string; deliveryStatus: string; clientAccountId: string | null }>;
        nextCursor: string | null;
      };
    }

    const firstSearch = portalPageSearch("Quartz");
    const first = await loadPortalPage(firstSearch);
    assert.equal(first.items.length, 50);
    assert.ok(first.nextCursor);
    for (const item of first.items) {
      assert.equal(item.deliveryStatus, "delivered");
      assert.equal(item.clientAccountId, clientAccountId);
    }
    const nextSearch = portalPageSearch("Quartz", first.nextCursor);
    assert.equal(nextSearch.get("status"), "delivered");
    assert.equal(nextSearch.get("q"), "Quartz");
    assert.equal(nextSearch.get("from"), FROM);
    assert.equal(nextSearch.get("to"), TO);
    assert.equal(nextSearch.get("cursor"), first.nextCursor);
    const second = await loadPortalPage(nextSearch);
    assert.equal(second.nextCursor, null);
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0]?.deliveryStatus, "delivered");
    const seenFiftyOne = [...first.items.map((item) => item.id), second.items[0]!.id];
    assert.equal(new Set(seenFiftyOne).size, 51);
    assert.deepEqual(
      new Set(seenFiftyOne),
      new Set(fiftyOne.map((row) => row.id))
    );
    assert.equal(seenFiftyOne.includes(`decoy_${stamp}`), false);
    assert.equal(seenFiftyOne.includes(`pebble_${stamp}`), false);
    assert.equal(seenFiftyOne.includes(`october_${stamp}`), false);
    assert.equal(seenFiftyOne.includes(`other_${stamp}`), false);
    assert.equal(seenFiftyOne.includes(buriedId), false);

    const buriedPages: string[][] = [];
    let buriedCursor: string | undefined;
    let continued = false;
    for (let guard = 0; guard < 20; guard += 1) {
      const search = portalPageSearch("Noise", buriedCursor);
      const page = await loadPortalPage(search);
      buriedPages.push(page.items.map((item) => item.id));
      if (guard === 0) {
        assert.equal(page.items.length, 0);
        assert.ok(page.nextCursor);
        continued = true;
      }
      for (const item of page.items) assert.equal(item.deliveryStatus, "delivered");
      if (!page.nextCursor) break;
      buriedCursor = page.nextCursor;
    }
    assert.equal(continued, true);
    const buriedSeen = buriedPages.flat();
    assert.deepEqual(buriedSeen, [buriedId]);
    assert.equal(new Set(buriedSeen).size, buriedSeen.length);

    const adminList = await admin.inject({
      method: "GET",
      url:
        `/admin/v1/lead-delivery?clientAccountId=${clientAccountId}` +
        `&status=delivered&q=Quartz&from=${encodeURIComponent(FROM)}&to=${encodeURIComponent(TO)}&limit=80`,
      headers: { [ADMIN_KEY_HEADER]: "admin-secret" },
    });
    assert.equal(adminList.statusCode, 200);
    const adminItems = adminList.json() as { items: Array<{ id: string; deliveryStatus: string }> };
    assert.equal(
      adminItems.items.some((item) => item.id === `decoy_${stamp}`),
      false
    );
    assert.equal(
      adminItems.items.some((item) => item.id.startsWith(`nm_${stamp}_`)),
      false
    );

    const runsAfter = await db.ghlLiveDeliveryRun.count({
      where: { destinationClientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const outboxAfter = await db.ghlAssociationDispatchOutbox.count({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const eventsAfter = await db.lifecycleEvent.count({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    const leadsAfter = await db.sourceLeadEvent.count({
      where: { clientAccountIdResolved: { in: [clientAccountId, otherClientId] } },
    });
    assert.equal(fetches, 0);
    assert.equal(runsAfter, runsBefore);
    assert.equal(outboxAfter, outboxBefore);
    assert.equal(eventsAfter, eventsBefore);
    assert.equal(leadsAfter, leadsBefore);

    await portal.close();
    await admin.close();
  } finally {
    globalThis.fetch = originalFetch;
    if (previousPortalKey === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = previousPortalKey;
    if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdminKey;
    await db.sourceLeadEvent.deleteMany({
      where: { clientAccountIdResolved: { in: [clientAccountId, otherClientId] } },
    });
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
  }
});
