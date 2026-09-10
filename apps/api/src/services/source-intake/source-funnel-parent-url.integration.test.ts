import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { isOriginClientBuyerIneligible } from "../ppl-fulfillment/origin-client-exclusion.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import {
  associateSourceFunnelByPageUrl,
  clearSourceFunnelAssociation,
  confirmSourceFunnelOrigin,
  isSourceFunnelOriginCorrectionError,
} from "./source-funnel.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const PREFIX = "sf_purl";
const UNIQUE_CLIENT_ID = `${PREFIX}_madison`;
const OTHER_CLIENT_ID = `${PREFIX}_other`;
const PARENT_KEY_DN = "my.leadcapture.io/p/dn_omzoj";
const PARENT_KEY_DUP = "my.leadcapture.io/p/6rci-usi";
const PARENT_KEY_PRE = "my.leadcapture.io/p/prereg01";
const PARENT_KEY_SUGG = "my.leadcapture.io/p/suggslug";
const RECONCILE_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0311";
const CONFLICT_UUID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0312";
const ANDRU_ROUTE = "LCIO_NG_NURSE_ANDRU_DURANSO";

function nextgenPayload(input: {
  leadId: string;
  email: string;
  phone: string;
  parentUrl?: string;
  funnelId?: string;
  funnelName?: string;
  routeKey?: string;
}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    lead_id: input.leadId,
    submitted_at: "2026-01-01T00:00:00.000Z",
    first_name: "Parent",
    last_name: "Url",
    email: input.email,
    phone: input.phone,
    state: "NC",
    ...(input.parentUrl ? { parent_url: input.parentUrl } : {}),
    ...(input.funnelId ? { funnel_id: input.funnelId } : {}),
    ...(input.funnelName ? { funnel_name: input.funnelName } : {}),
    ...(input.routeKey
      ? { sa360_route_key: input.routeKey, campaign_id: input.routeKey }
      : {}),
  };
}

