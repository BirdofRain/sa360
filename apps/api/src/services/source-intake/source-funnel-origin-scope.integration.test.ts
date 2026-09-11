import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { isOriginClientBuyerIneligible } from "../ppl-fulfillment/origin-client-exclusion.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import { confirmSourceFunnelOrigin } from "./source-funnel.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const PREFIX = "sf_scope";
const CLIENT_A = `${PREFIX}_a`;
const MATCH_FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0401";
const OTHER_FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0402";
const FAIL_TRIGGER = "sa360_sf_scope_fail_origin_stamp";

function nextgenPayload(input: {
  leadId: string;
  funnelId: string;
  email: string;
  phone: string;
}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    funnel_id: input.funnelId,
    funnel_name: "Life Insurance For Veterans - Scope",
    lead_id: input.leadId,
    submitted_at: "2026-01-01T00:00:00.000Z",
    first_name: "Origin",
    last_name: "Scope",
    email: input.email,
    phone: input.phone,
    state: "NC",
  };
}

describe("SourceFunnel origin correction scope + atomicity", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdClientIds = [CLIENT_A];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FAIL_TRIGGER} ON "LeadInventoryItem"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FAIL_TRIGGER}()`);
    await db.leadInventoryItem.deleteMany({
      where: { originClientAccountId: { in: createdClientIds } },
    });
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: createdClientIds } },
          { suggestedClientAccountId: { in: createdClientIds } },
          {
            provider: "leadcapture_io",
            providerFunnelId: { in: [MATCH_FUNNEL_ID, OTHER_FUNNEL_ID] },
          },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db.clientAccount.create({
      data: { clientAccountId: CLIENT_A, clientDisplayName: "Scope Client A", status: "active" },
    });
  });

  after(async () => {
    await db?.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FAIL_TRIGGER} ON "LeadInventoryItem"`);
    await db?.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FAIL_TRIGGER}()`);
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db.sourceFunnel.deleteMany({
      where: {
        provider: "leadcapture_io",
        providerFunnelId: { in: [MATCH_FUNNEL_ID, OTHER_FUNNEL_ID] },
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db?.$disconnect();
  });

  it("stamps only matching provider+campaign inventory and rolls back when stamp fails", async () => {
    const matching = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555801",
        funnelId: MATCH_FUNNEL_ID,
        email: "sf.scope.match@example.test",
        phone: "5550109801",
      }),
      stageOverride: "inventory_only",
    });
    const unrelatedCampaign = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555802",
        funnelId: OTHER_FUNNEL_ID,
        email: "sf.scope.othercamp@example.test",
        phone: "5550109802",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(matching.sourceEventId, unrelatedCampaign.sourceEventId);

    const matchingItem = await db.leadInventoryItem.findUniqueOrThrow({
      where: { sourceLeadEventId: matching.sourceEventId },
    });
    const facebookEvent = await db.sourceLeadEvent.create({
      data: {
        sourceProvider: "facebook",
        sourceSystem: "meta_lead_ads",
        sourceType: "webhook",
        sourceCampaignId: MATCH_FUNNEL_ID,
        sourceLeadId: "fb-same-campaign-scope",
        status: "received",
        rawPayloadJson: { id: "fb-same-campaign-scope" },
      },
    });
    createdEventIds.push(facebookEvent.id);
    await db.leadInventoryItem.create({
      data: {
        inventoryLotId: matchingItem.inventoryLotId,
        sourceLeadEventId: facebookEvent.id,
        generatedAt: matchingItem.generatedAt,
        normalizedState: "NC",
        nicheKey: matchingItem.nicheKey,
        sourceProvider: "facebook",
        sourceLane: "meta_lead_ads",
        inventoryClass: matchingItem.inventoryClass,
        exclusivityMode: matchingItem.exclusivityMode,
        status: "available",
        availableAt: matchingItem.availableAt,
        originClientAccountId: null,
      },
    });

    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: "leadcapture_io",
          providerFunnelId: MATCH_FUNNEL_ID,
        },
      },
    });
    assert.ok(funnel);
    assert.equal(funnel.associationStatus, "unassociated");

    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION ${FAIL_TRIGGER}()
      RETURNS trigger AS $$
      BEGIN
        IF NEW."originClientAccountId" = '${CLIENT_A}' THEN
          RAISE EXCEPTION 'forced_origin_stamp_failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER ${FAIL_TRIGGER}
      BEFORE UPDATE ON "LeadInventoryItem"
      FOR EACH ROW
      EXECUTE FUNCTION ${FAIL_TRIGGER}();
    `);

    await assert.rejects(
      () =>
        confirmSourceFunnelOrigin(
          { sourceFunnelId: funnel.id, originClientAccountId: CLIENT_A },
          db
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /forced_origin_stamp_failure/);
        return true;
      }
    );

    const rolledBack = await db.sourceFunnel.findUnique({ where: { id: funnel.id } });
    assert.equal(rolledBack?.associationStatus, "unassociated");
    assert.equal(rolledBack?.originClientAccountId, null);
    const afterFail = await db.leadInventoryItem.findUniqueOrThrow({
      where: { sourceLeadEventId: matching.sourceEventId },
    });
    assert.equal(afterFail.originClientAccountId, null);

    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${FAIL_TRIGGER} ON "LeadInventoryItem"`);
    await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${FAIL_TRIGGER}()`);

    const confirmed = await confirmSourceFunnelOrigin(
      { sourceFunnelId: funnel.id, originClientAccountId: CLIENT_A },
      db
    );
    assert.equal(confirmed.sourceFunnel.associationStatus, "confirmed");
    assert.equal(confirmed.sourceFunnel.originClientAccountId, CLIENT_A);
    assert.equal(confirmed.backfilledInventoryCount, 1);

    const afterConfirm = await db.leadInventoryItem.findMany({
      where: { sourceLeadEventId: { in: createdEventIds } },
    });
    const byEvent = Object.fromEntries(
      afterConfirm.map((row) => [row.sourceLeadEventId, row.originClientAccountId])
    );
    assert.equal(byEvent[matching.sourceEventId], CLIENT_A);
    assert.equal(byEvent[unrelatedCampaign.sourceEventId], null);
    assert.equal(byEvent[facebookEvent.id], null);
    assert.equal(isOriginClientBuyerIneligible(byEvent[matching.sourceEventId], CLIENT_A), true);
    assert.equal(
      isOriginClientBuyerIneligible(byEvent[unrelatedCampaign.sourceEventId], CLIENT_A),
      false
    );
    assert.equal(isOriginClientBuyerIneligible(byEvent[facebookEvent.id], CLIENT_A), false);
  });
});
