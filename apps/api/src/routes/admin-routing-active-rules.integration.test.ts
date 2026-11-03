import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { adminClientsRoutes } from "./admin-clients.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const HEADER = "x-sa360-admin-key";
const ADMIN_KEY = "admin-active-rules-test-key";
const CLIENT_A = "inv_active_rule_a";
const CLIENT_B = "inv_active_rule_b";
function activeRulesUrl(cursor: string | null): string {
  if (!cursor) return "/admin/v1/routing/active-rules?limit=1";
  return `/admin/v1/routing/active-rules?limit=1&cursor=${encodeURIComponent(cursor)}`;
}

const FORBIDDEN = [
  "rawPayloadJson",
  "normalizedPayloadJson",
  "destinationSubaccountIdGhl",
  "destinationWorkflowIdGhl",
  "destinationPipelineIdGhl",
  "backupSheetId",
  "defaultAssignedUserIdGhl",
  "sourceAttributeFieldMapJson",
  "sourceFieldAliasOverridesJson",
];

describe("Admin active routing rule inventory", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof Fastify>>;
  const prevAdminKey = process.env.ADMIN_API_KEY;
  const createdRuleIds: string[] = [];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.campaignRoutingRule.deleteMany({
      where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } },
    });
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } },
    });
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: CLIENT_A, clientDisplayName: "Inventory Active A", status: "active" },
        { clientAccountId: CLIENT_B, clientDisplayName: "Inventory Active B", status: "active" },
      ],
    });
    const activeA = await db.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: CLIENT_A,
        clientDisplayName: "Inventory Active A",
        matchType: "form_id_utm_campaign",
        formId: "form_inventory_a",
        utmCampaign: "inventory-a",
        campaignId: "inventory_campaign_a",
        campaignName: "Inventory Campaign A",
        keywordPattern: "inventory-keyword-a",
        sourcePlatform: "leadcapture_io",
        sourceType: "leadcapture_form",
        active: true,
        deliveryEnabled: false,
      },
    });
    const inactive = await db.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: CLIENT_A,
        clientDisplayName: "Inventory Active A",
        matchType: "campaign_id",
        campaignId: "inventory_campaign_inactive",
        active: false,
      },
    });
    const activeB = await db.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: CLIENT_B,
        clientDisplayName: "Inventory Active B",
        matchType: "keyword_fallback",
        keywordPattern: "inventory-keyword-b",
        active: true,
        deliveryEnabled: true,
      },
    });
    createdRuleIds.push(activeA.id, inactive.id, activeB.id);
    app = Fastify({ logger: false });
    await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    if (createdRuleIds.length > 0) {
      await db.campaignRoutingRule.deleteMany({ where: { id: { in: createdRuleIds } } });
    }
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } },
    });
    await app?.close();
    await db?.$disconnect();
    if (prevAdminKey !== undefined) process.env.ADMIN_API_KEY = prevAdminKey;
    else delete process.env.ADMIN_API_KEY;
  });

  it("pages active rules across clients and omits inactive rules and destination secrets", async () => {
    const unbounded = await app.inject({
      method: "GET",
      url: "/admin/v1/routing/active-rules?limit=100",
      headers: { [HEADER]: ADMIN_KEY },
    });
    assert.equal(unbounded.statusCode, 400);

    const want = new Set([createdRuleIds[0]!, createdRuleIds[2]!]);
    const inactiveId = createdRuleIds[1];
    const seen = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < 80 && seen.size < want.size; page += 1) {
      const res: { statusCode: number; json: () => unknown } = await app.inject({
        method: "GET",
        url: activeRulesUrl(cursor),
        headers: { [HEADER]: ADMIN_KEY },
      });
      assert.equal(res.statusCode, 200);
      const body = res.json() as {
        count: number;
        nextCursor: string | null;
        items: Array<Record<string, unknown>>;
      };
      assert.equal(body.count, 1);
      assert.equal(body.items.length, 1);
      const item = body.items[0]!;
      assert.equal(item.active, true);
      assert.notEqual(item.id, inactiveId);
      for (const key of FORBIDDEN) assert.equal(key in item, false);
      if (typeof item.id === "string" && want.has(item.id)) seen.add(item.id);
      if (item.id === createdRuleIds[0]) {
        assert.equal(item.formId, "form_inventory_a");
        assert.equal(item.keywordPattern, "inventory-keyword-a");
        assert.equal(item.clientAccountId, CLIENT_A);
        assert.equal(item.deliveryEnabled, false);
        assert.equal(item.campaignId, "inventory_campaign_a");
      }
      if (item.id === createdRuleIds[2]) {
        assert.equal(item.clientAccountId, CLIENT_B);
        assert.equal(item.keywordPattern, "inventory-keyword-b");
        assert.equal(item.deliveryEnabled, true);
      }
      cursor = body.nextCursor;
      if (!cursor) break;
    }
    assert.equal(seen.size, 2);

    const badCursor = await app.inject({
      method: "GET",
      url: "/admin/v1/routing/active-rules?cursor=not-a-real-cursor",
      headers: { [HEADER]: ADMIN_KEY },
    });
    assert.equal(badCursor.statusCode, 400);
    assert.equal((badCursor.json() as { code?: string }).code, "invalid_cursor");
  });
});