describe("SourceFunnel parent_url_key identity", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdFunnelIds: string[] = [];
  const createdClientIds = [UNIQUE_CLIENT_ID, OTHER_CLIENT_ID];
  const parentUrlKeys = [PARENT_KEY_DN, PARENT_KEY_DUP, PARENT_KEY_PRE, PARENT_KEY_SUGG];
  const providerFunnelIds = [RECONCILE_UUID, CONFLICT_UUID];

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
          { provider: "leadcapture_io", parentUrlKey: { in: parentUrlKeys } },
          { provider: "leadcapture_io", providerFunnelId: { in: providerFunnelIds } },
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
          clientAccountId: OTHER_CLIENT_ID,
          clientDisplayName: "Parent Url Other Client",
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
        OR: [
          { provider: "leadcapture_io", parentUrlKey: { in: parentUrlKeys } },
          { provider: "leadcapture_io", providerFunnelId: { in: providerFunnelIds } },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: createdClientIds } } });
    await db?.$disconnect();
  });

  it("reuses one SourceFunnel for the same parent_url with different ?v values", async () => {
    const first = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555801",
        email: "sf.purl.v1@example.test",
        phone: "5550109801",
        parentUrl: "https://my.leadcapture.io/p/dn_omzoj?v=1",
        funnelName: "Life Insurance For Veterans - Madison Pimentel V2",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(first.sourceEventId);
    assert.equal(first.status === "normalized" || first.status === "needs_review", true);

    const second = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555802",
        email: "sf.purl.v999@example.test",
        phone: "5550109802",
        parentUrl: "https://my.leadcapture.io/p/dn_omzoj?v=999",
        funnelName: "Life Insurance For Veterans - Madison Pimentel V2",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(second.sourceEventId);

    const funnels = await db.sourceFunnel.findMany({
      where: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_DN },
    });
    assert.equal(funnels.length, 1);
    createdFunnelIds.push(funnels[0]!.id);
    assert.equal(funnels[0]!.providerFunnelId, null);
    assert.equal(funnels[0]!.pageSlug, "dn_omzoj");
    assert.equal(
      funnels[0]!.observedFunnelName,
      "Life Insurance For Veterans - Madison Pimentel V2"
    );

    const firstEvent = await db.sourceLeadEvent.findUnique({ where: { id: first.sourceEventId } });
    const secondEvent = await db.sourceLeadEvent.findUnique({
      where: { id: second.sourceEventId },
    });
    assert.equal(firstEvent?.sourceCampaignId, PARENT_KEY_DN);
    assert.equal(secondEvent?.sourceCampaignId, PARENT_KEY_DN);

    const firstItem = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: first.sourceEventId },
    });
    const secondItem = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: second.sourceEventId },
    });
    assert.ok(firstItem);
    assert.ok(secondItem);
    assert.equal(firstItem?.originClientAccountId, null);
    assert.equal(secondItem?.originClientAccountId, null);
  });

  it("treats a duplicated funnel page slug as a different SourceFunnel", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555803",
        email: "sf.purl.dup@example.test",
        phone: "5550109803",
        parentUrl: "https://my.leadcapture.io/p/6rci-usi?v=1",
        funnelName: "Life Insurance For Veterans - Madison Pimentel V2 Copy",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const original = await db.sourceFunnel.findUnique({
      where: { provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_DN } },
    });
    const duplicate = await db.sourceFunnel.findUnique({
      where: {
        provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_DUP },
      },
    });
    assert.ok(original);
    assert.ok(duplicate);
    createdFunnelIds.push(duplicate.id);
    assert.notEqual(original.id, duplicate.id);
    assert.equal(duplicate.pageSlug, "6rci-usi");
  });

  it("lets parent_url_key beat a stale sa360_route_key", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555804",
        email: "sf.purl.stale@example.test",
        phone: "5550109804",
        parentUrl: "https://my.leadcapture.io/p/dn_omzoj?v=555",
        funnelName: "Life Insurance For Veterans - Madison Pimentel V2",
        routeKey: ANDRU_ROUTE,
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);
    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.equal(event?.sourceCampaignId, PARENT_KEY_DN);
    assert.notEqual(event?.sourceCampaignId, ANDRU_ROUTE);
  });

  it("updates observedFunnelName on rename without creating a new SourceFunnel", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555805",
        email: "sf.purl.rename@example.test",
        phone: "5550109805",
        parentUrl: "https://my.leadcapture.io/p/dn_omzoj?v=777",
        funnelName: "Life Insurance For Veterans - Madison Pimentel V9",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const funnels = await db.sourceFunnel.findMany({
      where: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_DN },
    });
    assert.equal(funnels.length, 1);
    assert.equal(
      funnels[0]!.observedFunnelName,
      "Life Insurance For Veterans - Madison Pimentel V9"
    );
  });

  it("creates inventory_only inventory from lead_id + parent_url + funnel_name with no funnel_id", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555806",
        email: "sf.purl.natural@example.test",
        phone: "5550109806",
        parentUrl: "https://my.leadcapture.io/p/dn_omzoj?v=888",
        funnelName: "Life Insurance For Veterans - Unknown Natural Client",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);
    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.ok(event);
    assert.equal(event?.sourceCampaignId, PARENT_KEY_DN);
    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
    assert.equal(item?.nicheKey, "vet_fex");
    assert.equal(item?.originClientAccountId, null);
    assert.equal(item?.status, "available");
  });

  it("keeps exact unique client-name match as suggestion only for parent_url_key sources", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555811",
        email: "sf.purl.sugg@example.test",
        phone: "5550109811",
        parentUrl: "https://my.leadcapture.io/p/suggslug?v=1",
        funnelName: "Life Insurance For Veterans - Madison Pimentel V2",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);
    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_SUGG },
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

  it("pre-registers and confirms a parentUrlKey, then stamps origin on the first natural lead", async () => {
    const associated = await associateSourceFunnelByPageUrl({
      originClientAccountId: UNIQUE_CLIENT_ID,
      pageUrlOrSlug: "prereg01",
    });
    createdFunnelIds.push(associated.sourceFunnel.id);
    assert.equal(associated.created, true);
    assert.equal(associated.parentUrlKey, PARENT_KEY_PRE);
    assert.equal(associated.sourceFunnel.associationStatus, "confirmed");
    assert.equal(associated.sourceFunnel.originClientAccountId, UNIQUE_CLIENT_ID);
    assert.equal(associated.sourceFunnel.firstSeenAt, null);
    assert.equal(associated.sourceFunnel.lastSeenAt, null);

    const lead = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555807",
        email: "sf.purl.prereg@example.test",
        phone: "5550109807",
        parentUrl: "https://my.leadcapture.io/p/prereg01?v=1",
        funnelName: "Life Insurance For Veterans - Madison Pimentel V2",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(lead.sourceEventId);

    const reused = await db.sourceFunnel.findUnique({ where: { id: associated.sourceFunnel.id } });
    assert.equal(reused?.id, associated.sourceFunnel.id);
    assert.equal(reused?.associationStatus, "confirmed");
    assert.equal(reused?.originClientAccountId, UNIQUE_CLIENT_ID);
    assert.equal(
      reused?.observedFunnelName,
      "Life Insurance For Veterans - Madison Pimentel V2"
    );
    assert.ok(reused?.firstSeenAt);
    assert.ok(reused?.lastSeenAt);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: lead.sourceEventId },
    });
    assert.equal(item?.originClientAccountId, UNIQUE_CLIENT_ID);
    assert.equal(isOriginClientBuyerIneligible(item?.originClientAccountId, UNIQUE_CLIENT_ID), true);
    assert.equal(isOriginClientBuyerIneligible(item?.originClientAccountId, OTHER_CLIENT_ID), false);

    const byFullUrl = await associateSourceFunnelByPageUrl({
      originClientAccountId: UNIQUE_CLIENT_ID,
      pageUrlOrSlug: "https://my.leadcapture.io/p/prereg01?v=anything",
    });
    assert.equal(byFullUrl.created, false);
    assert.equal(byFullUrl.sourceFunnel.id, associated.sourceFunnel.id);
  });

  it("attaches a later funnel UUID onto the existing parentUrlKey SourceFunnel", async () => {
    const before = await db.sourceFunnel.findUnique({
      where: { provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_DN } },
    });
    assert.ok(before);
    assert.equal(before.providerFunnelId, null);

    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555808",
        email: "sf.purl.reconcile@example.test",
        phone: "5550109808",
        parentUrl: "https://my.leadcapture.io/p/dn_omzoj?v=42",
        funnelId: RECONCILE_UUID,
        funnelName: "Life Insurance For Veterans - Madison Pimentel V2",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const after = await db.sourceFunnel.findUnique({ where: { id: before.id } });
    assert.equal(after?.providerFunnelId, RECONCILE_UUID);
    assert.equal(after?.parentUrlKey, PARENT_KEY_DN);
    const sameByUuid = await db.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: "leadcapture_io",
          providerFunnelId: RECONCILE_UUID,
        },
      },
    });
    assert.equal(sameByUuid?.id, before.id);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.equal(event?.sourceCampaignId, RECONCILE_UUID);
  });

  it("does not silently merge conflicting UUID and parentUrlKey mappings and still retains inventory", async () => {
    const uuidOnly = await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: CONFLICT_UUID,
        observedFunnelName: "UUID-only conflict funnel",
        associationStatus: "unassociated",
        firstSeenAt: new Date("2026-01-01T00:00:00.000Z"),
        lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    createdFunnelIds.push(uuidOnly.id);

    const urlRow = await db.sourceFunnel.findUnique({
      where: { provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_DN } },
    });
    assert.ok(urlRow);
    assert.notEqual(urlRow.id, uuidOnly.id);

    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555809",
        email: "sf.purl.conflict@example.test",
        phone: "5550109809",
        parentUrl: "https://my.leadcapture.io/p/dn_omzoj?v=conflict",
        funnelId: CONFLICT_UUID,
        funnelName: "Life Insurance For Veterans - Conflict Case",
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);

    const stillUuid = await db.sourceFunnel.findUnique({ where: { id: uuidOnly.id } });
    const stillUrl = await db.sourceFunnel.findUnique({ where: { id: urlRow.id } });
    assert.ok(stillUuid);
    assert.ok(stillUrl);
    assert.notEqual(stillUuid.id, stillUrl.id);
    assert.equal(stillUuid.parentUrlKey, null);
    assert.notEqual(stillUrl.providerFunnelId, CONFLICT_UUID);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.equal(event?.sourceCampaignId, CONFLICT_UUID);
    const enrichment = event?.enrichmentMetadataJson as Record<string, unknown> | null;
    assert.equal(enrichment?.sourceFunnelIdentityConflict, true);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
    assert.equal(item?.originClientAccountId, null);
  });

  it("falls through fail-soft for malformed parent_url and still retains the lead", async () => {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: nextgenPayload({
        leadId: "d1111111-2222-4333-8444-555555555810",
        email: "sf.purl.malformed@example.test",
        phone: "5550109810",
        parentUrl: "not-a-url",
        routeKey: ANDRU_ROUTE,
      }),
      stageOverride: "inventory_only",
    });
    createdEventIds.push(result.sourceEventId);
    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.equal(event?.sourceCampaignId, ANDRU_ROUTE);
    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
  });

  it("rejects invalid operator slug/url without creating a SourceFunnel", async () => {
    await assert.rejects(
      () =>
        associateSourceFunnelByPageUrl({
          originClientAccountId: UNIQUE_CLIENT_ID,
          pageUrlOrSlug: "not a slug",
        }),
      (err: unknown) => {
        assert.equal(isSourceFunnelOriginCorrectionError(err), true);
        if (!isSourceFunnelOriginCorrectionError(err)) return false;
        assert.equal(err.code, "invalid_page_url_or_slug");
        return true;
      }
    );
  });

  it("confirm/clear scoped to parentUrlKey identities remains correction-safe", async () => {
    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_parentUrlKey: { provider: "leadcapture_io", parentUrlKey: PARENT_KEY_PRE },
      },
    });
    assert.ok(funnel);
    assert.equal(funnel.associationStatus, "confirmed");

    const cleared = await clearSourceFunnelAssociation(funnel.id);
    assert.equal(cleared.sourceFunnel.associationStatus, "unassociated");
    assert.equal(cleared.sourceFunnel.originClientAccountId, null);
    assert.ok(cleared.clearedInventoryCount >= 1);

    const reconfirmed = await confirmSourceFunnelOrigin({
      sourceFunnelId: funnel.id,
      originClientAccountId: UNIQUE_CLIENT_ID,
    });
    assert.equal(reconfirmed.sourceFunnel.associationStatus, "confirmed");
    assert.ok(reconfirmed.backfilledInventoryCount >= 1);
  });
});
