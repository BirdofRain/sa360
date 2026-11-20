import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../../lib/db.js";
import {
  createClientCampaign,
  saveClientCampaignBindings,
  saveClientCampaignDestination,
  updateClientCampaign,
} from "../client-campaign-registry/client-campaign-registry.js";
import { observeClientCampaignShadow } from "./observe-client-campaign-shadow.js";
import { adminClientCampaignShadowRoutes } from "../../routes/admin-client-campaign-shadow.js";

const ADMIN_KEY = "client-campaign-shadow-test-key";
const clientIds: string[] = [];
const eventIds: string[] = [];
let app: FastifyInstance;
let seq = 0;

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  registry: process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED,
  shadow: process.env.SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED,
};

describe("client campaign shadow resolution", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "true";
    process.env.SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED = "true";
    app = Fastify({ logger: false });
    await app.register(adminClientCampaignShadowRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    await app.close();
    if (eventIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "ClientCampaignShadowDecision" DISABLE TRIGGER "ClientCampaignShadowDecision_immutable_guard"`
      );
      await prisma.clientCampaignShadowDecision.deleteMany({ where: { sourceLeadEventId: { in: eventIds } } });
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "ClientCampaignShadowDecision" ENABLE TRIGGER "ClientCampaignShadowDecision_immutable_guard"`
      );
      await prisma.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } });
    }
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
      await prisma.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.sourceFunnel.deleteMany({
        where: {
          OR: [{ originClientAccountId: { in: clientIds } }, { suggestedClientAccountId: { in: clientIds } }],
        },
      }).catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    restore("ADMIN_API_KEY", savedEnv.admin);
    restore("SA360_ADMIN_KEY", savedEnv.alias);
    restore("SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED", savedEnv.registry);
    restore("SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED", savedEnv.shadow);
  });

  test("exact VET and NURSE sources freeze distinct decisions without delivery", async () => {
    const clientAccountId = await createClient("lanes");
    const vetA = await saveCampaign(clientAccountId, "vet-life-east", "VET", "funnel-a", "wf_vet_a", "Vet");
    const vetB = await saveCampaign(clientAccountId, "vet-life-west", "VET", "funnel-b", "wf_vet_b", "Vet West");
    const nurse = await saveCampaign(clientAccountId, "nurse-life", "NURSE", "funnel-n", "wf_nurse", "Nurse");
    const before = await operationalCounts(clientAccountId);

    const east = await eventFor(clientAccountId, "funnel-a", { niche_key: "vet_fex" }, "vet_web_form");
    const west = await eventFor(clientAccountId, "funnel-b", { niche_key: "VET" }, "vet_web_form");
    const nurseEvent = await eventFor(clientAccountId, "funnel-n", { niche_key: "nurse_life" }, "nurse_web_form");
    const secondEast = await eventFor(clientAccountId, "funnel-a2", {}, "vet_web_form");
    await saveExtraBinding(clientAccountId, vetA.id, vetA.revision, "funnel-a2");

    for (const id of [east, west, nurseEvent, secondEast]) {
      const observed = await observeClientCampaignShadow(id);
      assert.equal(observed.written, true);
      const again = await observeClientCampaignShadow(id);
      assert.equal(again.skipped, "frozen");
    }

    const [rowA, rowB, rowN, rowA2] = await Promise.all([east, west, nurseEvent, secondEast].map(readDecision));
    assert.equal(rowA?.status, "MATCHED");
    assert.equal(rowA?.clientCampaignId, vetA.id);
    assert.equal(rowA?.configuredNicheKey, "VET");
    assert.equal(rowA?.nicheClassificationStatus, "MATCH");
    assert.equal(rowB?.clientCampaignId, vetB.id);
    assert.notEqual(rowA?.clientCampaignId, rowB?.clientCampaignId);
    assert.equal(rowN?.clientCampaignId, nurse.id);
    assert.equal(rowN?.configuredNicheKey, "NURSE");
    assert.equal(rowA2?.clientCampaignId, vetA.id);
    const tags = rowA?.proposedTagsJson as { nicheTag?: string; campaignTag?: string; authorized?: boolean };
    assert.equal(tags.authorized, true);
    assert.equal(tags.nicheTag, "SA360::NICHE::VET");
    assert.equal(tags.campaignTag, "SA360::CAMPAIGN::vet-life-east");
    const destination = rowA?.destinationSelectionJson as { workflowIdGhl?: string; deliveryExecuted?: boolean };
    assert.equal(destination.workflowIdGhl, "wf_vet_a");
    assert.equal(destination.deliveryExecuted, false);
    const leadType = rowA?.leadTypeDecisionJson as { leadTypeKey?: string };
    assert.equal(leadType.leadTypeKey, "vet_web_form");
    assert.notEqual(leadType.leadTypeKey, rowA?.configuredNicheKey);

    const storedEvent = await prisma.sourceLeadEvent.findUniqueOrThrow({ where: { id: east } });
    assert.equal((storedEvent.routingResultJson as { frozen?: boolean }).frozen, true);
    assert.deepEqual(await operationalCounts(clientAccountId), before);
    assert.equal(await prisma.clientCampaignShadowDecision.count({ where: { sourceLeadEventId: east } }), 1);

    const missing = await eventFor(clientAccountId, "funnel-missing", {}, null);
    await observeClientCampaignShadow(missing);
    const unresolved = await readDecision(missing);
    assert.equal(unresolved?.status, "UNRESOLVED");
    assert.equal(unresolved?.clientCampaignId, null);
    const unresolvedTags = unresolved?.proposedTagsJson as { authorized?: boolean };
    assert.equal(unresolvedTags.authorized, false);

    const conflict = await eventFor(clientAccountId, "funnel-n", { niche_key: "VET" }, "nurse_web_form");
    await observeClientCampaignShadow(conflict);
    const conflicted = await readDecision(conflict);
    assert.equal(conflicted?.status, "REVIEW_REQUIRED");
    assert.equal(conflicted?.nicheClassificationStatus, "CONFLICT");
    assert.equal((conflicted?.proposedTagsJson as { authorized?: boolean }).authorized, false);

    await updateClientCampaign(
      prisma,
      {
        intent: "update",
        clientAccountId,
        campaignId: vetA.id,
        requestId: randomUUID(),
        expectedRevision: (await prisma.clientCampaign.findUniqueOrThrow({ where: { id: vetA.id } })).revision,
        displayName: "Renamed after the lead",
        nicheKey: "FEX",
        productType: "other",
        status: "review",
      },
      process.env,
      "ADMIN"
    );
    const replay = await observeClientCampaignShadow(east);
    assert.equal(replay.skipped, "frozen");
    const still = await readDecision(east);
    assert.equal(still?.configuredNicheKey, "VET");
    assert.equal(still?.campaignDisplayName, "Veteran FEX East");
    assert.equal(still?.campaignRevision, rowA?.campaignRevision);
    assert.equal(still?.evaluatedAt.getTime(), rowA?.evaluatedAt.getTime());
    await assert.rejects(() =>
      prisma.clientCampaignShadowDecision.update({ where: { id: still!.id }, data: { campaignDisplayName: "changed" } })
    );

    const other = await createClient("other");
    await saveCampaign(other, "other-vet", "VET", "funnel-cross", "wf_other", "Other");
    const crossed = await eventFor(clientAccountId, "funnel-cross", { niche_key: "VET" }, "vet_web_form");
    await observeClientCampaignShadow(crossed);
    const crossedRow = await readDecision(crossed);
    assert.equal(crossedRow?.status, "REVIEW_REQUIRED");
    assert.equal(crossedRow?.clientCampaignId, null);
    assert.equal(JSON.stringify(crossedRow).includes(other), false);

    process.env.SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED = "false";
    const disabledEvent = await eventFor(clientAccountId, "funnel-a", { niche_key: "VET" }, "vet_web_form");
    const disabled = await observeClientCampaignShadow(disabledEvent);
    assert.equal(disabled.skipped, "disabled");
    assert.equal(await prisma.clientCampaignShadowDecision.count({ where: { sourceLeadEventId: disabledEvent } }), 0);
    process.env.SA360_CLIENT_CAMPAIGN_SHADOW_RESOLUTION_ENABLED = "true";

    const missingAuth = await app.inject({ method: "GET", url: `/admin/v1/source-leads/${east}/campaign-shadow` });
    assert.equal(missingAuth.statusCode, 401);
    const unknown = await app.inject({
      method: "GET",
      url: "/admin/v1/source-leads/missing-event/campaign-shadow",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(unknown.statusCode, 404);
    const read = await app.inject({
      method: "GET",
      url: `/admin/v1/source-leads/${east}/campaign-shadow`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(read.statusCode, 200);
    const body = read.json();
    assert.equal(body.evaluation, "stored");
    assert.match(body.banner, /Shadow analysis only/);
    assert.equal(body.decision.clientCampaignId, vetA.id);
    assert.equal(body.decision.deliveryExecuted, false);
    assert.equal(body.decision.proposedTags.nicheTag, "SA360::NICHE::VET");
    const empty = await app.inject({
      method: "GET",
      url: `/admin/v1/source-leads/${disabledEvent}/campaign-shadow`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(empty.statusCode, 200);
    assert.equal(empty.json().evaluation, "not_evaluated");
    assert.equal(empty.json().decision, null);
  });
});

async function createClient(label: string): Promise<string> {
  seq += 1;
  const clientAccountId = `csh${label}${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: label, status: "onboarding" },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function saveCampaign(
  clientAccountId: string,
  slug: string,
  nicheKey: string,
  funnelId: string,
  workflowId: string,
  worksheetTitle: string
): Promise<{ id: string; revision: number }> {
  const created = await createClientCampaign(
    prisma,
    {
      intent: "create",
      clientAccountId,
      requestId: randomUUID(),
      expectedRevision: 0,
      slug,
      displayName: slug === "nurse-life" ? "Nurse Life" : "Veteran FEX East",
      nicheKey,
      productType: "life_insurance",
    },
    process.env,
    "ADMIN"
  );
  assert.equal(created.ok, true, created.error);
  const campaignId = created.campaignId!;
  const bound = await saveClientCampaignBindings(
    prisma,
    {
      intent: "save_bindings",
      clientAccountId,
      campaignId,
      requestId: randomUUID(),
      expectedRevision: created.revision!,
      bindings: [bindingDraft(funnelId)],
    },
    process.env,
    "ADMIN"
  );
  assert.equal(bound.ok, true, bound.error);
  const destination = await saveClientCampaignDestination(
    prisma,
    {
      intent: "save_destination",
      clientAccountId,
      campaignId,
      requestId: randomUUID(),
      expectedRevision: bound.revision!,
      workflowIdGhl: workflowId,
      workflowTriggerMode: "tag_trigger",
      ghlLocationId: null,
      spreadsheetId: null,
      worksheetId: nicheKey === "NURSE" ? 2 : 1,
      worksheetTitle,
    },
    process.env,
    "ADMIN"
  );
  assert.equal(destination.ok, true, destination.error);
  return { id: campaignId, revision: destination.revision! };
}

async function saveExtraBinding(
  clientAccountId: string,
  campaignId: string,
  _revision: number,
  funnelId: string
): Promise<void> {
  const current = await prisma.clientCampaign.findUniqueOrThrow({ where: { id: campaignId } });
  const existing = await prisma.clientCampaignSourceBinding.findMany({
    where: { clientCampaignId: campaignId, status: { not: "superseded" } },
    include: { identities: true },
  });
  const saved = await saveClientCampaignBindings(
    prisma,
    {
      intent: "save_bindings",
      clientAccountId,
      campaignId,
      requestId: randomUUID(),
      expectedRevision: current.revision,
      bindings: [
        ...existing.map((row) =>
          bindingDraft(row.identities[0]?.normalizedValue ?? funnelId, row.bindingKey)
        ),
        bindingDraft(funnelId, `source-${funnelId}`),
      ],
    },
    process.env,
    "ADMIN"
  );
  assert.equal(saved.ok, true, saved.error);
}

function bindingDraft(funnelId: string, bindingKey = `source-${funnelId}`) {
  return {
    bindingKey,
    requestedStatus: "approved" as const,
    sourceFunnelId: null,
    campaignRoutingRuleId: null,
    provider: "leadcapture_io" as const,
    providerFunnelId: funnelId,
    parentUrlKey: null,
    campaignId: null,
    formId: null,
    adsetId: null,
    adId: null,
    evidence: null,
  };
}

async function eventFor(
  clientAccountId: string,
  funnelId: string,
  rawNiche: Record<string, string>,
  leadTypeKey: "vet_web_form" | "nurse_web_form" | null
): Promise<string> {
  const leadType =
    leadTypeKey === null
      ? { absent: true }
      : {
          version: 1,
          status: "resolved",
          leadTypeKey,
          leadTypeLabel: leadTypeKey === "vet_web_form" ? "Vet Web Form" : "Nurse Web Form",
          binding: { kind: "confirmed_source_association", id: "sf_test", leadTypeKey },
          evidence: {
            trustedKey: null,
            trustedAdapter: null,
            bindingKey: leadTypeKey,
            bypassedSourceLeadTypeKey: null,
          },
        };
  const event = await prisma.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      sourceRouteKey: `LCIO_NG_${funnelId}`,
      clientAccountIdResolved: clientAccountId,
      status: "routing_matched",
      rawPayloadJson: { ...rawNiche, funnel_id: funnelId, utm_campaign: "veteran-fex" },
      normalizedPayloadJson: {
        attribution: { utm_campaign: "veteran-fex" },
        routing: { source_intake: { funnel_id: funnelId } },
      },
      routingResultJson: {
        frozen: true,
        matched: true,
        routingAuthority: "confirmed_source_association",
        campaignLeadType: leadType,
      },
    },
  });
  eventIds.push(event.id);
  return event.id;
}

function readDecision(sourceLeadEventId: string) {
  return prisma.clientCampaignShadowDecision.findUnique({
    where: { sourceLeadEventId_decisionVersion: { sourceLeadEventId, decisionVersion: 1 } },
  });
}

async function operationalCounts(clientAccountId: string) {
  const [rules, jobs, intents, confirmed] = await Promise.all([
    prisma.campaignRoutingRule.count({ where: { clientAccountId } }),
    prisma.companySheetsDeliveryJob.count({ where: { clientAccountId } }),
    prisma.companySheetsDispatchIntent.count({ where: { clientAccountId } }),
    prisma.sourceFunnel.count({ where: { originClientAccountId: clientAccountId, associationStatus: "confirmed" } }),
  ]);
  return { rules, jobs, intents, confirmed };
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
