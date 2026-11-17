import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import Fastify from "fastify";
import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminSourceFunnelRoutes } from "../../routes/admin-source-funnels.js";
import { processLeadCaptureNextGenLeadCreated } from "./leadcapture-nextgen-intake.service.js";
import type { CampaignLeadTypeDecision } from "./campaign-lead-type.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

const HEADER = "x-sa360-admin-key";
const ADMIN_KEY = "admin-lead-type-563f";
const RAY = "ray_leadtype_563f";
const RULE_CLIENT = "ray_rule_client_563f";
const RAY_URL = "https://go.lifeinsuranceforvets.com/learn-ray-rodriguez-563f?utm_campaign=nurse-text";
const RAY_KEY = "go.lifeinsuranceforvets.com/learn-ray-rodriguez-563f";
const NURSE_URL = "https://quotes.nurses.example/learn-ray-nurse-563f?q=vet";
const NURSE_KEY = "quotes.nurses.example/learn-ray-nurse-563f";
const BARE_URL = "https://forms.example.test/learn-ray-bare-563f";
const BARE_KEY = "forms.example.test/learn-ray-bare-563f";
const PARENT_KEYS = [RAY_KEY, NURSE_KEY, BARE_KEY];
const SHARED_PHONE = "5555634170";
const EXACT_ROUTE = "CLT_RAY_EXACT_563F";

function leadId(suffix: string): string {
  return `11111111-1111-4111-8111-${suffix.padStart(12, "0")}`;
}

function payload(input: {
  leadId: string;
  parentUrl: string;
  routeKey: string;
  phone?: string;
  campaignLeadType?: string;
  campaignId?: string;
}): Record<string, unknown> {
  return {
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    sa360_source_platform: "leadcapture_io",
    lead_id: input.leadId,
    submitted_at: "2026-11-17T15:00:00.000Z",
    first_name: "Ray",
    last_name: "Rodriguez",
    email: `${input.leadId}@example.test`,
    phone: input.phone ?? SHARED_PHONE,
    state: "FL",
    parent_url: input.parentUrl,
    funnel_name: "Nurse benefits for truckers",
    niche_key: "NURSE",
    lead_type: "NURSE",
    product_type: "Final Expense",
    sa360_route_key: input.routeKey,
    ...(input.campaignId ? { campaign_id: input.campaignId } : {}),
    ...(input.campaignLeadType ? { sa360_campaign_lead_type: input.campaignLeadType } : {}),
  };
}

function decisionOf(routing: unknown): CampaignLeadTypeDecision {
  const record = routing as { campaignLeadType?: CampaignLeadTypeDecision } | null;
  const decision = record?.campaignLeadType;
  assert.ok(decision, "expected a stored campaign lead type decision");
  return decision;
}

