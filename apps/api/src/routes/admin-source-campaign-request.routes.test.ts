import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import { matchCampaignRoutingRule } from "../services/routing-matcher.service.js";
import { resolveConfirmedLeadCaptureSourceAssociation } from "../services/source-intake/leadcapture-source-association.service.js";
import { recordSourceCampaignAssociationRequest } from "../services/source-intake/source-campaign-association-request.js";
import { adminSourceCampaignRequestRoutes } from "./admin-source-campaign-request.js";

const ADMIN_KEY = "source-campaign-request-test-key";
const NOW = new Date("2026-11-10T12:00:00.000Z");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const clientIds: string[] = [];
const funnelRowIds: string[] = [];
const ruleIds: string[] = [];
let app: FastifyInstance;
let seq = 0;

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  requestFlag: process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED,
  setupFlag: process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED,
};

test("the request module does not call operational writers and routing does not read it", () => {
  const service = readFileSync(
    new URL("../services/source-intake/source-campaign-association-request.ts", import.meta.url),
    "utf8"
  );
  const route = readFileSync(new URL("./admin-source-campaign-request.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    path.join(repoRoot, "prisma/migrations/20261110043000_source_campaign_association_request/migration.sql"),
    "utf8"
  );
  const observer = readFileSync(
    path.join(repoRoot, "apps/admin-coc/src/lib/admin-coc-observer-access.ts"),
    "utf8"
  );
  for (const source of [service, route]) {
    for (const forbidden of [
      "confirmSourceFunnelOrigin",
      "reassignSourceFunnelOrigin",
      "clearSourceFunnelAssociation",
      "associateSourceFunnelByPageUrl",
      "createRoutingRuleAdmin",
      "createCampaignRoutingRule",
      "StaffPrincipal",
      "ghl-live-canary",
      "company-sheets-delivery",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  }
  assert.equal(observer.includes("source-campaign-requests"), false);
  assert.match(migration, /SET LOCAL lock_timeout = '3s'/);
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;$/m);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE/);
  assert.equal(migration.includes("GRANT SELECT, INSERT, UPDATE, DELETE"), false);
  assert.equal(migration.includes("GRANT ALL"), false);
  assert.equal(migration.includes('UPDATE "SourceFunnel"'), false);
  assert.equal(migration.includes('UPDATE "CampaignRoutingRule"'), false);
  assert.equal(migration.includes("ON DELETE RESTRICT"), true);
  for (const relative of [
    "services/routing-matcher.service.ts",
    "services/routing-dry-run.service.ts",
    "repositories/campaign-routing-rule.repository.ts",
    "services/source-intake/leadcapture-source-association.service.ts",
    "services/source-intake/source-funnel.service.ts",
    "services/ghl-association-dispatch/ghl-association-dispatch.ts",
    "services/company-sheets-dispatch/company-sheets-dispatch.service.ts",
  ]) {
    const source = readFileSync(path.join(apiSrc, relative), "utf8");
    assert.equal(source.includes("SourceCampaignAssociationRequest"), false, relative);
  }
});

describe("source campaign association requests", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "true";
    process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
    app = Fastify({ logger: false });
    await app.register(adminSourceCampaignRequestRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    await app.close();
    if (ruleIds.length > 0) {
      await prisma.campaignRoutingRule.deleteMany({ where: { id: { in: ruleIds } } }).catch(() => undefined);
    }
    if (funnelRowIds.length > 0) {
      await prisma.sourceFunnel.deleteMany({ where: { id: { in: funnelRowIds } } }).catch(() => undefined);
    }
    if (clientIds.length > 0) {
      await prisma.sourceCampaignAssociationRequest
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.sourceFunnel
        .deleteMany({
          where: {
            OR: [
              { originClientAccountId: { in: clientIds } },
              { suggestedClientAccountId: { in: clientIds } },
            ],
          },
        })
        .catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    restoreEnv("ADMIN_API_KEY", savedEnv.admin);
    restoreEnv("SA360_ADMIN_KEY", savedEnv.alias);
    restoreEnv("SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED", savedEnv.requestFlag);
    restoreEnv("SA360_NATIVE_CLIENT_SETUP_ENABLED", savedEnv.setupFlag);
  });

  test("admin auth, foreign credentials, and the exact-true flag refuse the route", async () => {
    const world = await createWorld("auth");
    const missing = await app.inject({ method: "POST", url: url(world.clientAccountId), payload: requestBody(world) });
    assert.equal(missing.statusCode, 401);

    const wrong = await post(world, { "x-sa360-admin-key": "wrong-key" });
    assert.equal(wrong.statusCode, 401);

    const portal = await post(world, { "x-sa360-client-portal-key": "portal-key" });
    assert.equal(portal.statusCode, 403);
    const workspace = await post(world, { "x-sa360-workspace-key": "workspace-key" });
    assert.equal(workspace.statusCode, 403);
    const assertion = await post(world, { "x-sa360-client-portal-assertion": "assertion" });
    assert.equal(assertion.statusCode, 403);

    const previousAdmin = process.env.ADMIN_API_KEY;
    delete process.env.ADMIN_API_KEY;
    delete process.env.SA360_ADMIN_KEY;
    const disabled = await post(world);
    assert.equal(disabled.statusCode, 503);
    process.env.ADMIN_API_KEY = previousAdmin;

    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "TRUE";
    const flagged = await post(world);
    assert.equal(flagged.statusCode, 404);
    assert.equal(flagged.json().error, "source_campaign_request_disabled");
    const direct = await recordSourceCampaignAssociationRequest(prisma, command(world), process.env);
    assert.equal(direct.ok, false);
    if (!direct.ok) assert.equal(direct.error, "feature_disabled");
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "true";

    const invalid = await post(world, undefined, { intent: "request" });
    assert.equal(invalid.statusCode, 400);
    assert.equal(await requestCount(world.clientAccountId), 0);
    const missingClient = await app.inject({
      method: "POST",
      url: url("missing-client"),
      headers: adminHeaders(),
      payload: requestBody(world),
    });
    assert.equal(missingClient.statusCode, 404);
  });

  test("a repeated request is idempotent and a conflicting id or revision is not stored twice", async () => {
    const world = await createWorld("idem");
    const before = await operational(world.clientAccountId);
    const firstBody = requestBody(world);
    const first = await post(world, undefined, firstBody);
    assert.equal(first.statusCode, 200);
    const created = first.json();
    assert.equal(created.replayed, false);
    assert.equal(created.status, "requested");
    assert.equal(created.revision, 1);
    assert.equal(created.requestedAssociation, true);
    assert.equal(created.associationApplied, false);
    assert.equal(created.routingRuleApplied, false);
    assert.equal(created.deliveryArmed, false);
    assert.equal(created.confirmedOperationalAssociation, false);
    assert.equal(created.observedSourceStatus, "not_registered");
    assert.equal(created.observedCampaignStatus, "no_matching_rule");

    const replay = await post(world, undefined, firstBody);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(replay.json().revision, 1);
    assert.equal(await requestCount(world.clientAccountId), 1);

    const conflict = await post(world, undefined, { ...firstBody, providerCampaignId: "other-campaign" });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, "request_id_conflict");
    assert.equal(await requestCount(world.clientAccountId), 1);

    const staleBody = requestBody(world, { expectedRevision: 0 });
    const stale = await post(world, undefined, staleBody);
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, "revision_conflict");
    assert.equal(await requestCount(world.clientAccountId), 1);

    const secondBody = { ...staleBody, expectedRevision: 1 };
    const second = await post(world, undefined, secondBody);
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().status, "requested");
    assert.equal(second.json().revision, 2);
    assert.equal(second.json().supersededRequestId, firstBody.requestId);
    assert.equal(await requestCount(world.clientAccountId), 2);

    const original = await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({
      where: { requestId: firstBody.requestId },
    });
    assert.equal(original.status, "superseded");
    assert.equal(original.supersededByRequestId, secondBody.requestId);
    const replayFirst = await post(world, undefined, firstBody);
    assert.equal(replayFirst.statusCode, 200);
    assert.equal(replayFirst.json().replayed, true);
    assert.equal(replayFirst.json().status, "requested");
    const stillSuperseded = await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({
      where: { requestId: firstBody.requestId },
    });
    assert.equal(stillSuperseded.status, "superseded");
    assert.deepEqual(await operational(world.clientAccountId), before);
    assert.equal(await prisma.sourceFunnel.count({ where: { providerFunnelId: world.funnelId } }), 0);
    assert.equal(await prisma.campaignRoutingRule.count({ where: { campaignId: world.campaignId } }), 0);

    const otherId = await createClient("crossid");
    const otherWorld = await saveWorld(otherId);
    const cross = await post(otherWorld, undefined, {
      ...firstBody,
      expectedRevision: 0,
      setupRevision: 1,
      providerFunnelId: otherWorld.funnelId,
      parentUrlKey: otherWorld.parentUrlKey,
      providerCampaignId: otherWorld.campaignId,
    });
    assert.equal(cross.statusCode, 409);
    assert.equal(cross.json().error, "request_id_conflict");
    assert.equal(await requestCount(otherId), 0);
  });

  test("stale, unreadable, and disabled setup data is not stored", async () => {
    const world = await createWorld("setup");
    const stale = await post(world, undefined, requestBody(world, { setupRevision: 0 }));
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, "setup_stale");

    const mismatch = await post(world, undefined, requestBody(world, { providerFunnelId: "not-the-saved-funnel" }));
    assert.equal(mismatch.statusCode, 409);
    assert.equal(mismatch.json().error, "setup_mismatch");

    await prisma.clientOnboardingSetup.update({
      where: { clientAccountId: world.clientAccountId },
      data: { setupDataJson: { providerFunnelId: 12 } },
    });
    const unreadable = await post(world, undefined, requestBody(world));
    assert.equal(unreadable.statusCode, 409);
    assert.equal(unreadable.json().error, "setup_unreadable");

    await prisma.clientOnboardingSetup.update({
      where: { clientAccountId: world.clientAccountId },
      data: { setupDataJson: setupData(world), revision: 2 },
    });
    const moved = await post(world, undefined, requestBody(world, { setupRevision: 1 }));
    assert.equal(moved.statusCode, 409);
    assert.equal(moved.json().error, "setup_stale");

    const bare = await createClient("bare");
    const bareWorld = await worldFor(bare);
    const unavailable = await post(bareWorld, undefined, requestBody(bareWorld));
    assert.equal(unavailable.statusCode, 409);
    assert.equal(unavailable.json().error, "setup_unavailable");

    const current = await createWorld("setupflag");
    delete process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED;
    const off = await post(current);
    assert.equal(off.statusCode, 409);
    assert.equal(off.json().error, "setup_unavailable");
    process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
    assert.equal(await requestCount(world.clientAccountId), 0);
    assert.equal(await requestCount(bare), 0);
    assert.equal(await requestCount(current.clientAccountId), 0);
  });

  test("cross-client ownership and ambiguous identities are rejected without operational writes", async () => {
    const owner = await createWorld("owner");
    const other = await createClient("other");
    const funnel = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: owner.funnelId,
        parentUrlKey: owner.parentUrlKey,
        pageSlug: "owned",
        associationStatus: "confirmed",
        originClientAccountId: other,
      },
    });
    funnelRowIds.push(funnel.id);
    const funnelBefore = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: funnel.id } });
    const ownedPayload = requestBody(owner);
    const owned = await post(owner, undefined, ownedPayload);
    assert.equal(owned.statusCode, 409);
    const ownedBody = owned.json();
    assert.equal(ownedBody.error, "source_owned_by_other_client");
    assert.equal(ownedBody.status, "rejected");
    assert.equal(ownedBody.associationApplied, false);
    assert.equal(ownedBody.routingRuleApplied, false);
    assert.equal(ownedBody.deliveryArmed, false);
    assert.equal(ownedBody.confirmedOperationalAssociation, false);
    const replay = await post(owner, undefined, ownedPayload);
    assert.equal(replay.statusCode, 409);
    assert.equal(replay.json().replayed, true);
    assert.equal(await requestCount(owner.clientAccountId), 1);
    const funnelAfter = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: funnel.id } });
    assert.equal(funnelAfter.associationStatus, "confirmed");
    assert.equal(funnelAfter.originClientAccountId, other);
    assert.equal(funnelAfter.updatedAt.getTime(), funnelBefore.updatedAt.getTime());

    const ambiguous = await createWorld("amb");
    const left = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: ambiguous.funnelId,
        parentUrlKey: `${ambiguous.parentUrlKey}-left`,
        associationStatus: "unassociated",
      },
    });
    const right = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: `${ambiguous.funnelId}-other`,
        parentUrlKey: ambiguous.parentUrlKey,
        associationStatus: "suggested",
        suggestedClientAccountId: other,
      },
    });
    funnelRowIds.push(left.id, right.id);
    const split = await post(ambiguous);
    assert.equal(split.statusCode, 409);
    assert.equal(split.json().error, "ambiguous_source");
    assert.equal(split.json().associationApplied, false);
    const leftAfter = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: left.id } });
    const rightAfter = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: right.id } });
    assert.equal(leftAfter.associationStatus, "unassociated");
    assert.equal(leftAfter.updatedAt.getTime(), left.updatedAt.getTime());
    assert.equal(rightAfter.associationStatus, "suggested");
    assert.equal(rightAfter.suggestedClientAccountId, other);
    assert.equal(rightAfter.updatedAt.getTime(), right.updatedAt.getTime());

    const mapped = await createWorld("camp");
    const rule = await prisma.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: other,
        matchType: "campaign_id",
        campaignId: mapped.campaignId,
        active: false,
        deliveryEnabled: false,
      },
    });
    ruleIds.push(rule.id);
    const blocked = await post(mapped);
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error, "campaign_owned_by_other_client");
    assert.equal(blocked.json().routingRuleApplied, false);
    const ruleAfter = await prisma.campaignRoutingRule.findUniqueOrThrow({ where: { id: rule.id } });
    assert.equal(ruleAfter.active, false);
    assert.equal(ruleAfter.deliveryEnabled, false);
    assert.equal(ruleAfter.clientAccountId, other);
    assert.equal(ruleAfter.updatedAt.getTime(), rule.updatedAt.getTime());
  });

  test("rejection and supersession stay on the request and do not change matching or delivery", async () => {
    const world = await createWorld("live");
    const funnel = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: world.funnelId,
        parentUrlKey: world.parentUrlKey,
        pageSlug: "live",
        associationStatus: "confirmed",
        originClientAccountId: world.clientAccountId,
      },
    });
    funnelRowIds.push(funnel.id);
    const rule = await prisma.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: world.clientAccountId,
        clientDisplayName: "Source request",
        matchType: "campaign_id",
        campaignId: world.campaignId,
        active: true,
        deliveryEnabled: false,
        shadowDeliveryEnabled: true,
      },
    });
    ruleIds.push(rule.id);
    const signals = {
      routeKey: null,
      providerFormIds: [world.funnelId],
      parentUrlKey: world.parentUrlKey,
      parentUrlHostname: "my.leadcapture.io",
      parentUrlPathname: `/p/${world.slug}`,
      hostedPageSlug: world.slug,
    };
    const associationBefore = await resolveConfirmedLeadCaptureSourceAssociation(signals, prisma);
    const loadedBefore = await prisma.campaignRoutingRule.findUniqueOrThrow({ where: { id: rule.id } });
    const matchBefore = matchCampaignRoutingRule(
      [loadedBefore],
      { masterClientAccountId: "leadcapture_io", campaignId: world.campaignId },
      NOW
    );
    const deliveryBefore = await operational(world.clientAccountId);

    const recorded = await post(world);
    assert.equal(recorded.statusCode, 200);
    const recordedBody = recorded.json();
    assert.equal(recordedBody.status, "requested");
    assert.equal(recordedBody.observedSourceStatus, "confirmed_for_client");
    assert.equal(recordedBody.confirmedOperationalAssociation, false);
    assert.equal(recordedBody.associationApplied, false);
    assert.equal(recordedBody.routingRuleApplied, false);
    assert.equal(recordedBody.deliveryArmed, false);

    const head = await app.inject({
      method: "GET",
      url: url(world.clientAccountId),
      headers: adminHeaders(),
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.json().openRequest.requestId, recordedBody.requestId);
    assert.equal(head.json().openRequest.requestedAssociation, true);
    assert.equal(head.json().confirmedOperationalAssociation, false);
    assert.equal(head.json().associationApplied, false);

    const rejected = await post(world, undefined, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      setupRevision: 1,
      intent: "reject",
    });
    assert.equal(rejected.statusCode, 200);
    const rejectedBody = rejected.json();
    assert.equal(rejectedBody.status, "rejected");
    assert.equal(rejectedBody.dispositionReason, "operator_rejected");
    assert.equal(rejectedBody.requestedAssociation, false);
    assert.equal(rejectedBody.associationApplied, false);
    assert.equal(rejectedBody.routingRuleApplied, false);
    assert.equal(rejectedBody.deliveryArmed, false);
    assert.equal(rejectedBody.confirmedOperationalAssociation, false);
    const rejectReplay = await post(world, undefined, {
      requestId: rejectedBody.requestId,
      expectedRevision: 1,
      setupRevision: 1,
      intent: "reject",
    });
    assert.equal(rejectReplay.statusCode, 200);
    assert.equal(rejectReplay.json().replayed, true);
    const row = await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({
      where: { requestId: recordedBody.requestId },
    });
    assert.equal(row.status, "rejected");
    assert.equal(row.revision, 2);

    await assert.rejects(() =>
      prisma.sourceCampaignAssociationRequest.update({
        where: { id: row.id },
        data: { providerCampaignId: "rewritten-campaign" },
      })
    );
    const unchangedRequest = await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(unchangedRequest.providerCampaignId, world.campaignId);

    const again = await post(world, undefined, requestBody(world, { expectedRevision: 2 }));
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().status, "requested");
    assert.equal(again.json().revision, 3);
    await assert.rejects(() =>
      prisma.sourceCampaignAssociationRequest.create({
        data: {
          requestId: crypto.randomUUID(),
          clientAccountId: world.clientAccountId,
          historicalClientAccountId: world.clientAccountId,
          expectedRevision: 3,
          revision: 4,
          setupRevision: 1,
          providerFunnelId: world.funnelId,
          parentUrlKey: world.parentUrlKey,
          providerCampaignId: world.campaignId,
          status: "requested",
          payloadHash: "a".repeat(64),
          recordResultJson: { version: 1 },
          actor: "ADMIN",
        },
      })
    );

    const associationAfter = await resolveConfirmedLeadCaptureSourceAssociation(signals, prisma);
    const loadedAfter = await prisma.campaignRoutingRule.findUniqueOrThrow({ where: { id: rule.id } });
    const matchAfter = matchCampaignRoutingRule(
      [loadedAfter],
      { masterClientAccountId: "leadcapture_io", campaignId: world.campaignId },
      NOW
    );
    const funnelAfter = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: funnel.id } });
    assert.deepEqual(associationAfter, associationBefore);
    assert.deepEqual(matchAfter, matchBefore);
    assert.equal(matchAfter.matched, true);
    assert.equal(matchAfter.destinationClientAccountId, world.clientAccountId);
    assert.equal(loadedAfter.active, true);
    assert.equal(loadedAfter.deliveryEnabled, false);
    assert.equal(loadedAfter.shadowDeliveryEnabled, true);
    assert.equal(loadedAfter.updatedAt.getTime(), loadedBefore.updatedAt.getTime());
    assert.equal(funnelAfter.associationStatus, "confirmed");
    assert.equal(funnelAfter.originClientAccountId, world.clientAccountId);
    assert.equal(funnelAfter.updatedAt.getTime(), funnel.updatedAt.getTime());
    assert.deepEqual(await operational(world.clientAccountId), deliveryBefore);
  });

  test("too many campaign rows are not partially stored", async () => {
    const world = await createWorld("many");
    for (let index = 0; index < 21; index += 1) {
      const rule = await prisma.campaignRoutingRule.create({
        data: {
          masterClientAccountId: "leadcapture_io",
          clientAccountId: world.clientAccountId,
          matchType: "campaign_id",
          campaignId: world.campaignId,
          active: false,
          deliveryEnabled: false,
        },
      });
      ruleIds.push(rule.id);
    }
    const result = await post(world);
    assert.equal(result.statusCode, 409);
    assert.equal(result.json().error, "ownership_unverified");
    assert.equal(result.json().associationApplied, false);
    assert.equal(result.json().routingRuleApplied, false);
    assert.equal(await requestCount(world.clientAccountId), 0);
    assert.equal(await prisma.campaignRoutingRule.count({ where: { campaignId: world.campaignId } }), 21);
  });
});

