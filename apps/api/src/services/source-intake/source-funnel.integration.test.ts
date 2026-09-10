import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import {
  clearSourceFunnelAssociation,
  confirmSourceFunnelOrigin,
} from "./source-funnel.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const PREFIX = "sf_foundation";
const UNIQUE_CLIENT_ID = `${PREFIX}_madison`;
const AMBIGUOUS_A_ID = `${PREFIX}_amb_a`;
const AMBIGUOUS_B_ID = `${PREFIX}_amb_b`;
const UNIQUE_FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0101";
const NO_MATCH_FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0102";
const AMBIGUOUS_FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0103";
const CONFIRM_FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0104";
const RENAME_FUNNEL_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0105";

function nextgenPayload(input: {
  leadId: string;
  funnelId?: string;
  funnelName?: string;
  routeKey?: string;
  email: string;
  phone: string;
}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    ...(input.routeKey ? { sa360_route_key: input.routeKey, campaign_id: input.routeKey } : {}),
    ...(input.funnelId ? { funnel_id: input.funnelId } : {}),
    ...(input.funnelName ? { funnel_name: input.funnelName } : {}),
    lead_id: input.leadId,
    submitted_at: "2026-01-01T00:00:00.000Z",
    first_name: "Source",
    last_name: "Funnel",
    email: input.email,
    phone: input.phone,
    state: "NC",
  };
}

