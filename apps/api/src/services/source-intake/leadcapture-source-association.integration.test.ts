import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import nicholasFixture from "../../fixtures/leadcaptureio/leadcaptureio-webhook-sample-legacy-custom-domain-nicholas.json" with { type: "json" };
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { resolveConfirmedLeadCaptureSourceAssociation } from "./leadcapture-source-association.service.js";
import { leadCaptureSourceIdentitySignalsFromPayload } from "./leadcapture-source-identity-signals.js";
import { associateSourceFunnelByPageUrl } from "./source-funnel.service.js";
import { processLeadCaptureIoWebhookIntake } from "./source-lead-intake.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const NICHOLAS_CLIENT_ID = "nick_dambruoso";
const NICHOLAS_DISPLAY_NAME = "Nick D'Ambruoso";
const NICHOLAS_ROUTE_KEY = "LCIO_LEGACY_VET_LIFE_NICHOLAS_DAMBRUOSO_VET_FEX";
const NICHOLAS_PAGE_URL =
  "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso?utm_source=Facebook_Mobile_Reels&utm_id=120251523590960287";
const NICHOLAS_PARENT_URL_KEY = "go.lifeinsuranceforvets.com/learn-nicholas-dambruoso";
const NICHOLAS_LEAD_FORM = "24133";

/** Different client, different configured page, same page slug on a different host. */
const OTHER_CLIENT_ID = "lcsa_other_client";
const OTHER_PARENT_URL_KEY = "go.otheragency.example/learn-nicholas-dambruoso";
const OTHER_CLIENT_PAGE_URL = "https://go.otheragency.example/learn-someone-else";
const OTHER_CLIENT_PARENT_URL_KEY = "go.otheragency.example/learn-someone-else";

const HOSTED_CLIENT_ID = "lcsa_hosted_client";
const HOSTED_PARENT_URL_KEY = "my.leadcapture.io/p/lcsa_dn_hosted";

const FORM_ID_CLIENT_ID = "lcsa_form_client";
const FORM_ID_PARENT_URL_KEY = "go.formidonly.example/learn-form-id-only";

const ROUTE_RULE_CLIENT_ID = "lcsa_route_rule_client";

const ALL_CLIENT_IDS = [
  NICHOLAS_CLIENT_ID,
  OTHER_CLIENT_ID,
  HOSTED_CLIENT_ID,
  FORM_ID_CLIENT_ID,
  ROUTE_RULE_CLIENT_ID,
];

const ALL_PARENT_URL_KEYS = [
  NICHOLAS_PARENT_URL_KEY,
  OTHER_PARENT_URL_KEY,
  OTHER_CLIENT_PARENT_URL_KEY,
  HOSTED_PARENT_URL_KEY,
  FORM_ID_PARENT_URL_KEY,
];

function legacyPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(nicholasFixture)) as Record<string, unknown>),
    ...overrides,
  };
}

