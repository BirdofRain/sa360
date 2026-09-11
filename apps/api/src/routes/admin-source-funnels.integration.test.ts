import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { isOriginClientBuyerIneligible } from "../services/ppl-fulfillment/origin-client-exclusion.js";
import { processLeadCaptureNextGenLeadCreated } from "../services/source-intake/leadcapture-nextgen-intake.service.js";
import { adminSourceFunnelRoutes } from "./admin-source-funnels.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const HEADER = "x-sa360-admin-key";
const ADMIN_KEY = "admin-sf-assoc-test-key";
const PREFIX = "adm_sf";
const CLIENT_A = `${PREFIX}_a`;
const CLIENT_B = `${PREFIX}_b`;
const CLIENT_C = `${PREFIX}_c`;

const SLUG_DN = "dn_omzoj";
const SLUG_COPY = "6rci-usi";
const SLUG_THIRD = "third-source";
const SLUG_SUGG = "admsf_sugg";
const SLUG_UNREL = "admsf_unrel";
const SLUG_UNASSOC = "admsf_unas";
const SLUG_COUNT = "admsf_cnt";

const PARENT_KEYS = [
  `my.leadcapture.io/p/${SLUG_DN}`,
  `my.leadcapture.io/p/${SLUG_COPY}`,
  `my.leadcapture.io/p/${SLUG_THIRD}`,
  `my.leadcapture.io/p/${SLUG_SUGG}`,
  `my.leadcapture.io/p/${SLUG_UNREL}`,
  `my.leadcapture.io/p/${SLUG_UNASSOC}`,
  `my.leadcapture.io/p/${SLUG_COUNT}`,
  "my.leadcapture.io/p/admsf_unas2",
];

function nextgenPayload(input: {
  leadId: string;
  email: string;
  phone: string;
  parentUrl: string;
  funnelName?: string;
}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    lead_id: input.leadId,
    submitted_at: "2026-09-10T00:00:00.000Z",
    first_name: "Admin",
    last_name: "Assoc",
    email: input.email,
    phone: input.phone,
    state: "NC",
    parent_url: input.parentUrl,
    funnel_name: input.funnelName ?? "Life Insurance For Veterans - Madison Test Client",
  };
}