type World = {
  clientAccountId: string;
  funnelId: string;
  parentUrlKey: string;
  campaignId: string;
  slug: string;
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-sa360-admin-key": ADMIN_KEY, ...extra };
}

function url(clientAccountId: string): string {
  return `/admin/v1/clients/${clientAccountId}/source-campaign-requests`;
}

async function createClient(label: string): Promise<string> {
  seq += 1;
  const clientAccountId = `scr${label}${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Source request",
      status: "onboarding",
      portalLoginEmail: `${clientAccountId}@portal.example`,
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function createWorld(label: string): Promise<World> {
  const clientAccountId = await createClient(label);
  return saveWorld(clientAccountId);
}

async function worldFor(clientAccountId: string): Promise<World> {
  seq += 1;
  const slug = `scr${seq}`;
  return {
    clientAccountId,
    funnelId: `form-${slug}`,
    parentUrlKey: `my.leadcapture.io/p/${slug}`,
    campaignId: `camp-${slug}`,
    slug,
  };
}

async function saveWorld(clientAccountId: string): Promise<World> {
  const world = await worldFor(clientAccountId);
  await prisma.clientOnboardingSetup.create({
    data: {
      clientAccountId,
      status: "draft",
      revision: 1,
      setupDataJson: setupData(world),
    },
  });
  return world;
}

function setupData(world: World): Record<string, string> {
  return {
    providerFunnelId: world.funnelId,
    nextgenFunnelUrl: `https://${world.parentUrlKey}`,
    providerCampaignId: world.campaignId,
    trafficSourceName: "Veteran",
  };
}

