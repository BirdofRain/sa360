import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { CLIENT_PROFILE_NICHE_OPTIONS, CLIENT_PROFILE_PRODUCT_OPTIONS } from "@sa360/shared";
import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import { readClientCampaignInventory } from "../services/client-campaign-inventory/client-campaign-inventory.read.js";
import { createClientCampaign } from "../services/client-campaign-registry/client-campaign-registry.js";
import { recordSourceCampaignAssociationRequest } from "../services/source-intake/source-campaign-association-request.js";
import { adminClientCampaignInventoryRoutes } from "./admin-client-campaign-inventory.js";
import { adminClientCampaignRegistryRoutes } from "./admin-client-campaign-registry.js";

const ADMIN_KEY = "client-campaign-registry-test-key";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const clientIds: string[] = [];
const connectionIds: string[] = [];
let app: FastifyInstance;
let seq = 0;

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  registry: process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED,
  source: process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED,
  setup: process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED,
};

test("the registry does not call operational writers and the migration is additive", () => {
  const service = readFileSync(
    new URL("../services/client-campaign-registry/client-campaign-registry.ts", import.meta.url),
    "utf8"
  );
  const route = readFileSync(new URL("./admin-client-campaign-registry.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    path.join(repoRoot, "prisma/migrations/20261119180000_client_campaign_registry/migration.sql"),
    "utf8"
  );
  const observer = readFileSync(path.join(repoRoot, "apps/admin-coc/src/lib/admin-coc-observer-access.ts"), "utf8");
  for (const source of [service, route]) {
    for (const forbidden of [
      "confirmSourceFunnelOrigin",
      "reassignSourceFunnelOrigin",
      "createRoutingRuleAdmin",
      "createCampaignRoutingRule",
      "googleapis",
      "leadconnectorhq",
      "graph.facebook.com",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  }
  assert.equal(service.includes("fetch("), false);
  assert.equal(observer.includes("source-bindings"), false);
  assert.equal(observer.includes("destination-selection"), false);
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;$/m);
  assert.match(migration, /SET LOCAL lock_timeout = '3s'/);
  assert.match(migration, /ClientCampaignSourceIdentity_one_approved_key/);
  assert.match(migration, /"workflowLiveVerified" = false/);
  assert.match(migration, /"mapPublished" = false/);
  assert.equal(migration.includes("GRANT SELECT, INSERT, UPDATE, DELETE"), false);
  assert.equal(migration.includes("GRANT ALL"), false);
  assert.equal(migration.includes('UPDATE "SourceFunnel"'), false);
  assert.equal(migration.includes('UPDATE "CampaignRoutingRule"'), false);
  assert.equal(migration.includes('UPDATE "SourceLeadEvent"'), false);
  assert.equal(migration.includes('UPDATE "ClientGhlDestination"'), false);
  assert.equal(migration.includes('UPDATE "CompanySheetsDestination"'), false);
  assert.equal(migration.includes('UPDATE "CompanySheetsTabContract"'), false);
  for (const option of [...CLIENT_PROFILE_NICHE_OPTIONS, ...CLIENT_PROFILE_PRODUCT_OPTIONS]) {
    assert.equal(migration.includes(`'${option.value}'`), true, option.value);
  }
  for (const relative of [
    "services/routing-matcher.service.ts",
    "services/routing-dry-run.service.ts",
    "services/source-intake/leadcapture-source-association.service.ts",
    "services/company-sheets-dispatch/company-sheets-dispatch.service.ts",
  ]) {
    const source = readFileSync(path.join(apiSrc, relative), "utf8");
    assert.equal(source.includes("ClientCampaign"), false, relative);
  }
});

describe("request-only client campaign registry", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "true";
    app = Fastify({ logger: false });
    await app.register(adminClientCampaignRegistryRoutes, { prefix: "/admin/v1" });
    await app.register(adminClientCampaignInventoryRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    await app.close();
    if (clientIds.length > 0) {
      await prisma.clientCampaignSourceIdentity.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.clientCampaignRegistryCommand.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.clientCampaignSourceBinding.deleteMany({
        where: { clientCampaign: { clientAccountId: { in: clientIds } } },
      }).catch(() => undefined);
      await prisma.clientCampaignDestinationSelection.deleteMany({
        where: { clientCampaign: { clientAccountId: { in: clientIds } } },
      }).catch(() => undefined);
      await prisma.clientCampaign.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.sourceCampaignAssociationRequest.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.sourceLeadEvent.deleteMany({ where: { clientAccountIdResolved: { in: clientIds } } }).catch(() => undefined);
      await prisma.companySheetsTabContract.deleteMany({
        where: { destination: { clientAccountId: { in: clientIds } } },
      }).catch(() => undefined);
      await prisma.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.sourceFunnel.deleteMany({
        where: {
          OR: [{ originClientAccountId: { in: clientIds } }, { suggestedClientAccountId: { in: clientIds } }],
        },
      }).catch(() => undefined);
      await prisma.clientOnboardingSetup.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    if (connectionIds.length > 0) {
      await prisma.companyGoogleConnection.deleteMany({ where: { id: { in: connectionIds } } }).catch(() => undefined);
    }
    restore("ADMIN_API_KEY", savedEnv.admin);
    restore("SA360_ADMIN_KEY", savedEnv.alias);
    restore("SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED", savedEnv.registry);
    restore("SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED", savedEnv.source);
    restore("SA360_NATIVE_CLIENT_SETUP_ENABLED", savedEnv.setup);
  });

  test("admin auth, foreign credentials, and the exact-true flag refuse writes", async () => {
    const clientAccountId = await createClient("auth");
    const missing = await app.inject({ method: "POST", url: collection(clientAccountId), payload: createBody() });
    assert.equal(missing.statusCode, 401);
    const portal = await post(collection(clientAccountId), createBody(), { "x-sa360-client-portal-key": "portal" });
    assert.equal(portal.statusCode, 403);
    const workspace = await post(collection(clientAccountId), createBody(), { "x-sa360-workspace-key": "workspace" });
    assert.equal(workspace.statusCode, 403);

    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "TRUE";
    const flagged = await post(collection(clientAccountId), createBody());
    assert.equal(flagged.statusCode, 404);
    assert.equal(flagged.json().error, "client_campaign_registry_disabled");
    const direct = await createClientCampaign(
      prisma,
      {
        intent: "create",
        clientAccountId,
        requestId: randomUUID(),
        expectedRevision: 0,
        slug: "vet-direct",
        displayName: "Veteran FEX Campaign A",
        nicheKey: "VET",
        productType: "life_insurance",
      },
      process.env,
      "ADMIN"
    );
    assert.equal(direct.ok, false);
    if (!direct.ok) assert.equal(direct.error, "feature_disabled");
    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "true";

    const invalid = await post(collection(clientAccountId), { intent: "create" });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "invalid_body");
    const active = await post(collection(clientAccountId), createBody({ status: "active" }));
    assert.equal(active.statusCode, 400);
    assert.equal(await prisma.clientCampaign.count({ where: { clientAccountId } }), 0);
  });

  test("one client stores two VET campaigns and a NURSE campaign without merging names", async () => {
    const clientAccountId = await createClient("lanes");
    const before = await snapshot(clientAccountId);
    const firstPayload = createBody({ slug: "vet-a", displayName: "Veteran FEX Campaign A" });
    const first = await post(collection(clientAccountId), firstPayload);
    assert.equal(first.statusCode, 200);
    const firstBody = first.json();
    assert.equal(firstBody.replayed, false);
    assert.equal(firstBody.campaign.status, "draft");
    assert.equal(firstBody.campaign.nicheKey, "VET");
    assert.equal(firstBody.operationalReady, false);
    assert.equal(firstBody.routingRuleApplied, false);
    assert.equal(firstBody.sourceConfirmed, false);
    assert.equal(firstBody.deliveryArmed, false);
    assert.equal(firstBody.externalCall, false);
    assert.equal(firstBody.inventoryKeyUsed, false);
    assert.match(firstBody.campaign.id, /^c[a-z0-9]{24}$/);

    const sameName = await post(
      collection(clientAccountId),
      createBody({ slug: "vet-b", displayName: "Veteran FEX Campaign A", nicheKey: "VET", productType: "life_insurance" })
    );
    assert.equal(sameName.statusCode, 200);
    assert.notEqual(sameName.json().campaign.id, firstBody.campaign.id);

    const nurse = await post(
      collection(clientAccountId),
      createBody({ slug: "nurse-c", displayName: "Nurse Life Campaign C", nicheKey: "NURSE", productType: "life_insurance" })
    );
    assert.equal(nurse.statusCode, 200);
    assert.equal(nurse.json().campaign.nicheKey, "NURSE");

    const listed = await app.inject({ method: "GET", url: collection(clientAccountId), headers: adminHeaders() });
    assert.equal(listed.statusCode, 200);
    assert.deepEqual(
      listed.json().campaigns.map((campaign: { slug: string }) => campaign.slug),
      ["vet-a", "vet-b", "nurse-c"]
    );
    assert.equal(new Set(listed.json().campaigns.map((campaign: { id: string }) => campaign.id)).size, 3);
    assert.deepEqual(await snapshot(clientAccountId), before);

    const replay = await post(collection(clientAccountId), firstPayload);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(replay.json().campaign.id, firstBody.campaign.id);
    assert.equal(await prisma.clientCampaign.count({ where: { clientAccountId } }), 3);
    const command = await prisma.clientCampaignRegistryCommand.findUniqueOrThrow({ where: { requestId: firstPayload.requestId } });
    await assert.rejects(() =>
      prisma.clientCampaignRegistryCommand.update({ where: { id: command.id }, data: { actor: "ADMIN" } })
    );

    const changed = await post(
      collection(clientAccountId),
      createBody({ slug: "vet-a", displayName: "A different name", requestId: first.json().requestId })
    );
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error, "request_id_conflict");
    assert.equal(await prisma.clientCampaign.count({ where: { clientAccountId } }), 3);
  });

  test("updates use the expected revision and a stale revision does not write", async () => {
    const clientAccountId = await createClient("rev");
    const created = await post(collection(clientAccountId), createBody({ slug: "vet-rev", displayName: "Veteran FEX Campaign A" }));
    const campaignId = created.json().campaign.id as string;
    const stale = await post(resource(clientAccountId, campaignId), updateBody(0, { displayName: "Should not stick" }));
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, "revision_conflict");
    const still = await prisma.clientCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    assert.equal(still.displayName, "Veteran FEX Campaign A");
    assert.equal(still.revision, 1);
    assert.equal(await prisma.clientCampaignRegistryCommand.count({ where: { clientAccountId } }), 1);

    const ready = await post(resource(clientAccountId, campaignId), updateBody(1, { displayName: "Veteran FEX Campaign A", status: "ready" }));
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.json().revision, 2);
    assert.equal(ready.json().campaign.status, "ready");
    assert.equal(ready.json().operationalReady, false);
    assert.equal(ready.json().campaign.configurationStatusEffect, "none");

    const bindings = await post(bindingsUrl(clientAccountId, campaignId), bindingsBody(1, [binding({ formId: "form-stale" })]));
    assert.equal(bindings.statusCode, 409);
    assert.equal(bindings.json().error, "revision_conflict");
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: campaignId } }), 0);
    assert.equal((await prisma.clientCampaign.findUniqueOrThrow({ where: { id: campaignId } })).revision, 2);
  });

  test("several exact sources can be requested while a suggestion stays unconfirmed", async () => {
    const clientAccountId = await createClient("sources");
    const created = await post(collection(clientAccountId), createBody({ slug: "vet-sources" }));
    const campaignId = created.json().campaign.id as string;
    const suggested = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: `suggested-${clientAccountId}`,
        parentUrlKey: `my.leadcapture.io/p/${clientAccountId}-suggested`,
        associationStatus: "suggested",
        suggestedClientAccountId: clientAccountId,
        observedFunnelName: "Veteran page",
      },
    });
    const confirmed = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: `confirmed-${clientAccountId}`,
        parentUrlKey: `my.leadcapture.io/p/${clientAccountId}-confirmed`,
        associationStatus: "confirmed",
        originClientAccountId: clientAccountId,
      },
    });
    const rule = await prisma.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "master_registry",
        clientAccountId,
        matchType: "form_id_utm_campaign",
        formId: "form-owned",
        active: true,
        deliveryEnabled: false,
      },
    });
    const event = await prisma.sourceLeadEvent.create({
      data: {
        sourceProvider: "leadcapture_io",
        sourceSystem: "leadcapture_io_nextgen",
        sourceType: "webhook",
        sourceCampaignId: "registry-event",
        clientAccountIdResolved: clientAccountId,
        rawPayloadJson: { registry: "unchanged" },
        routingResultJson: { frozen: true },
      },
    });
    const before = await snapshot(clientAccountId);
    const savedPayload = bindingsBody(1, [
      binding({
        bindingKey: "meta-form",
        provider: "facebook",
        formId: "form-100",
        campaignId: "camp-100",
      }),
      binding({
        bindingKey: "meta-ad",
        provider: "facebook",
        adId: "ad-100",
      }),
      binding({
        bindingKey: "page-suggestion",
        requestedStatus: "suggested",
        provider: null,
        sourceFunnelId: suggested.id,
        evidence: { note: "operator suggestion", observedLabel: "Veteran FEX Campaign A" },
      }),
      binding({
        bindingKey: "owned-form",
        requestedStatus: "approved",
        provider: "facebook",
        formId: "form-owned",
        campaignRoutingRuleId: rule.id,
      }),
    ]);
    const saved = await post(bindingsUrl(clientAccountId, campaignId), savedPayload);
    assert.equal(saved.statusCode, 200, saved.body);
    const body = saved.json();
    assert.equal(body.revision, 2);
    assert.equal(body.originConfirmed, false);
    assert.equal(body.bindings.length, 4);
    type SavedBinding = {
      bindingKey: string;
      status: string;
      identities: unknown[];
      recordedEvidence: { usedAsJoinKey: boolean };
      originConfirmed: boolean;
    };
    const byKey = new Map<string, SavedBinding>(
      body.bindings.map((item: SavedBinding) => [item.bindingKey, item])
    );
    assert.equal(byKey.get("meta-form")?.status, "recorded");
    assert.equal((byKey.get("meta-form")?.identities as unknown[]).length, 2);
    assert.equal(byKey.get("page-suggestion")?.status, "suggested");
    assert.deepEqual(byKey.get("page-suggestion")?.identities, []);
    assert.equal(byKey.get("page-suggestion")?.recordedEvidence.usedAsJoinKey, false);
    assert.equal(byKey.get("owned-form")?.status, "approved");
    assert.equal(byKey.get("owned-form")?.originConfirmed, false);

    const replay = await post(bindingsUrl(clientAccountId, campaignId), savedPayload);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: campaignId } }), 4);

    const changed = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(1, [binding({ formId: "form-changed" })], savedPayload.requestId)
    );
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error, "request_id_conflict");
    assert.equal(await prisma.clientCampaignSourceIdentity.count({ where: { clientCampaignId: campaignId, active: true } }), 4);

    const funnel = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: suggested.id } });
    assert.equal(funnel.associationStatus, "suggested");
    assert.equal(funnel.originClientAccountId, null);
    const confirmedAfter = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: confirmed.id } });
    assert.equal(confirmedAfter.associationStatus, "confirmed");
    assert.equal(confirmedAfter.updatedAt.getTime(), confirmed.updatedAt.getTime());
    const ruleAfter = await prisma.campaignRoutingRule.findUniqueOrThrow({ where: { id: rule.id } });
    assert.equal(ruleAfter.updatedAt.getTime(), rule.updatedAt.getTime());
    assert.equal(ruleAfter.active, true);
    assert.equal(ruleAfter.deliveryEnabled, false);
    const eventAfter = await prisma.sourceLeadEvent.findUniqueOrThrow({ where: { id: event.id } });
    assert.equal(eventAfter.updatedAt.getTime(), event.updatedAt.getTime());
    assert.deepEqual(eventAfter.routingResultJson, { frozen: true });
    assert.deepEqual(await snapshot(clientAccountId), before);
  });

  test("duplicate, cross-client, loose, and unknown identities do not write a second binding", async () => {
    const clientAccountId = await createClient("dup");
    const otherClientId = await createClient("other");
    const first = await post(collection(clientAccountId), createBody({ slug: "vet-one" }));
    const second = await post(collection(clientAccountId), createBody({ slug: "vet-two", displayName: "Veteran FEX Campaign B" }));
    const firstId = first.json().campaign.id as string;
    const secondId = second.json().campaign.id as string;
    const saved = await post(bindingsUrl(clientAccountId, firstId), bindingsBody(1, [binding({ formId: "form-shared", provider: "facebook" })]));
    assert.equal(saved.statusCode, 200);

    const overlap = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ bindingKey: "again", formId: "form-shared", provider: "facebook" })])
    );
    assert.equal(overlap.statusCode, 409);
    assert.equal(overlap.json().error, "review_required");
    assert.equal(overlap.json().outcome, "REVIEW_REQUIRED");
    assert.equal(overlap.json().conflicts[0].scope, "same_client");
    assert.equal(overlap.json().conflicts[0].campaignId, firstId);
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: secondId } }), 0);
    assert.equal((await prisma.clientCampaign.findUniqueOrThrow({ where: { id: secondId } })).revision, 1);
    const overlapReplay = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ bindingKey: "again", formId: "form-shared", provider: "facebook" })], overlap.json().requestId)
    );
    assert.equal(overlapReplay.statusCode, 409);
    assert.equal(overlapReplay.json().replayed, true);
    assert.equal(await prisma.clientCampaignRegistryCommand.count({ where: { requestId: overlap.json().requestId } }), 1);

    const foreignRule = await prisma.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "master_registry",
        clientAccountId: otherClientId,
        matchType: "campaign_id",
        campaignId: "foreign-camp",
        active: true,
        deliveryEnabled: true,
      },
    });
    const foreignFunnel = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: `foreign-${otherClientId}`,
        parentUrlKey: `my.leadcapture.io/p/${otherClientId}-owned`,
        associationStatus: "confirmed",
        originClientAccountId: otherClientId,
      },
    });
    const cross = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ bindingKey: "cross", provider: "facebook", campaignId: "foreign-camp" })])
    );
    assert.equal(cross.statusCode, 409);
    assert.equal(cross.json().outcome, "REVIEW_REQUIRED");
    assert.equal(cross.json().conflicts.some((conflict: { code: string; scope: string }) => conflict.code === "routing_authority_overlap" && conflict.scope === "other_client"), true);
    assert.equal(JSON.stringify(cross.json()).includes(otherClientId), false);
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: secondId } }), 0);
    const foreignRuleAfter = await prisma.campaignRoutingRule.findUniqueOrThrow({ where: { id: foreignRule.id } });
    assert.equal(foreignRuleAfter.updatedAt.getTime(), foreignRule.updatedAt.getTime());
    assert.equal(foreignRuleAfter.deliveryEnabled, true);

    const ownedString = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [
        binding({
          bindingKey: "owned-string",
          provider: "leadcapture_io",
          providerFunnelId: foreignFunnel.providerFunnelId,
        }),
      ])
    );
    assert.equal(ownedString.statusCode, 409);
    assert.equal(ownedString.json().conflicts.some((conflict: { code: string }) => conflict.code === "source_ownership_overlap"), true);
    assert.equal(JSON.stringify(ownedString.json()).includes(otherClientId), false);

    const foreignId = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [
        binding({
          bindingKey: "foreign-id",
          provider: "leadcapture_io",
          providerFunnelId: foreignFunnel.providerFunnelId,
          sourceFunnelId: foreignFunnel.id,
        }),
      ])
    );
    assert.equal(foreignId.statusCode, 409);
    assert.equal(foreignId.json().error, "foreign_source");
    assert.equal(await commandCount(foreignId.json().requestId), 0);

    const passedRule = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [
        binding({
          bindingKey: "foreign-rule",
          provider: "facebook",
          campaignId: "foreign-camp",
          campaignRoutingRuleId: foreignRule.id,
        }),
      ])
    );
    assert.equal(passedRule.statusCode, 409);
    assert.equal(passedRule.json().error, "foreign_routing_rule");
    assert.equal(await commandCount(passedRule.json().requestId), 0);

    const keyword = await prisma.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "master_registry",
        clientAccountId,
        matchType: "keyword_fallback",
        keywordPattern: "veteran",
        active: true,
        deliveryEnabled: false,
      },
    });
    const loose = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [
        binding({
          bindingKey: "loose",
          requestedStatus: "suggested",
          provider: null,
          campaignRoutingRuleId: keyword.id,
        }),
      ])
    );
    assert.equal(loose.statusCode, 409);
    assert.equal(loose.json().error, "utm_or_keyword_not_authority");
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: secondId } }), 0);
    assert.equal((await prisma.campaignRoutingRule.findUniqueOrThrow({ where: { id: keyword.id } })).updatedAt.getTime(), keyword.updatedAt.getTime());

    const unknown = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ sourceFunnelId: "missing-funnel", provider: "facebook", formId: "form-x" })])
    );
    assert.equal(unknown.statusCode, 404);
    assert.equal(unknown.json().error, "unknown_source");
    const unknownRule = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ campaignRoutingRuleId: "missing-rule", provider: "facebook", formId: "form-x" })])
    );
    assert.equal(unknownRule.statusCode, 404);
    assert.equal(unknownRule.json().error, "unknown_routing_rule");

    const duplicate = await post(
      bindingsUrl(clientAccountId, firstId),
      bindingsBody(2, [
        binding({ bindingKey: "one", formId: "form-copy", provider: "facebook" }),
        binding({ bindingKey: "two", formId: "form-copy", provider: "facebook" }),
      ])
    );
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error, "duplicate_identifier");
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: firstId, bindingKey: "one" } }), 0);
    assert.equal((await prisma.clientCampaign.findUniqueOrThrow({ where: { id: firstId } })).revision, 2);
  });

  test("an unconfirmed source cannot be approved and a destination request stays inside the client", async () => {
    const clientAccountId = await createClient("dest");
    const created = await post(collection(clientAccountId), createBody({ slug: "nurse-dest", nicheKey: "NURSE", displayName: "Nurse Life Campaign C" }));
    const campaignId = created.json().campaign.id as string;
    const suggested = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: `open-${clientAccountId}`,
        parentUrlKey: `my.leadcapture.io/p/${clientAccountId}-open`,
        associationStatus: "suggested",
        suggestedClientAccountId: clientAccountId,
      },
    });
    const notApproved = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(1, [
        binding({
          bindingKey: "open-page",
          requestedStatus: "approved",
          provider: "leadcapture_io",
          providerFunnelId: suggested.providerFunnelId,
          parentUrlKey: `https://${suggested.parentUrlKey}?utm_campaign=nurse`,
          sourceFunnelId: suggested.id,
        }),
      ])
    );
    assert.equal(notApproved.statusCode, 409);
    assert.equal(notApproved.json().outcome, "REVIEW_REQUIRED");
    assert.equal(notApproved.json().conflicts[0].code, "source_not_confirmed");
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: campaignId } }), 0);
    assert.equal((await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: suggested.id } })).associationStatus, "suggested");

    const recorded = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(1, [
        binding({
          bindingKey: "open-page",
          requestedStatus: "recorded",
          provider: "leadcapture_io",
          providerFunnelId: suggested.providerFunnelId,
          sourceFunnelId: suggested.id,
        }),
      ])
    );
    assert.equal(recorded.statusCode, 200);
    assert.equal(recorded.json().bindings[0].status, "recorded");
    assert.equal(recorded.json().bindings[0].originConfirmed, false);
    assert.equal(recorded.json().bindings[0].identities[0].normalizedValue, suggested.providerFunnelId);

    const incomplete = await post(destinationUrl(clientAccountId, campaignId), destinationBody(2, { workflowIdGhl: "wf-nurse" }));
    assert.equal(incomplete.statusCode, 200);
    assert.equal(incomplete.json().destination.workflowLiveVerified, false);
    assert.equal(incomplete.json().destination.mapPublished, false);
    assert.equal(incomplete.json().destination.operationalReady, false);
    assert.equal(incomplete.json().destination.changedClientDefaultWorkflow, false);
    assert.equal(incomplete.json().destination.tabContractChanged, false);
    assert.equal(incomplete.json().destination.readinessWarnings.includes("ghl_destination_missing"), true);
    assert.equal(incomplete.json().destination.readinessWarnings.includes("sheets_destination_missing"), true);
    assert.equal(incomplete.json().destination.readinessWarnings.includes("workflow_not_live_verified"), true);
    assert.equal(await prisma.clientGhlDestination.count({ where: { clientAccountId } }), 0);

    const connection = await prisma.companyGoogleConnection.create({
      data: {
        connectionKey: `registry-${clientAccountId}`,
        googleEmail: `${clientAccountId}@sheets.example`,
        status: "connected",
        scopes: ["openid"],
        tokenVersion: 1,
      },
    });
    connectionIds.push(connection.id);
    const sheets = await prisma.companySheetsDestination.create({
      data: {
        clientAccountId,
        companyConnectionId: connection.id,
        spreadsheetId: `sheet-${clientAccountId}`,
        spreadsheetTitle: "Client sheet",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/sheet-${clientAccountId}`,
        worksheetId: 0,
        worksheetTitle: "Campaign",
        controlBasis: "drive_owner_verified",
        sharingStatus: "missing_recipient",
        enabled: false,
        deliveryExecution: "disabled",
        campaignDispatchEnabled: false,
      },
    });
    const tab = await prisma.companySheetsTabContract.create({
      data: { destinationId: sheets.id, role: "campaign", setupState: "bound", worksheetId: 0, worksheetTitle: "Campaign" },
    });
    const ghl = await prisma.clientGhlDestination.create({
      data: {
        clientAccountId,
        destinationSubaccountIdGhl: `loc-${clientAccountId}`,
        destinationWorkflowIdGhl: "wf-default",
        workflowTriggerMode: "tag_trigger",
        deliveryEnabled: false,
        deliveryMode: "shadow",
      },
    });
    const mismatch = await post(
      destinationUrl(clientAccountId, campaignId),
      destinationBody(3, { spreadsheetId: "someone-elses-sheet", worksheetId: 4 })
    );
    assert.equal(mismatch.statusCode, 409);
    assert.equal(mismatch.json().error, "spreadsheet_mismatch");
    assert.equal((await prisma.clientCampaignDestinationSelection.findUniqueOrThrow({ where: { clientCampaignId: campaignId } })).revision, 1);

    const selected = await post(
      destinationUrl(clientAccountId, campaignId),
      destinationBody(3, {
        workflowIdGhl: "wf-nurse-lane",
        workflowTriggerMode: "tag_trigger",
        ghlLocationId: ghl.destinationSubaccountIdGhl,
        spreadsheetId: sheets.spreadsheetId,
        worksheetId: 9,
        worksheetTitle: "Nurse",
      })
    );
    assert.equal(selected.statusCode, 200);
    assert.equal(selected.json().destination.ghlLocationId, ghl.destinationSubaccountIdGhl);
    assert.equal(selected.json().destination.workflowIdGhl, "wf-nurse-lane");
    assert.equal(selected.json().destination.spreadsheetId, sheets.spreadsheetId);
    assert.equal(selected.json().destination.worksheetId, 9);
    assert.equal(selected.json().destination.workflowLiveVerified, false);
    assert.equal(selected.json().destination.mapPublished, false);
    assert.equal(selected.json().destination.readinessWarnings.includes("worksheet_not_verified"), true);
    assert.equal(selected.json().destination.readinessWarnings.includes("not_a_published_map"), true);
    const ghlAfter = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { id: ghl.id } });
    assert.equal(ghlAfter.destinationWorkflowIdGhl, "wf-default");
    assert.equal(ghlAfter.workflowTriggerMode, "tag_trigger");
    assert.equal(ghlAfter.deliveryEnabled, false);
    assert.equal(ghlAfter.updatedAt.getTime(), ghl.updatedAt.getTime());
    const sheetsAfter = await prisma.companySheetsDestination.findUniqueOrThrow({ where: { id: sheets.id } });
    assert.equal(sheetsAfter.updatedAt.getTime(), sheets.updatedAt.getTime());
    assert.equal(sheetsAfter.destinationRevision, sheets.destinationRevision);
    assert.equal(sheetsAfter.enabled, false);
    assert.equal(sheetsAfter.deliveryExecution, "disabled");
    assert.equal(sheetsAfter.campaignDispatchEnabled, false);
    const tabAfter = await prisma.companySheetsTabContract.findUniqueOrThrow({ where: { id: tab.id } });
    assert.equal(tabAfter.worksheetId, 0);
    assert.equal(tabAfter.updatedAt.getTime(), tab.updatedAt.getTime());
    assert.equal(await prisma.clientSheetColumnMap.count({ where: { clientAccountId } }), 0);
    assert.equal(await prisma.companySheetsDeliveryJob.count({ where: { clientAccountId } }), 0);
    assert.equal(await prisma.companySheetsDispatchIntent.count({ where: { clientAccountId } }), 0);
  });

  test("the flag off leaves inventory, setup, and association requests on their own paths", async () => {
    const clientAccountId = await createClient("legacy");
    const funnel = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: `inventory-${clientAccountId}`,
        parentUrlKey: `my.leadcapture.io/p/${clientAccountId}-inventory`,
        associationStatus: "confirmed",
        originClientAccountId: clientAccountId,
        nicheKey: "VET",
      },
    });
    await prisma.clientOnboardingSetup.create({
      data: {
        clientAccountId,
        status: "draft",
        revision: 1,
        setupDataJson: {
          providerFunnelId: funnel.providerFunnelId,
          nextgenFunnelUrl: `https://${funnel.parentUrlKey}`,
          providerCampaignId: "legacy-camp",
        },
      },
    });
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "true";
    process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
    const association = await recordSourceCampaignAssociationRequest(
      prisma,
      {
        intent: "request",
        clientAccountId,
        requestId: randomUUID(),
        expectedRevision: 0,
        setupRevision: 1,
        providerFunnelId: funnel.providerFunnelId,
        parentUrlKey: funnel.parentUrlKey,
        providerCampaignId: "legacy-camp",
      },
      process.env,
      "ADMIN"
    );
    assert.equal(association.ok, true);
    const associationBefore = await prisma.sourceCampaignAssociationRequest.findFirstOrThrow({ where: { clientAccountId } });
    const setupBefore = await prisma.clientOnboardingSetup.findUniqueOrThrow({ where: { clientAccountId } });

    const created = await post(collection(clientAccountId), createBody({ slug: "legacy-vet" }));
    assert.equal(created.statusCode, 200);
    const inventory = await readClientCampaignInventory(clientAccountId, prisma);
    assert.equal(inventory.ok, true);
    if (inventory.ok) {
      assert.equal(inventory.inventory.readOnly, true);
      assert.equal(inventory.inventory.writesPerformed, false);
      assert.equal(inventory.inventory.summary.confirmedSourceCount, 1);
      for (const candidate of inventory.inventory.candidates) {
        assert.notEqual(candidate.inventoryKey, created.json().campaign.id);
        assert.equal(candidate.inventoryKey.includes(created.json().campaign.id), false);
      }
    }
    const associationAfter = await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({ where: { id: associationBefore.id } });
    assert.equal(associationAfter.status, associationBefore.status);
    assert.equal(associationAfter.revision, associationBefore.revision);
    assert.equal(associationAfter.providerCampaignId, "legacy-camp");
    const setupAfter = await prisma.clientOnboardingSetup.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(setupAfter.revision, setupBefore.revision);
    assert.equal(setupAfter.updatedAt.getTime(), setupBefore.updatedAt.getTime());

    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "false";
    const blocked = await post(collection(clientAccountId), createBody({ slug: "blocked" }));
    assert.equal(blocked.statusCode, 404);
    const inventoryWhileOff = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${clientAccountId}/campaign-inventory`,
      headers: adminHeaders(),
    });
    assert.equal(inventoryWhileOff.statusCode, 200);
    assert.equal(inventoryWhileOff.json().readOnly, true);
    assert.equal(inventoryWhileOff.json().writesPerformed, false);
    const directInventory = await readClientCampaignInventory(clientAccountId, prisma);
    assert.equal(directInventory.ok, true);
    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "true";
    assert.equal(await prisma.clientCampaign.count({ where: { clientAccountId, slug: "blocked" } }), 0);
    assert.equal(await prisma.campaignRoutingRule.count({ where: { clientAccountId } }), 0);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-sa360-admin-key": ADMIN_KEY, ...extra };
}

function collection(clientAccountId: string): string {
  return `/admin/v1/clients/${clientAccountId}/campaigns`;
}

function resource(clientAccountId: string, campaignId: string): string {
  return `${collection(clientAccountId)}/${campaignId}`;
}

function bindingsUrl(clientAccountId: string, campaignId: string): string {
  return `${resource(clientAccountId, campaignId)}/source-bindings`;
}

function destinationUrl(clientAccountId: string, campaignId: string): string {
  return `${resource(clientAccountId, campaignId)}/destination-selection`;
}

async function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url, headers: adminHeaders(headers), payload: payload as object });
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    expectedRevision: 0,
    intent: "create",
    slug: "vet-a",
    displayName: "Veteran FEX Campaign A",
    nicheKey: "VET",
    productType: "life_insurance",
    ...overrides,
  };
}

function updateBody(expectedRevision: number, overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    expectedRevision,
    intent: "update",
    displayName: "Veteran FEX Campaign A",
    nicheKey: "VET",
    productType: "life_insurance",
    status: "draft",
    ...overrides,
  };
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    bindingKey: "source-a",
    requestedStatus: "recorded",
    sourceFunnelId: null,
    campaignRoutingRuleId: null,
    provider: "facebook",
    providerFunnelId: null,
    parentUrlKey: null,
    campaignId: null,
    formId: null,
    adsetId: null,
    adId: null,
    evidence: null,
    ...overrides,
  };
}

function bindingsBody(expectedRevision: number, bindings: unknown[], requestId = randomUUID()) {
  return { requestId, expectedRevision, intent: "save_bindings", bindings };
}

function destinationBody(expectedRevision: number, overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    expectedRevision,
    intent: "save_destination",
    workflowIdGhl: null,
    workflowTriggerMode: null,
    ghlLocationId: null,
    spreadsheetId: null,
    worksheetId: null,
    worksheetTitle: null,
    ...overrides,
  };
}

async function createClient(label: string): Promise<string> {
  seq += 1;
  const clientAccountId = `ccr${label}${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: label, status: "onboarding" },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function commandCount(requestId: string | undefined): Promise<number> {
  if (!requestId) return 0;
  return prisma.clientCampaignRegistryCommand.count({ where: { requestId } });
}