describe("Admin SourceFunnel association API", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof Fastify>>;
  const createdEventIds: string[] = [];
  const createdClientIds = [CLIENT_A, CLIENT_B, CLIENT_C];
  const prevAdminKey = process.env.ADMIN_API_KEY;

  async function admin(
    method: "GET" | "POST" | "DELETE",
    url: string,
    payload?: unknown
  ) {
    return app.inject({
      method,
      url,
      headers: { [HEADER]: ADMIN_KEY },
      payload,
    });
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.leadInventoryItem.deleteMany({
      where: { originClientAccountId: { in: createdClientIds } },
    });
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: createdClientIds } },
          { suggestedClientAccountId: { in: createdClientIds } },
          { provider: "leadcapture_io", parentUrlKey: { in: PARENT_KEYS } },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: CLIENT_A, clientDisplayName: "Madison Test Client", status: "active" },
        { clientAccountId: CLIENT_B, clientDisplayName: "Other Origin Client", status: "active" },
        { clientAccountId: CLIENT_C, clientDisplayName: "Unrelated Suggested Client", status: "active" },
      ],
    });
    app = Fastify({ logger: false });
    await app.register(adminSourceFunnelRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: createdClientIds } },
          { suggestedClientAccountId: { in: createdClientIds } },
          { provider: "leadcapture_io", parentUrlKey: { in: PARENT_KEYS } },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await app?.close();
    await db?.$disconnect();
    if (prevAdminKey !== undefined) process.env.ADMIN_API_KEY = prevAdminKey;
    else delete process.env.ADMIN_API_KEY;
  });

  it("lists zero sources for a client with no associations", async () => {
    const res = await admin("GET", `/admin/v1/clients/${CLIENT_A}/source-funnels`);
    assert.equal(res.statusCode, 200);
    const body = res.json() as { items: unknown[] };
    assert.deepEqual(body.items, []);
  });

  it("returns 404 for a nonexistent ClientAccount", async () => {
    const res = await admin("GET", "/admin/v1/clients/does_not_exist_sf/source-funnels");
    assert.equal(res.statusCode, 404);
    const body = res.json() as { error: string };
    assert.equal(body.error, "Client not found");
  });

  it("pre-registers a slug, normalizes a full URL, and treats query variation as the same SourceFunnel", async () => {
    const created = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: SLUG_DN,
    });
    assert.equal(created.statusCode, 201);
    const createdBody = created.json() as {
      created: boolean;
      parentUrlKey: string;
      pageSlug: string;
      item: {
        id: string;
        associationStatus: string;
        originClientAccountId: string;
        firstSeenAt: string | null;
        lastSeenAt: string | null;
      };
    };
    assert.equal(createdBody.created, true);
    assert.equal(createdBody.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");
    assert.equal(createdBody.pageSlug, SLUG_DN);
    assert.equal(createdBody.item.associationStatus, "confirmed");
    assert.equal(createdBody.item.originClientAccountId, CLIENT_A);
    assert.equal(createdBody.item.firstSeenAt, null);
    assert.equal(createdBody.item.lastSeenAt, null);

    const one = await admin("GET", `/admin/v1/clients/${CLIENT_A}/source-funnels`);
    assert.equal((one.json() as { items: unknown[] }).items.length, 1);

    const byUrl = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: "https://my.leadcapture.io/p/dn_omzoj?v=1789074011990",
    });
    assert.equal(byUrl.statusCode, 200);
    const urlBody = byUrl.json() as { created: boolean; item: { id: string; parentUrlKey: string } };
    assert.equal(urlBody.created, false);
    assert.equal(urlBody.item.id, createdBody.item.id);
    assert.equal(urlBody.item.parentUrlKey, "my.leadcapture.io/p/dn_omzoj");

    const again = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: SLUG_DN,
    });
    assert.equal(again.statusCode, 200);
    assert.equal((again.json() as { item: { id: string } }).item.id, createdBody.item.id);
  });

  it("adding a second and third source preserves earlier confirmed SourceFunnels", async () => {
    const second = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: SLUG_COPY,
    });
    assert.equal(second.statusCode, 201);
    const third = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: SLUG_THIRD,
    });
    assert.equal(third.statusCode, 201);

    const listed = await admin("GET", `/admin/v1/clients/${CLIENT_A}/source-funnels`);
    const items = (listed.json() as { items: Array<{ pageSlug: string; originClientAccountId: string }> })
      .items;
    assert.equal(items.length, 3);
    const slugs = items.map((row) => row.pageSlug).sort();
    assert.deepEqual(slugs, [SLUG_COPY, SLUG_DN, SLUG_THIRD].sort());
    assert.ok(items.every((row) => row.originClientAccountId === CLIENT_A));
  });

  it("includes suggested sources for the current client and excludes unrelated suggestions and other-client confirmed rows", async () => {
    await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        parentUrlKey: `my.leadcapture.io/p/${SLUG_SUGG}`,
        pageSlug: SLUG_SUGG,
        observedFunnelName: "Life Insurance For Veterans - Madison Test Client",
        nicheKey: "vet_fex",
        associationStatus: "suggested",
        suggestedClientAccountId: CLIENT_A,
        firstSeenAt: new Date("2026-09-10T00:00:00.000Z"),
        lastSeenAt: new Date("2026-09-10T12:00:00.000Z"),
      },
    });
    await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        parentUrlKey: `my.leadcapture.io/p/${SLUG_UNREL}`,
        pageSlug: SLUG_UNREL,
        associationStatus: "suggested",
        suggestedClientAccountId: CLIENT_C,
        firstSeenAt: new Date("2026-09-10T00:00:00.000Z"),
        lastSeenAt: new Date("2026-09-10T12:00:00.000Z"),
      },
    });
    await admin("POST", `/admin/v1/clients/${CLIENT_B}/source-funnels`, {
      pageUrlOrSlug: SLUG_UNASSOC,
    });

    const forA = await admin("GET", `/admin/v1/clients/${CLIENT_A}/source-funnels`);
    const itemsA = (
      forA.json() as { items: Array<{ pageSlug: string; associationStatus: string }> }
    ).items;
    const slugsA = itemsA.map((row) => row.pageSlug);
    assert.ok(slugsA.includes(SLUG_DN));
    assert.ok(slugsA.includes(SLUG_COPY));
    assert.ok(slugsA.includes(SLUG_THIRD));
    assert.ok(slugsA.includes(SLUG_SUGG));
    assert.ok(!slugsA.includes(SLUG_UNREL));
    assert.ok(!slugsA.includes(SLUG_UNASSOC));
    assert.equal(itemsA.find((row) => row.pageSlug === SLUG_SUGG)?.associationStatus, "suggested");

    const forB = await admin("GET", `/admin/v1/clients/${CLIENT_B}/source-funnels`);
    const itemsB = (forB.json() as { items: Array<{ pageSlug: string }> }).items;
    assert.deepEqual(itemsB.map((row) => row.pageSlug), [SLUG_UNASSOC]);
  });

  it("confirms an existing suggested source via associate and via explicit confirm", async () => {
    const associated = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: SLUG_SUGG,
    });
    assert.equal(associated.statusCode, 200);
    const body = associated.json() as {
      item: { associationStatus: string; originClientAccountId: string; pageSlug: string };
    };
    assert.equal(body.item.associationStatus, "confirmed");
    assert.equal(body.item.originClientAccountId, CLIENT_A);
    assert.equal(body.item.pageSlug, SLUG_SUGG);

    const unassociated = await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        parentUrlKey: "my.leadcapture.io/p/admsf_unas2",
        pageSlug: "admsf_unas2",
        associationStatus: "unassociated",
        firstSeenAt: new Date("2026-09-09T00:00:00.000Z"),
        lastSeenAt: new Date("2026-09-09T00:00:00.000Z"),
      },
    });
    const confirmUnassoc = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: "admsf_unas2",
    });
    assert.equal(confirmUnassoc.statusCode, 200);
    assert.equal(
      (confirmUnassoc.json() as { item: { id: string; associationStatus: string } }).item.id,
      unassociated.id
    );
    assert.equal(
      (confirmUnassoc.json() as { item: { associationStatus: string } }).item.associationStatus,
      "confirmed"
    );
  });

  it("ordinary associate never reassigns a source confirmed to another client", async () => {
    const conflict = await admin("POST", `/admin/v1/clients/${CLIENT_B}/source-funnels`, {
      pageUrlOrSlug: SLUG_DN,
    });
    assert.equal(conflict.statusCode, 409);
    const body = conflict.json() as {
      code: string;
      error: string;
      sourceFunnelId: string;
      currentOriginClientAccountId: string;
      currentOriginClientDisplayName: string | null;
      requestedOriginClientAccountId: string;
      item: { originClientAccountId: string };
    };
    assert.equal(body.code, "confirm_requires_explicit_reassign");
    assert.equal(body.error, "This source is already associated with another client.");
    assert.equal(body.currentOriginClientAccountId, CLIENT_A);
    assert.equal(body.currentOriginClientDisplayName, "Madison Test Client");
    assert.equal(body.requestedOriginClientAccountId, CLIENT_B);
    assert.equal(body.item.originClientAccountId, CLIENT_A);

    const stillA = await db.sourceFunnel.findUnique({
      where: {
        provider_parentUrlKey: {
          provider: "leadcapture_io",
          parentUrlKey: "my.leadcapture.io/p/dn_omzoj",
        },
      },
    });
    assert.equal(stillA?.originClientAccountId, CLIENT_A);
    assert.equal(stillA?.associationStatus, "confirmed");
  });

  it("explicit reassign A→B succeeds and propagates correction counts", async () => {
    const ingested = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555901",
        email: "adm.sf.reassign@example.test",
        phone: "5550109901",
        parentUrl: `https://my.leadcapture.io/p/${SLUG_COUNT}?v=1`,
        funnelName: "Life Insurance For Veterans - Count Source",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(ingested.sourceEventId);

    const associate = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: SLUG_COUNT,
    });
    assert.equal(associate.statusCode, 200);
    const associated = associate.json() as {
      backfilledInventoryCount: number;
      item: { id: string };
    };
    assert.ok(associated.backfilledInventoryCount >= 1);

    const reassign = await admin("POST", `/admin/v1/source-funnels/${associated.item.id}/reassign`, {
      originClientAccountId: CLIENT_B,
    });
    assert.equal(reassign.statusCode, 200);
    const reassignBody = reassign.json() as {
      newlyStamped: number;
      reassigned: number;
      conflictsSkipped: number;
      item: { originClientAccountId: string; associationStatus: string };
    };
    assert.equal(typeof reassignBody.newlyStamped, "number");
    assert.equal(typeof reassignBody.reassigned, "number");
    assert.equal(typeof reassignBody.conflictsSkipped, "number");
    assert.equal(reassignBody.reassigned, 1);
    assert.equal(reassignBody.item.originClientAccountId, CLIENT_B);
    assert.equal(reassignBody.item.associationStatus, "confirmed");

    const inventory = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: ingested.sourceEventId },
    });
    assert.equal(inventory?.originClientAccountId, CLIENT_B);
    assert.equal(isOriginClientBuyerIneligible(CLIENT_B, CLIENT_B), true);
    assert.equal(isOriginClientBuyerIneligible(inventory?.originClientAccountId, CLIENT_B), true);
    assert.equal(isOriginClientBuyerIneligible(inventory?.originClientAccountId, CLIENT_A), false);
  });

  it("clear association succeeds, propagates count, and leaves sibling sources confirmed", async () => {
    const listed = await admin("GET", `/admin/v1/clients/${CLIENT_A}/source-funnels`);
    const items = (
      listed.json() as { items: Array<{ id: string; pageSlug: string; associationStatus: string }> }
    ).items;
    const copy = items.find((row) => row.pageSlug === SLUG_COPY);
    assert.ok(copy);
    const beforeCount = items.filter((row) => row.associationStatus === "confirmed").length;
    assert.ok(beforeCount >= 2);

    const cleared = await admin("DELETE", `/admin/v1/source-funnels/${copy.id}/association`);
    assert.equal(cleared.statusCode, 200);
    const clearBody = cleared.json() as {
      clearedInventoryCount: number;
      item: { associationStatus: string; originClientAccountId: string | null; id: string };
    };
    assert.equal(typeof clearBody.clearedInventoryCount, "number");
    assert.equal(clearBody.item.associationStatus, "unassociated");
    assert.equal(clearBody.item.originClientAccountId, null);

    const stillThere = await db.sourceFunnel.findUnique({ where: { id: copy.id } });
    assert.ok(stillThere);
    assert.equal(stillThere.associationStatus, "unassociated");

    const after = await admin("GET", `/admin/v1/clients/${CLIENT_A}/source-funnels`);
    const afterItems = (
      after.json() as { items: Array<{ pageSlug: string; associationStatus: string }> }
    ).items;
    assert.ok(!afterItems.some((row) => row.pageSlug === SLUG_COPY && row.associationStatus === "confirmed"));
    assert.ok(afterItems.some((row) => row.pageSlug === SLUG_DN && row.associationStatus === "confirmed"));
    assert.ok(afterItems.some((row) => row.pageSlug === SLUG_THIRD && row.associationStatus === "confirmed"));
  });

  it("rejects malformed operator input with a safe 4xx", async () => {
    const res = await admin("POST", `/admin/v1/clients/${CLIENT_A}/source-funnels`, {
      pageUrlOrSlug: "not a valid leadcapture source!!!",
    });
    assert.equal(res.statusCode, 400);
    const body = res.json() as { error: string; code: string };
    assert.equal(body.code, "invalid_page_url_or_slug");
    assert.equal(body.error, "That value could not be recognized as a valid LeadCapture source.");
    assert.doesNotMatch(JSON.stringify(body), /prisma|SQL|stack/i);
  });

  it("discovery endpoint lists recently observed unassociated/suggested sources", async () => {
    const res = await admin("GET", "/admin/v1/source-funnels/observed");
    assert.equal(res.statusCode, 200);
    const items = (res.json() as { items: Array<{ associationStatus: string; lastSeenAt: string | null }> })
      .items;
    assert.ok(Array.isArray(items));
    for (const row of items) {
      assert.ok(row.associationStatus === "unassociated" || row.associationStatus === "suggested");
      assert.ok(row.lastSeenAt);
    }
  });
});