type RequestPayload = {
  requestId: string;
  expectedRevision: number;
  setupRevision: number;
  intent: "request";
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  providerCampaignId: string | null;
};

function requestBody(world: World, overrides: Partial<RequestPayload> = {}): RequestPayload {
  return {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    setupRevision: 1,
    intent: "request",
    providerFunnelId: world.funnelId,
    parentUrlKey: world.parentUrlKey,
    providerCampaignId: world.campaignId,
    ...overrides,
  };
}

function command(world: World) {
  const body = requestBody(world);
  return {
    intent: "request" as const,
    clientAccountId: world.clientAccountId,
    requestId: String(body.requestId),
    expectedRevision: 0,
    setupRevision: 1,
    providerFunnelId: world.funnelId,
    parentUrlKey: world.parentUrlKey,
    providerCampaignId: world.campaignId,
  };
}

async function post(
  world: World,
  headers?: Record<string, string>,
  payload: object = requestBody(world)
) {
  return app.inject({
    method: "POST",
    url: url(world.clientAccountId),
    headers: adminHeaders(headers),
    payload,
  });
}

async function requestCount(clientAccountId: string): Promise<number> {
  return prisma.sourceCampaignAssociationRequest.count({ where: { clientAccountId } });
}

async function operational(clientAccountId: string) {
  const [rules, funnels, dryRuns, ghlRuns, sheetsJobs, intents, outbox] = await Promise.all([
    prisma.campaignRoutingRule.count({ where: { clientAccountId } }),
    prisma.sourceFunnel.count({
      where: { OR: [{ originClientAccountId: clientAccountId }, { suggestedClientAccountId: clientAccountId }] },
    }),
    prisma.routingDryRunDecision.count({ where: { destinationClientAccountId: clientAccountId } }),
    prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } }),
    prisma.companySheetsDeliveryJob.count({ where: { clientAccountId } }),
    prisma.companySheetsDispatchIntent.count({ where: { clientAccountId } }),
    prisma.ghlAssociationDispatchOutbox.count({ where: { clientAccountId } }),
  ]);
  return { rules, funnels, dryRuns, ghlRuns, sheetsJobs, intents, outbox };
}