async function snapshot(clientAccountId: string) {
  const [rules, funnels, events, setups, requests, jobs, intents, maps] = await Promise.all([
    prisma.campaignRoutingRule.count({ where: { clientAccountId } }),
    prisma.sourceFunnel.count({ where: { originClientAccountId: clientAccountId, associationStatus: "confirmed" } }),
    prisma.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientAccountId } }),
    prisma.clientOnboardingSetup.count({ where: { clientAccountId } }),
    prisma.sourceCampaignAssociationRequest.count({ where: { clientAccountId } }),
    prisma.companySheetsDeliveryJob.count({ where: { clientAccountId } }),
    prisma.companySheetsDispatchIntent.count({ where: { clientAccountId } }),
    prisma.clientSheetColumnMap.count({ where: { clientAccountId } }),
  ]);
  const ghl = await prisma.clientGhlDestination.findUnique({
    where: { clientAccountId },
    select: { deliveryEnabled: true, destinationWorkflowIdGhl: true, workflowTriggerMode: true },
  });
  const sheets = await prisma.companySheetsDestination.findUnique({
    where: { clientAccountId },
    select: { enabled: true, deliveryExecution: true, campaignDispatchEnabled: true },
  });
  return { rules, funnels, events, setups, requests, jobs, intents, maps, ghl, sheets };
}