describe("confirmed LeadCapture source association → routing", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const createdEventIds: string[] = [];
  const createdRuleIds: string[] = [];

  async function cleanup() {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({
        where: { sourceLeadEventId: { in: createdEventIds } },
      });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    if (createdRuleIds.length > 0) {
      await db.campaignRoutingRule.deleteMany({ where: { id: { in: createdRuleIds } } });
    }
    await db.leadInventoryItem.deleteMany({
      where: { originClientAccountId: { in: ALL_CLIENT_IDS } },
    });
    await db.sourceLeadEvent.deleteMany({ where: { sourceRouteKey: NICHOLAS_ROUTE_KEY } });
    await db.campaignRoutingRule.deleteMany({
      where: { clientAccountId: { in: ALL_CLIENT_IDS } },
    });
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: ALL_CLIENT_IDS } },
          { suggestedClientAccountId: { in: ALL_CLIENT_IDS } },
          { provider: "leadcapture_io", parentUrlKey: { in: ALL_PARENT_URL_KEYS } },
          { provider: "leadcapture_io", providerFunnelId: { in: [NICHOLAS_LEAD_FORM] } },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ALL_CLIENT_IDS } } });
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        {
          clientAccountId: NICHOLAS_CLIENT_ID,
          clientDisplayName: NICHOLAS_DISPLAY_NAME,
          status: "active",
        },
        {
          clientAccountId: OTHER_CLIENT_ID,
          clientDisplayName: "LCSA Other Agency",
          status: "active",
        },
        {
          clientAccountId: HOSTED_CLIENT_ID,
          clientDisplayName: "LCSA Hosted Page Client",
          status: "active",
        },
        {
          clientAccountId: FORM_ID_CLIENT_ID,
          clientDisplayName: "LCSA Form Id Client",
          status: "active",
        },
        {
          clientAccountId: ROUTE_RULE_CLIENT_ID,
          clientDisplayName: "LCSA Route Rule Client",
          status: "active",
        },
      ],
    });
  });

  after(async () => {
    await cleanup();
    await db?.$disconnect();
  });

  it("stores the custom hostname as part of the confirmed source identity", async () => {
    const associated = await associateSourceFunnelByPageUrl({
      originClientAccountId: NICHOLAS_CLIENT_ID,
      pageUrlOrSlug: NICHOLAS_PAGE_URL,
    });
    assert.equal(associated.created, true);
    assert.equal(associated.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
    assert.equal(associated.pageSlug, "learn-nicholas-dambruoso");
    assert.equal(associated.sourceFunnel.associationStatus, "confirmed");
    assert.equal(associated.sourceFunnel.originClientAccountId, NICHOLAS_CLIENT_ID);
    // Pre-registration must not fabricate an observation.
    assert.equal(associated.sourceFunnel.firstSeenAt, null);
    assert.equal(associated.sourceFunnel.lastSeenAt, null);
  });

  it("matches the confirmed source regardless of query parameters", async () => {
    const withUtms = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload(legacyPayload())
    );
    assert.equal(withUtms.matched, true);
    if (!withUtms.matched) return;
    assert.equal(withUtms.match.originClientAccountId, NICHOLAS_CLIENT_ID);
    assert.equal(withUtms.match.matchedBy, "parent_url_key");
    assert.equal(withUtms.match.matchEvidence, NICHOLAS_PARENT_URL_KEY);

    const bare = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload(
        legacyPayload({
          parent_url: "https://go.lifeinsuranceforvets.com/learn-nicholas-dambruoso/",
        })
      )
    );
    assert.equal(bare.matched, true);
    if (!bare.matched) return;
    assert.equal(bare.match.sourceFunnelId, withUtms.match.sourceFunnelId);
  });

  it("does not match the same pathname on a different domain", async () => {
    const result = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload(
        legacyPayload({
          parent_url: "https://go.otheragency.example/learn-nicholas-dambruoso?utm_source=x",
        })
      )
    );
    assert.equal(result.matched, false);
    if (result.matched) return;
    assert.equal(result.reason, "no_registered_source");
  });

  it("does not collide with another client that configured a different page", async () => {
    const other = await associateSourceFunnelByPageUrl({
      originClientAccountId: OTHER_CLIENT_ID,
      pageUrlOrSlug: OTHER_CLIENT_PAGE_URL,
    });
    assert.equal(other.parentUrlKey, OTHER_CLIENT_PARENT_URL_KEY);

    const nicholas = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload(legacyPayload())
    );
    assert.equal(nicholas.matched, true);
    if (!nicholas.matched) return;
    assert.equal(nicholas.match.originClientAccountId, NICHOLAS_CLIENT_ID);

    const otherLead = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload(
        legacyPayload({ parent_url: OTHER_CLIENT_PAGE_URL })
      )
    );
    assert.equal(otherLead.matched, true);
    if (!otherLead.matched) return;
    assert.equal(otherLead.match.originClientAccountId, OTHER_CLIENT_ID);
  });

  it("matches a standard my.leadcapture.io page by hosted slug", async () => {
    const hosted = await associateSourceFunnelByPageUrl({
      originClientAccountId: HOSTED_CLIENT_ID,
      pageUrlOrSlug: "lcsa_dn_hosted",
    });
    assert.equal(hosted.parentUrlKey, HOSTED_PARENT_URL_KEY);

    const exact = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload({
        provider: "leadcapture_io",
        parent_url: "https://my.leadcapture.io/p/lcsa_dn_hosted?v=1789074011990",
      })
    );
    assert.equal(exact.matched, true);
    if (!exact.matched) return;
    assert.equal(exact.match.matchedBy, "parent_url_key");

    // Same hosted slug reached through a different hosted path still resolves.
    const viaSlug = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload({
        provider: "leadcapture_io",
        parent_url: "https://my.leadcapture.io/lcsa_dn_hosted?v=2",
      })
    );
    assert.equal(viaSlug.matched, true);
    if (!viaSlug.matched) return;
    assert.equal(viaSlug.match.matchedBy, "hosted_page_slug");
    assert.equal(viaSlug.match.originClientAccountId, HOSTED_CLIENT_ID);

    // A custom domain carrying the same slug must never borrow the hosted match.
    const customDomain = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload({
        provider: "leadcapture_io",
        parent_url: "https://pages.someoneelse.example/p/lcsa_dn_hosted",
      })
    );
    assert.equal(customDomain.matched, false);
  });

  it("matches an exact Legacy lead_form id ahead of the page identity", async () => {
    const funnel = await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: NICHOLAS_LEAD_FORM,
        parentUrlKey: FORM_ID_PARENT_URL_KEY,
        pageSlug: "learn-form-id-only",
        associationStatus: "confirmed",
        originClientAccountId: FORM_ID_CLIENT_ID,
      },
    });

    const result = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload(
        legacyPayload({ parent_url: "https://go.unregistered.example/learn-nothing" })
      )
    );
    assert.equal(result.matched, true);
    if (!result.matched) return;
    assert.equal(result.match.sourceFunnelId, funnel.id);
    assert.equal(result.match.matchedBy, "provider_form_id");
    assert.equal(result.match.matchEvidence, NICHOLAS_LEAD_FORM);
    assert.equal(result.match.originClientAccountId, FORM_ID_CLIENT_ID);

    await db.sourceFunnel.delete({ where: { id: funnel.id } });
  });

  it("keeps a registered but unconfirmed source review-required", async () => {
    const funnel = await db.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        parentUrlKey: OTHER_PARENT_URL_KEY,
        pageSlug: "learn-nicholas-dambruoso",
        associationStatus: "suggested",
        suggestedClientAccountId: OTHER_CLIENT_ID,
      },
    });

    const result = await resolveConfirmedLeadCaptureSourceAssociation(
      leadCaptureSourceIdentitySignalsFromPayload(
        legacyPayload({ parent_url: `https://${OTHER_PARENT_URL_KEY}?utm_source=x` })
      )
    );
    assert.equal(result.matched, false);
    if (result.matched) return;
    assert.equal(result.reason, "source_not_confirmed");
    assert.deepEqual(result.candidateSourceFunnelIds, [funnel.id]);

    await db.sourceFunnel.delete({ where: { id: funnel.id } });
  });

  it("routes a real Legacy Nicholas webhook to nick_dambruoso and marks the source observed", async () => {
    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: legacyPayload(),
      routeKeyFromPath: NICHOLAS_ROUTE_KEY,
    });
    createdEventIds.push(result.sourceEventId);

    assert.equal(result.status, "routing_matched");
    assert.equal(result.matched, true);
    assert.equal(result.destinationClientAccountId, NICHOLAS_CLIENT_ID);
    assert.equal(result.matchedRuleId, undefined);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.ok(event);
    assert.equal(event.clientAccountIdResolved, NICHOLAS_CLIENT_ID);
    assert.equal(event.routingRuleIdResolved, null);

    const routing = event.routingResultJson as Record<string, unknown>;
    assert.equal(routing.routingAuthority, "confirmed_source_association");
    const evidence = routing.sourceAssociation as Record<string, unknown>;
    assert.equal(evidence.matchedBy, "parent_url_key");
    assert.equal(evidence.matchEvidence, NICHOLAS_PARENT_URL_KEY);
    assert.equal(evidence.parentUrlKey, NICHOLAS_PARENT_URL_KEY);
    assert.equal(evidence.routeKey, NICHOLAS_ROUTE_KEY);
    assert.equal(evidence.overriddenLooseRuleId, null);

    const decision = await db.routingDryRunDecision.findUnique({
      where: { id: event.routingDryRunDecisionId ?? "" },
    });
    assert.ok(decision);
    assert.equal(decision.matched, true);
    assert.equal(decision.destinationClientAccountId, NICHOLAS_CLIENT_ID);
    assert.equal(decision.matchedRuleId, null);
    assert.equal(decision.deliveryMode, "dry_run");
    assert.match(decision.matchReason, /confirmed LeadCapture source association/);

    const funnel = await db.sourceFunnel.findUnique({
      where: {
        provider_parentUrlKey: {
          provider: "leadcapture_io",
          parentUrlKey: NICHOLAS_PARENT_URL_KEY,
        },
      },
    });
    assert.ok(funnel);
    assert.equal(funnel.associationStatus, "confirmed");
    assert.equal(funnel.originClientAccountId, NICHOLAS_CLIENT_ID);
    assert.ok(funnel.firstSeenAt, "first lead must clear the waiting state");
    assert.ok(funnel.lastSeenAt);

    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.ok(item);
    assert.equal(item.originClientAccountId, NICHOLAS_CLIENT_ID);

    // No external delivery of any kind.
    assert.equal(event.deliveredAt, null);
    assert.equal(event.deliveryResultJson, null);
    assert.equal(
      await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: result.sourceEventId } }),
      0
    );
    assert.equal(
      await db.leadAllocation.count({ where: { sourceLeadEventId: result.sourceEventId } }),
      0
    );
    assert.equal(
      await db.metaDispatchAttempt.count({ where: { eventUuid: event.sourceLeadUid ?? "" } }),
      0
    );
  });

  it("keeps the same pathname on a different domain unmatched end to end", async () => {
    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: legacyPayload({
        lead_id: "lc_regression_wrong_domain_001",
        lead_form: "",
        email: "regression.wrong.domain@example.test",
        phone: "5550108345",
        parent_url: "https://go.otheragency.example/learn-nicholas-dambruoso?utm_source=x",
      }),
      routeKeyFromPath: NICHOLAS_ROUTE_KEY,
    });
    createdEventIds.push(result.sourceEventId);

    assert.equal(result.matched, false);
    assert.equal(result.status, "routing_unmatched");
    assert.equal(result.destinationClientAccountId, undefined);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.equal(event?.clientAccountIdResolved, null);
    const item = await db.leadInventoryItem.findUnique({
      where: { sourceLeadEventId: result.sourceEventId },
    });
    assert.equal(item?.originClientAccountId, null);
  });

  it("lets an exact route-key campaign rule keep precedence over the association", async () => {
    const rule = await db.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: ROUTE_RULE_CLIENT_ID,
        clientDisplayName: "LCSA Route Rule Client",
        campaignId: NICHOLAS_ROUTE_KEY,
        matchType: "campaign_id",
        destinationSubaccountIdGhl: "loc_lcsa_route_rule",
        active: true,
      },
    });
    createdRuleIds.push(rule.id);

    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: legacyPayload({
        lead_id: "lc_regression_route_key_rule_001",
        email: "regression.route.key.rule@example.test",
        phone: "5550108346",
      }),
      routeKeyFromPath: NICHOLAS_ROUTE_KEY,
    });
    createdEventIds.push(result.sourceEventId);

    assert.equal(result.matched, true);
    assert.equal(result.matchedRuleId, rule.id);
    assert.equal(result.destinationClientAccountId, ROUTE_RULE_CLIENT_ID);

    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    const routing = event?.routingResultJson as Record<string, unknown>;
    assert.equal(routing.routingAuthority, "campaign_routing_rule");
    assert.equal(routing.sourceAssociation, undefined);

    await db.campaignRoutingRule.delete({ where: { id: rule.id } });
  });

  it("lets the exact association outrank a loose keyword rule and records the override", async () => {
    const rule = await db.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: ROUTE_RULE_CLIENT_ID,
        clientDisplayName: "LCSA Route Rule Client",
        matchType: "keyword_fallback",
        keywordPattern: "nicholas d'ambruoso",
        destinationSubaccountIdGhl: "loc_lcsa_route_rule",
        active: true,
      },
    });
    createdRuleIds.push(rule.id);

    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: legacyPayload({
        lead_id: "lc_regression_loose_override_001",
        email: "regression.loose.override@example.test",
        phone: "5550108347",
      }),
      routeKeyFromPath: NICHOLAS_ROUTE_KEY,
    });
    createdEventIds.push(result.sourceEventId);

    assert.equal(result.destinationClientAccountId, NICHOLAS_CLIENT_ID);
    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    const routing = event?.routingResultJson as Record<string, unknown>;
    assert.equal(routing.routingAuthority, "confirmed_source_association");
    const evidence = routing.sourceAssociation as Record<string, unknown>;
    assert.equal(evidence.overriddenLooseRuleId, rule.id);

    await db.campaignRoutingRule.delete({ where: { id: rule.id } });
  });
});