describe("campaign lead type at intake", { skip: !runIntegration, concurrency: 1 }, () => {
  let db: PrismaClient;
  let app: Awaited<ReturnType<typeof Fastify>>;
  const createdEventIds: string[] = [];
  const createdRuleIds: string[] = [];
  const prevAdminKey = process.env.ADMIN_API_KEY;
  let rayFunnelId = "";
  let nurseFunnelId = "";
  let bareFunnelId = "";

  async function admin(url: string, payloadBody?: unknown) {
    return app.inject({
      method: "POST",
      url,
      headers: { [HEADER]: ADMIN_KEY },
      payload: payloadBody,
    });
  }

  async function intake(body: Record<string, unknown>) {
    const result = await processLeadCaptureNextGenLeadCreated({
      rawPayload: body,
      stageOverride: "normalize_route_proof",
    });
    createdEventIds.push(result.sourceEventId);
    return result;
  }

  async function storedDecision(sourceEventId: string) {
    const event = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: sourceEventId } });
    return {
      event,
      decision: decisionOf(event.routingResultJson),
    };
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = url;
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: [
        { clientAccountId: RAY, clientDisplayName: "Ray Rodriguez", status: "active" },
        { clientAccountId: RULE_CLIENT, clientDisplayName: "Exact Rule Client", status: "active" },
      ],
    });
    app = Fastify({ logger: false });
    await app.register(adminSourceFunnelRoutes, { prefix: "/admin/v1" });

    const ray = await admin(`/admin/v1/clients/${RAY}/source-funnels`, { pageUrlOrSlug: RAY_URL });
    assert.equal(ray.statusCode, 201);
    const rayBody = ray.json() as { parentUrlKey: string; item: { id: string; originClientAccountId: string } };
    assert.equal(rayBody.parentUrlKey, RAY_KEY);
    rayFunnelId = rayBody.item.id;
    assert.equal(rayBody.item.originClientAccountId, RAY);

    const nurse = await admin(`/admin/v1/clients/${RAY}/source-funnels`, { pageUrlOrSlug: NURSE_URL });
    assert.equal(nurse.statusCode, 201);
    nurseFunnelId = (nurse.json() as { item: { id: string } }).item.id;

    const bare = await admin(`/admin/v1/clients/${RAY}/source-funnels`, { pageUrlOrSlug: BARE_URL });
    assert.equal(bare.statusCode, 201);
    bareFunnelId = (bare.json() as { item: { id: string } }).item.id;

    const vetType = await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, {
      leadTypeKey: "vet_web_form",
    });
    assert.equal(vetType.statusCode, 200);
    const nurseType = await admin(`/admin/v1/source-funnels/${nurseFunnelId}/lead-type`, {
      leadTypeKey: "nurse_web_form",
    });
    assert.equal(nurseType.statusCode, 200);
  });

  after(async () => {
    await cleanup();
    await app?.close();
    await db?.$disconnect();
    if (prevAdminKey !== undefined) process.env.ADMIN_API_KEY = prevAdminKey;
    else delete process.env.ADMIN_API_KEY;
  });

  async function cleanup() {
    if (!db) return;
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.ghlAssociationDispatchOutbox.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.companySheetsDispatchIntent.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    if (createdRuleIds.length > 0) {
      await db.campaignRoutingRule.deleteMany({ where: { id: { in: createdRuleIds } } });
    }
    await db.leadInventoryItem.deleteMany({
      where: { originClientAccountId: { in: [RAY, RULE_CLIENT] } },
    });
    await db.campaignRoutingRule.deleteMany({
      where: { clientAccountId: { in: [RAY, RULE_CLIENT] } },
    });
    const funnels = await db.sourceFunnel.findMany({
      where: {
        OR: [
          { originClientAccountId: { in: [RAY, RULE_CLIENT] } },
          { provider: "leadcapture_io", parentUrlKey: { in: PARENT_KEYS } },
        ],
      },
      select: { id: true },
    });
    if (funnels.length > 0) {
      await db.sourceFunnelLeadTypeAudit.deleteMany({
        where: { sourceFunnelId: { in: funnels.map((row) => row.id) } },
      });
    }
    await db.sourceFunnel.deleteMany({
      where: {
        OR: [
          { originClientAccountId: { in: [RAY, RULE_CLIENT] } },
          { provider: "leadcapture_io", parentUrlKey: { in: PARENT_KEYS } },
        ],
      },
    });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: [RAY, RULE_CLIENT] } } });
  }

  it("lets an operator set Lead Type on a confirmed source without changing ownership", async () => {
    const eventsBefore = await db.sourceLeadEvent.count();
    const cleared = await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, { leadTypeKey: null });
    assert.equal(cleared.statusCode, 200);
    const clearedBody = cleared.json() as {
      item: { leadTypeKey: string | null; originClientAccountId: string; associationStatus: string };
    };
    assert.equal(clearedBody.item.leadTypeKey, null);
    assert.equal(clearedBody.item.originClientAccountId, RAY);
    assert.equal(clearedBody.item.associationStatus, "confirmed");

    const preserved = await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, {});
    assert.equal(preserved.statusCode, 200);
    const preservedBody = preserved.json() as { changed: boolean; item: { leadTypeKey: string | null } };
    assert.equal(preservedBody.changed, false);
    assert.equal(preservedBody.item.leadTypeKey, null);

    const invalid = await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, { leadTypeKey: "VET" });
    assert.equal(invalid.statusCode, 400);
    assert.equal((await db.sourceFunnel.findUniqueOrThrow({ where: { id: rayFunnelId } })).leadTypeKey, null);

    const saved = await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, {
      leadTypeKey: "vet_web_form",
    });
    assert.equal(saved.statusCode, 200);
    const savedBody = saved.json() as {
      changed: boolean;
      originUnchanged: boolean;
      associationUnchanged: boolean;
      item: { leadTypeKey: string; leadTypeLabel: string; originClientAccountId: string };
    };
    assert.equal(savedBody.changed, true);
    assert.equal(savedBody.originUnchanged, true);
    assert.equal(savedBody.associationUnchanged, true);
    assert.equal(savedBody.item.leadTypeKey, "vet_web_form");
    assert.equal(savedBody.item.leadTypeLabel, "Vet Web Form");
    assert.equal(savedBody.item.originClientAccountId, RAY);

    const audit = await db.sourceFunnelLeadTypeAudit.findFirstOrThrow({
      where: { sourceFunnelId: rayFunnelId, nextKey: "vet_web_form", previousKey: null },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(audit.actor, "ADMIN");
    assert.equal(await db.sourceLeadEvent.count(), eventsBefore);
  });

  it("resolves a Ray-style confirmed parent URL with no payload type to Vet Web Form", async () => {
    const result = await intake(
      payload({
        leadId: leadId("100"),
        parentUrl: RAY_URL,
        routeKey: "CLT_RAY_PARENT_563F",
      })
    );
    assert.equal(result.matched, true);
    assert.equal(result.destinationClientAccountId, RAY);
    const { event, decision } = await storedDecision(result.sourceEventId);
    assert.equal(decision.status, "resolved");
    assert.equal(decision.leadTypeKey, "vet_web_form");
    assert.equal(decision.leadTypeLabel, "Vet Web Form");
    assert.equal(decision.binding.kind, "confirmed_source_association");
    assert.equal(decision.binding.id, rayFunnelId);
    const normalized = event.normalizedPayloadJson as { state?: { lead_type?: string } };
    assert.equal(normalized.state?.lead_type, "NURSE");
    assert.notEqual(decision.leadTypeLabel, normalized.state?.lead_type);
  });

  it("keeps two source types for one client when the phone is repeated", async () => {
    const vet = await intake(
      payload({
        leadId: leadId("200"),
        parentUrl: RAY_URL,
        routeKey: "CLT_RAY_VET_PHONE_563F",
        phone: SHARED_PHONE,
      })
    );
    const nurse = await intake(
      payload({
        leadId: leadId("201"),
        parentUrl: NURSE_URL,
        routeKey: "CLT_RAY_NURSE_PHONE_563F",
        phone: SHARED_PHONE,
      })
    );
    assert.notEqual(vet.sourceEventId, nurse.sourceEventId);
    const vetDecision = (await storedDecision(vet.sourceEventId)).decision;
    const nurseDecision = (await storedDecision(nurse.sourceEventId)).decision;
    assert.equal(vetDecision.leadTypeLabel, "Vet Web Form");
    assert.equal(vetDecision.binding.id, rayFunnelId);
    assert.equal(nurseDecision.leadTypeLabel, "Nurse Web Form");
    assert.equal(nurseDecision.leadTypeKey, "nurse_web_form");
    assert.equal(nurseDecision.binding.id, nurseFunnelId);
    assert.equal(vet.destinationClientAccountId, RAY);
    assert.equal(nurse.destinationClientAccountId, RAY);
  });

  it("records unresolved when the winning source has no Lead Type", async () => {
    const result = await intake(
      payload({
        leadId: leadId("300"),
        parentUrl: BARE_URL,
        routeKey: "CLT_RAY_BARE_563F",
        phone: "5555634300",
      })
    );
    assert.equal(result.matched, true);
    assert.equal(result.destinationClientAccountId, RAY);
    const { decision } = await storedDecision(result.sourceEventId);
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.leadTypeKey, null);
    assert.equal(decision.leadTypeLabel, null);
    assert.equal(decision.binding.id, bareFunnelId);
    assert.equal(decision.binding.leadTypeKey, null);
  });

  it("records a trusted conflict without a resolved label", async () => {
    const result = await intake(
      payload({
        leadId: leadId("400"),
        parentUrl: RAY_URL,
        routeKey: "CLT_RAY_CONFLICT_563F",
        phone: "5555634400",
        campaignLeadType: "nurse_web_form",
      })
    );
    const { decision } = await storedDecision(result.sourceEventId);
    assert.equal(decision.status, "conflict");
    assert.equal(decision.leadTypeKey, null);
    assert.equal(decision.leadTypeLabel, null);
    assert.equal(decision.evidence.trustedKey, "nurse_web_form");
    assert.equal(decision.evidence.bindingKey, "vet_web_form");
    assert.equal(decision.binding.id, rayFunnelId);
  });

  it("does not let a consumer answer impersonate campaign lead type", async () => {
    const body = payload({
      leadId: leadId("402"),
      parentUrl: RAY_URL,
      routeKey: "CLT_RAY_ANSWER_563F",
      phone: "5555634402",
    });
    body.campaign_lead_type = "nurse_web_form";
    body.healthcare_profession = "Vet Web Form";
    body.answers = { sa360_campaign_lead_type: "Trucker Web Form", campaign_lead_type: "vet_web_form" };
    body.routing = {
      campaign_lead_type: "nurse_web_form",
      source_intake: { campaign_lead_type: "Vet Web Form" },
    };
    const result = await intake(body);
    const { decision } = await storedDecision(result.sourceEventId);
    assert.equal(decision.status, "resolved");
    assert.equal(decision.leadTypeKey, "vet_web_form");
    assert.equal(decision.leadTypeLabel, "Vet Web Form");
    assert.equal(decision.evidence.trustedKey, null);
    assert.equal(decision.evidence.trustedAdapter, null);
    assert.equal(decision.binding.id, rayFunnelId);
  });

  it("records agreement when trusted evidence matches the binding", async () => {
    const result = await intake(
      payload({
        leadId: leadId("401"),
        parentUrl: RAY_URL,
        routeKey: "CLT_RAY_AGREE_563F",
        phone: "5555634401",
        campaignLeadType: "Vet Web Form",
      })
    );
    const { decision } = await storedDecision(result.sourceEventId);
    assert.equal(decision.status, "agreement");
    assert.equal(decision.leadTypeKey, "vet_web_form");
    assert.equal(decision.leadTypeLabel, "Vet Web Form");
  });

  it("does not let a winning exact route inherit the bypassed source label", async () => {
    const rule = await db.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "leadcapture_io",
        clientAccountId: RULE_CLIENT,
        clientDisplayName: "Exact Rule Client",
        campaignId: EXACT_ROUTE,
        matchType: "campaign_id",
        destinationSubaccountIdGhl: "loc_ray_exact_563f",
        active: true,
      },
    });
    createdRuleIds.push(rule.id);
    const result = await intake(
      payload({
        leadId: leadId("500"),
        parentUrl: RAY_URL,
        routeKey: EXACT_ROUTE,
        campaignId: EXACT_ROUTE,
        phone: "5555634500",
      })
    );
    assert.equal(result.matched, true);
    assert.equal(result.matchedRuleId, rule.id);
    assert.equal(result.destinationClientAccountId, RULE_CLIENT);
    const { decision } = await storedDecision(result.sourceEventId);
    assert.equal(decision.status, "unresolved");
    assert.equal(decision.leadTypeLabel, null);
    assert.equal(decision.binding.kind, "campaign_routing_rule");
    assert.equal(decision.binding.id, rule.id);
    assert.equal(decision.evidence.bypassedSourceLeadTypeKey, "vet_web_form");
    await db.campaignRoutingRule.delete({ where: { id: rule.id } });
  });

  it("keeps the saved label after the source configuration changes", async () => {
    const first = await intake(
      payload({
        leadId: leadId("600"),
        parentUrl: RAY_URL,
        routeKey: "CLT_RAY_LABEL_563F",
        phone: "5555634600",
      })
    );
    const before = await storedDecision(first.sourceEventId);
    assert.equal(before.decision.leadTypeLabel, "Vet Web Form");
    const beforeJson = JSON.stringify(before.event.routingResultJson);
    const eventCount = await db.sourceLeadEvent.count({ where: { sourceLeadId: leadId("600") } });

    const changed = await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, {
      leadTypeKey: "trucker_web_form",
    });
    assert.equal(changed.statusCode, 200);
    const changedBody = changed.json() as {
      item: { leadTypeLabel: string; originClientAccountId: string; associationStatus: string };
    };
    assert.equal(changedBody.item.leadTypeLabel, "Trucker Web Form");
    assert.equal(changedBody.item.originClientAccountId, RAY);
    assert.equal(changedBody.item.associationStatus, "confirmed");

    const replay = await processLeadCaptureNextGenLeadCreated({
      rawPayload: payload({
        leadId: leadId("600"),
        parentUrl: RAY_URL,
        routeKey: "CLT_RAY_LABEL_563F",
        phone: "5555634600",
        campaignLeadType: "nurse_web_form",
      }),
      stageOverride: "normalize_route_proof",
    });
    assert.equal(replay.duplicate, true);
    assert.equal(replay.sourceEventId, first.sourceEventId);
    const afterReplay = await storedDecision(first.sourceEventId);
    assert.equal(JSON.stringify(afterReplay.event.routingResultJson), beforeJson);
    assert.equal(afterReplay.decision.leadTypeLabel, "Vet Web Form");
    assert.equal(await db.sourceLeadEvent.count({ where: { sourceLeadId: leadId("600") } }), eventCount);

    const later = await intake(
      payload({
        leadId: leadId("601"),
        parentUrl: RAY_URL,
        routeKey: "CLT_RAY_LABEL_NEXT_563F",
        phone: "5555634601",
      })
    );
    const laterDecision = (await storedDecision(later.sourceEventId)).decision;
    assert.equal(laterDecision.status, "resolved");
    assert.equal(laterDecision.leadTypeKey, "trucker_web_form");
    assert.equal(laterDecision.leadTypeLabel, "Trucker Web Form");
    assert.equal((await storedDecision(first.sourceEventId)).decision.leadTypeLabel, "Vet Web Form");

    await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, { leadTypeKey: "vet_web_form" });
  });

  it("records concurrent Lead Type edits from the locked previous value", async () => {
    const cleared = await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, { leadTypeKey: null });
    assert.equal(cleared.statusCode, 200);
    const before = await db.sourceFunnelLeadTypeAudit.count({ where: { sourceFunnelId: rayFunnelId } });
    const [vet, nurse] = await Promise.all([
      admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, { leadTypeKey: "vet_web_form" }),
      admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, { leadTypeKey: "nurse_web_form" }),
    ]);
    assert.equal(vet.statusCode, 200);
    assert.equal(nurse.statusCode, 200);
    const audits = await db.sourceFunnelLeadTypeAudit.findMany({
      where: { sourceFunnelId: rayFunnelId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const added = audits.slice(before);
    assert.equal(added.length, 2);
    const first = added.find((row) => row.previousKey === null);
    const second = added.find((row) => row.previousKey !== null);
    assert.ok(first?.nextKey);
    assert.equal(second?.previousKey, first.nextKey);
    assert.notEqual(second?.nextKey, first.nextKey);
    const stored = await db.sourceFunnel.findUniqueOrThrow({ where: { id: rayFunnelId } });
    assert.equal(stored.leadTypeKey, second?.nextKey);
    assert.equal(stored.originClientAccountId, RAY);
    await admin(`/admin/v1/source-funnels/${rayFunnelId}/lead-type`, { leadTypeKey: "vet_web_form" });
  });
});
