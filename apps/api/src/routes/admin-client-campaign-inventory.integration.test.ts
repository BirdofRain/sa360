import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { adminClientCampaignInventoryRoutes } from "./admin-client-campaign-inventory.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const HEADER = "x-sa360-admin-key";
const ADMIN_KEY = "campaign-inventory-integration";
const CLIENT_A = "camp_inv_ray";
const CLIENT_B = "camp_inv_other";

describe("client campaign inventory read", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof Fastify>>;
  const previousAdminKey = process.env.ADMIN_API_KEY;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.sourceLeadEvent.deleteMany({ where: { sourceCampaignId: { in: ["my.leadcapture.io/p/camp-inv-vet", "camp_inv_keyword"] } } });
    await db.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } } });
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: [CLIENT_A, CLIENT_B] } },
          { suggestedClientAccountId: { in: [CLIENT_A, CLIENT_B] } },
          { parentUrlKey: { in: ["my.leadcapture.io/p/camp-inv-vet", "my.leadcapture.io/p/camp-inv-nurse"] } },
        ],
      },
    });
    await db.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } } });
    await db.clientAccount.createMany({
      data: [
        {
          clientAccountId: CLIENT_A,
          clientDisplayName: "Ray Inventory",
          status: "active",
          primaryNicheKeys: ["vet_fex"],
          primaryProductTypes: ["life_insurance"],
        },
        { clientAccountId: CLIENT_B, clientDisplayName: "Other Inventory", status: "active" },
      ],
    });
    await db.clientGhlDestination.create({
      data: {
        clientAccountId: CLIENT_A,
        destinationSubaccountIdGhl: "loc_camp_inv",
        destinationWorkflowIdGhl: "wf_shared",
        deliveryEnabled: false,
        deliveryMode: "shadow",
      },
    });
    await db.sourceFunnel.createMany({
      data: [
        {
          provider: "leadcapture_io",
          providerFunnelId: "11111111-1111-4111-8111-111111111111",
          parentUrlKey: "my.leadcapture.io/p/camp-inv-vet",
          pageSlug: "camp-inv-vet",
          observedFunnelName: "Ray Rodriguez",
          nicheKey: "vet_fex",
          associationStatus: "confirmed",
          originClientAccountId: CLIENT_A,
          leadTypeKey: "vet_web_form",
        },
        {
          provider: "leadcapture_io",
          providerFunnelId: "22222222-2222-4222-8222-222222222222",
          parentUrlKey: "my.leadcapture.io/p/camp-inv-nurse",
          pageSlug: "camp-inv-nurse",
          observedFunnelName: "Ray Rodriguez",
          nicheKey: "nurse",
          associationStatus: "confirmed",
          originClientAccountId: CLIENT_A,
          leadTypeKey: "nurse_web_form",
        },
      ],
    });
    await db.campaignRoutingRule.createMany({
      data: [
        {
          masterClientAccountId: "master_camp_inv",
          clientAccountId: CLIENT_A,
          matchType: "campaign_id",
          campaignId: "my.leadcapture.io/p/camp-inv-vet",
          nicheKey: "vet_fex",
          productType: "life_insurance",
          destinationWorkflowIdGhl: "wf_vet",
          active: true,
          deliveryEnabled: false,
        },
        {
          masterClientAccountId: "master_camp_inv",
          clientAccountId: CLIENT_A,
          matchType: "keyword_fallback",
          keywordPattern: "veteran",
          nicheKey: "vet_fex",
          productType: "life_insurance",
          active: true,
          deliveryEnabled: false,
        },
      ],
    });
    await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceCampaignId: "my.leadcapture.io/p/camp-inv-vet",
        clientAccountIdResolved: CLIENT_A,
        rawPayloadJson: { inventory: "read-only" },
        receivedAt: new Date("2026-11-18T12:00:00.000Z"),
      },
    });
    app = Fastify({ logger: false });
    await app.register(adminClientCampaignInventoryRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    if (!db) return;
    await db.sourceLeadEvent.deleteMany({
      where: { sourceCampaignId: { in: ["my.leadcapture.io/p/camp-inv-vet", "camp_inv_keyword"] } },
    });
    await db.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } } });
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: [CLIENT_A, CLIENT_B] } },
          { parentUrlKey: { in: ["my.leadcapture.io/p/camp-inv-vet", "my.leadcapture.io/p/camp-inv-nurse"] } },
        ],
      },
    });
    await db.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: [CLIENT_A, CLIENT_B] } } });
    await db.$disconnect();
    if (previousAdminKey !== undefined) process.env.ADMIN_API_KEY = previousAdminKey;
    else delete process.env.ADMIN_API_KEY;
    if (previousDatabaseUrl !== undefined) process.env.DATABASE_URL = previousDatabaseUrl;
    else delete process.env.DATABASE_URL;
  });

  it("returns separate vet and nurse candidates and does not write", async () => {
    const beforeRules = await db.campaignRoutingRule.count({ where: { clientAccountId: CLIENT_A } });
    const beforeFunnels = await db.sourceFunnel.count({ where: { originClientAccountId: CLIENT_A } });
    const beforeDelivery = await db.clientGhlDestination.findUniqueOrThrow({
      where: { clientAccountId: CLIENT_A },
      select: { deliveryEnabled: true },
    });

    const res = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT_A}/campaign-inventory`,
      headers: { [HEADER]: ADMIN_KEY },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      readOnly: boolean;
      writesPerformed: boolean;
      summary: { candidateCount: number; confirmedSourceCount: number; looseRuleCount: number };
      candidates: Array<{
        grouping: string;
        nicheKeys: string[];
        sources: Array<{ id: string; leadTypeLabel: string | null }>;
        rules: Array<{ matchType: string }>;
        lastSourceEvent: { sourceCampaignId: string | null } | null;
        ghl: { locationId: string | null; ruleWorkflowIds: string[] };
        conflicts: string[];
      }>;
      conflicts: Array<{ code: string }>;
    };
    assert.equal(body.readOnly, true);
    assert.equal(body.writesPerformed, false);
    assert.equal(body.summary.confirmedSourceCount, 2);
    assert.equal(body.summary.looseRuleCount, 1);
    assert.equal(body.summary.candidateCount, 3);
    const niches = body.candidates.flatMap((candidate) => candidate.nicheKeys).sort();
    assert.deepEqual(niches, ["nurse", "vet_fex", "vet_fex"]);
    const joined = body.candidates.find((candidate) => candidate.grouping === "exact_identifier");
    assert.equal(joined?.sources[0]?.leadTypeLabel, "Vet Web Form");
    assert.equal(joined?.rules[0]?.matchType, "campaign_id");
    assert.equal(joined?.lastSourceEvent?.sourceCampaignId, "my.leadcapture.io/p/camp-inv-vet");
    assert.equal(joined?.ghl.locationId, "loc_camp_inv");
    assert.deepEqual(joined?.ghl.ruleWorkflowIds, ["wf_vet"]);
    assert.equal(body.conflicts.some((item) => item.code === "missing_sheets_destination"), true);
    assert.equal(JSON.stringify(body).includes("rawPayload"), false);

    assert.equal(await db.campaignRoutingRule.count({ where: { clientAccountId: CLIENT_A } }), beforeRules);
    assert.equal(await db.sourceFunnel.count({ where: { originClientAccountId: CLIENT_A } }), beforeFunnels);
    const afterDelivery = await db.clientGhlDestination.findUniqueOrThrow({
      where: { clientAccountId: CLIENT_A },
      select: { deliveryEnabled: true },
    });
    assert.equal(afterDelivery.deliveryEnabled, beforeDelivery.deliveryEnabled);
  });

  it("returns 404 for an unknown client", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/clients/camp_inv_missing/campaign-inventory",
      headers: { [HEADER]: ADMIN_KEY },
    });
    assert.equal(res.statusCode, 404);
    assert.equal(res.json().ok, false);
  });
});