describe("SourceFunnel NextGen observation and origin stamp", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdFunnelIds: string[] = [];
  const createdClientIds = [UNIQUE_CLIENT_ID, AMBIGUOUS_A_ID, AMBIGUOUS_B_ID];

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
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
            providerFunnelId: {
              in: [
                UNIQUE_FUNNEL_ID,
                NO_MATCH_FUNNEL_ID,
                AMBIGUOUS_FUNNEL_ID,
                CONFIRM_FUNNEL_ID,
                RENAME_FUNNEL_ID,
              ],
            },
          },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db.clientAccount.createMany({
      data: [
        {
          clientAccountId: UNIQUE_CLIENT_ID,
          clientDisplayName: "Madison Pimentel",
          status: "active",
        },
        {
          clientAccountId: AMBIGUOUS_A_ID,
          clientDisplayName: "Ambiguous Agent",
          status: "active",
        },
        {
          clientAccountId: AMBIGUOUS_B_ID,
          clientDisplayName: "  Ambiguous   Agent ",
          status: "active",
        },
      ],
    });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    if (createdFunnelIds.length > 0) {
      await db.sourceFunnel.deleteMany({ where: { id: { in: createdFunnelIds } } });
    }
    await db.sourceFunnel.deleteMany({
      where: {
        provider: "leadcapture_io",
        providerFunnelId: {
          in: [
            UNIQUE_FUNNEL_ID,
            NO_MATCH_FUNNEL_ID,
            AMBIGUOUS_FUNNEL_ID,
            CONFIRM_FUNNEL_ID,
            RENAME_FUNNEL_ID,
          ],
        },
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db?.$disconnect();
  });

  it("retains inventory with a new known-niche funnel and no client match; origin stays null", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555601",
        funnelId: NO_MATCH_FUNNEL_ID,
        funnelName: "Life Insurance For Veterans - Unknown Client Name",
        email: "sf.nomatch@example.test",
        phone: "5550109601",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: "leadcapture_io",
          providerFunnelId: NO_MATCH_FUNNEL_ID,
        },
      },
    });
    assert.ok(funnel);
    createdFunnelIds.push(funnel.id);
    assert.equal(funnel.associationStatus, "unassociated");
    assert.equal(funnel.originClientAccountId, null);
    assert.equal(funnel.suggestedClientAccountId, null);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
    assert.equal(item?.originClientAccountId, null);
    assert.equal(item?.nicheKey, "vet_fex");
    assert.equal(item?.status, "available");
  });

  it("creates a suggestion for an exact unique client name without auto-confirming", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555602",
        funnelId: UNIQUE_FUNNEL_ID,
        funnelName: "Life Insurance For Veterans - Madison Pimentel - V2",
        email: "sf.unique@example.test",
        phone: "5550109602",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: "leadcapture_io",
          providerFunnelId: UNIQUE_FUNNEL_ID,
        },
      },
    });
    assert.ok(funnel);
    createdFunnelIds.push(funnel.id);
    assert.equal(funnel.associationStatus, "suggested");
    assert.equal(funnel.suggestedClientAccountId, UNIQUE_CLIENT_ID);
    assert.equal(funnel.originClientAccountId, null);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
    assert.equal(item?.originClientAccountId, null);
  });

  it("does not auto-associate an ambiguous client-name match and still retains inventory", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555603",
        funnelId: AMBIGUOUS_FUNNEL_ID,
        funnelName: "Life Insurance For Nurses - Ambiguous Agent",
        email: "sf.ambiguous@example.test",
        phone: "5550109603",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: "leadcapture_io",
          providerFunnelId: AMBIGUOUS_FUNNEL_ID,
        },
      },
    });
    assert.ok(funnel);
    createdFunnelIds.push(funnel.id);
    assert.equal(funnel.associationStatus, "unassociated");
    assert.equal(funnel.suggestedClientAccountId, null);
    assert.equal(funnel.originClientAccountId, null);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
    assert.equal(item?.originClientAccountId, null);
    assert.equal(item?.nicheKey, "nurse_life");
  });

  it("stamps origin on new inventory after confirmation and preserves origin across rename", async () => {
    const first = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555604",
        funnelId: CONFIRM_FUNNEL_ID,
        funnelName: "Life Insurance For Veterans - Madison Pimentel",
        email: "sf.confirm@example.test",
        phone: "5550109604",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(first.sourceEventId);

    const before = await db.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: "leadcapture_io",
          providerFunnelId: CONFIRM_FUNNEL_ID,
        },
      },
    });
    assert.ok(before);
    createdFunnelIds.push(before.id);
    assert.equal(before.associationStatus, "suggested");

    const confirmed = await confirmSourceFunnelOrigin({
      sourceFunnelId: before.id,
      originClientAccountId: UNIQUE_CLIENT_ID,
    });
    assert.equal(confirmed.sourceFunnel.associationStatus, "confirmed");
    assert.equal(confirmed.sourceFunnel.originClientAccountId, UNIQUE_CLIENT_ID);
    assert.ok(confirmed.backfilledInventoryCount >= 1);

    const backfilled = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: first.sourceEventId },
    });
    assert.equal(backfilled?.originClientAccountId, UNIQUE_CLIENT_ID);

    const second = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555605",
        funnelId: CONFIRM_FUNNEL_ID,
        funnelName: "Life Insurance For Veterans - Madison Pimentel - V9",
        email: "sf.confirm2@example.test",
        phone: "5550109605",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(second.sourceEventId);

    const renamed = await db.sourceFunnel.findUnique({ where: { id: before.id } });
    assert.equal(renamed?.observedFunnelName, "Life Insurance For Veterans - Madison Pimentel - V9");
    assert.equal(renamed?.associationStatus, "confirmed");
    assert.equal(renamed?.originClientAccountId, UNIQUE_CLIENT_ID);

    const stamped = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: second.sourceEventId },
    });
    assert.equal(stamped?.originClientAccountId, UNIQUE_CLIENT_ID);

    await clearSourceFunnelAssociation(before.id);
    const cleared = await db.sourceFunnel.findUnique({ where: { id: before.id } });
    assert.equal(cleared?.associationStatus, "unassociated");
    assert.equal(cleared?.originClientAccountId, null);
  });

  it("updates observed name on a pre-confirmed funnel without clearing origin", async () => {
    const created = await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: RENAME_FUNNEL_ID,
        observedFunnelName: "Life Insurance For Nurses - Madison Pimentel",
        nicheKey: "nurse_life",
        associationStatus: "confirmed",
        originClientAccountId: UNIQUE_CLIENT_ID,
        firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    createdFunnelIds.push(created.id);

    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555606",
        funnelId: RENAME_FUNNEL_ID,
        funnelName: "Life Insurance For Nurses - Madison Pimentel - V4",
        email: "sf.rename@example.test",
        phone: "5550109606",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const funnel = await db.sourceFunnel.findUnique({ where: { id: created.id } });
    assert.equal(funnel?.observedFunnelName, "Life Insurance For Nurses - Madison Pimentel - V4");
    assert.equal(funnel?.associationStatus, "confirmed");
    assert.equal(funnel?.originClientAccountId, UNIQUE_CLIENT_ID);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.equal(item?.originClientAccountId, UNIQUE_CLIENT_ID);
  });

  it("does not fabricate a SourceFunnel UUID when funnel_id is missing", async () => {
    const beforeCount = await db.sourceFunnel.count({
      where: { provider: "leadcapture_io", providerFunnelId: "UNKNOWN_ROUTE" },
    });
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555607",
        routeKey: "LCIO_NG_NURSE_ANDRU_DURANSO",
        email: "sf.missingfunnel@example.test",
        phone: "5550109607",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);
    assert.equal(result.status === "normalized" || result.status === "needs_review", true);

    const fabricated = await db.sourceFunnel.count({
      where: { provider: "leadcapture_io", providerFunnelId: "UNKNOWN_ROUTE" },
    });
    assert.equal(fabricated, beforeCount);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
    assert.equal(item?.originClientAccountId, null);
  });
});
