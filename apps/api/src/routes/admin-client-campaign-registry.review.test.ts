import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import {
  createClientCampaign,
  saveClientCampaignBindings,
  updateClientCampaign,
} from "../services/client-campaign-registry/client-campaign-registry.js";
import type { BindingDraft } from "../services/client-campaign-registry/identity.js";
import { adminClientCampaignInventoryRoutes } from "./admin-client-campaign-inventory.js";
import { adminClientCampaignRegistryRoutes } from "./admin-client-campaign-registry.js";

const ADMIN_KEY = "client-campaign-registry-review-key";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const clientIds: string[] = [];
let app: FastifyInstance;
let seq = 0;

test("later registry migrations keep the partial unique index and the command trigger", () => {
  const migrationsDir = path.join(repoRoot, "prisma/migrations");
  const later = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name > "20261119180000_client_campaign_registry")
    .map((entry) => entry.name);
  assert.ok(later.includes("20261119220000_client_campaign_identity_status_guard"));
  for (const name of later) {
    const sql = readFileSync(path.join(migrationsDir, name, "migration.sql"), "utf8").replace(/--.*$/gm, "");
    assert.equal(sql.includes("DROP INDEX") && sql.includes("ClientCampaignSourceIdentity_one_approved_key"), false, name);
    assert.equal(sql.includes("DROP TRIGGER") && sql.includes("ClientCampaignRegistryCommand_immutable_guard"), false, name);
    assert.equal(sql.includes('UPDATE "SourceFunnel"'), false, name);
    assert.equal(sql.includes('UPDATE "CampaignRoutingRule"'), false, name);
    assert.equal(sql.includes('UPDATE "SourceLeadEvent"'), false, name);
    assert.equal(sql.includes('UPDATE "ClientGhlDestination"'), false, name);
    assert.equal(sql.includes('UPDATE "CompanySheetsDestination"'), false, name);
    assert.equal(sql.includes("GRANT ALL"), false, name);
    assert.equal(sql.includes("ALTER DEFAULT PRIVILEGES"), false, name);
  }
});

describe("campaign registry review gaps", { concurrency: 1 }, () => {
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
      await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.sourceFunnel.deleteMany({
        where: {
          OR: [{ originClientAccountId: { in: clientIds } }, { suggestedClientAccountId: { in: clientIds } }],
        },
      }).catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
  });

  test("an approved funnel binding cannot adopt a missing or conflicting stored identifier", async () => {
    const clientAccountId = await createClient("missing");
    const campaignId = await createDraft(clientAccountId, "vet-missing");
    const funnel = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: null,
        parentUrlKey: `my.leadcapture.io/p/${clientAccountId}-url`,
        associationStatus: "confirmed",
        originClientAccountId: clientAccountId,
      },
    });
    const before = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: funnel.id } });
    const requestId = randomUUID();
    const missing = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(1, [
        binding({
          bindingKey: "url-only",
          requestedStatus: "approved",
          provider: "leadcapture_io",
          providerFunnelId: `invented-${clientAccountId}`,
          sourceFunnelId: funnel.id,
        }),
      ], requestId)
    );
    assert.equal(missing.statusCode, 409);
    assert.equal(missing.json().error, "identifier_inconsistent");
    assert.equal(missing.json().originConfirmed, false);
    assert.equal(await commandCount(requestId), 0);
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: campaignId } }), 0);

    const recorded = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(1, [
        binding({
          bindingKey: "url-only",
          requestedStatus: "recorded",
          provider: "leadcapture_io",
          providerFunnelId: `invented-${clientAccountId}`,
          sourceFunnelId: funnel.id,
        }),
      ], requestId)
    );
    assert.equal(recorded.statusCode, 200, recorded.body);
    assert.equal(recorded.json().bindings[0].status, "recorded");
    assert.equal(recorded.json().bindings[0].originConfirmed, false);
    assert.equal(recorded.json().replayed, false);

    const conflictingFunnel = await prisma.sourceFunnel.create({
      data: {
        provider: "leadcapture_io",
        providerFunnelId: `stored-${clientAccountId}`,
        parentUrlKey: `my.leadcapture.io/p/${clientAccountId}-stored`,
        associationStatus: "confirmed",
        originClientAccountId: clientAccountId,
      },
    });
    const conflictRequest = randomUUID();
    const conflict = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(2, [
        binding({
          bindingKey: "stored-page",
          requestedStatus: "approved",
          provider: "leadcapture_io",
          providerFunnelId: `other-${clientAccountId}`,
          sourceFunnelId: conflictingFunnel.id,
        }),
      ], conflictRequest)
    );
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, "identifier_inconsistent");
    assert.equal(await commandCount(conflictRequest), 0);
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: campaignId, bindingKey: "stored-page" } }), 0);

    const mismatchProvider = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(2, [
        binding({
          bindingKey: "stored-page",
          requestedStatus: "approved",
          provider: "facebook",
          providerFunnelId: conflictingFunnel.providerFunnelId,
          sourceFunnelId: conflictingFunnel.id,
        }),
      ])
    );
    assert.equal(mismatchProvider.statusCode, 409);
    assert.equal(mismatchProvider.json().error, "identifier_inconsistent");

    const matched = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(2, [
        binding({
          bindingKey: "stored-page",
          requestedStatus: "approved",
          provider: "leadcapture_io",
          providerFunnelId: conflictingFunnel.providerFunnelId,
          parentUrlKey: `https://${conflictingFunnel.parentUrlKey}?utm_campaign=veteran`,
          formId: conflictingFunnel.providerFunnelId,
          sourceFunnelId: conflictingFunnel.id,
        }),
      ])
    );
    assert.equal(matched.statusCode, 200, matched.body);
    const saved = matched.json().bindings[0];
    assert.equal(saved.status, "approved");
    assert.equal(saved.originConfirmed, false);
    assert.deepEqual(
      saved.identities.map((identity: { kind: string }) => identity.kind).sort(),
      ["form_id", "parent_url_key", "provider_funnel_id"]
    );
    const after = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: conflictingFunnel.id } });
    assert.equal(after.associationStatus, "confirmed");
    assert.equal(after.originClientAccountId, clientAccountId);
    assert.equal(after.providerFunnelId, conflictingFunnel.providerFunnelId);
    assert.equal(after.updatedAt.getTime(), conflictingFunnel.updatedAt.getTime());
    const untouched = await prisma.sourceFunnel.findUniqueOrThrow({ where: { id: funnel.id } });
    assert.equal(untouched.updatedAt.getTime(), before.updatedAt.getTime());
    assert.equal(untouched.associationStatus, "confirmed");
    assert.equal(untouched.providerFunnelId, null);
    assert.equal(await prisma.campaignRoutingRule.count({ where: { clientAccountId } }), 0);
  });

  test("replacing bindings supersedes the omitted identity without releasing the one that stays", async () => {
    const clientAccountId = await createClient("replace");
    const firstId = await createDraft(clientAccountId, "vet-keep");
    const secondId = await createDraft(clientAccountId, "vet-next");
    const saved = await post(
      bindingsUrl(clientAccountId, firstId),
      bindingsBody(1, [
        binding({ bindingKey: "keep-form", formId: "form-keep", provider: "facebook" }),
        binding({ bindingKey: "drop-form", formId: "form-drop", provider: "facebook" }),
      ])
    );
    assert.equal(saved.statusCode, 200, saved.body);
    const replaced = await post(
      bindingsUrl(clientAccountId, firstId),
      bindingsBody(2, [binding({ bindingKey: "keep-form", formId: "form-keep", provider: "facebook", requestedStatus: "approved" })])
    );
    assert.equal(replaced.statusCode, 200, replaced.body);
    assert.equal(replaced.json().revision, 3);
    const dropped = await prisma.clientCampaignSourceBinding.findFirstOrThrow({
      where: { clientCampaignId: firstId, bindingKey: "drop-form" },
      include: { identities: true },
    });
    assert.equal(dropped.status, "superseded");
    assert.equal(dropped.identities.every((identity) => identity.active === false), true);
    const kept = await prisma.clientCampaignSourceIdentity.count({
      where: { clientCampaignId: firstId, normalizedValue: "form-keep", active: true, bindingStatus: "approved" },
    });
    assert.equal(kept, 1);
    const taken = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ bindingKey: "keep-form", formId: "form-keep", provider: "facebook", requestedStatus: "approved" })])
    );
    assert.equal(taken.statusCode, 409);
    assert.equal(taken.json().outcome, "REVIEW_REQUIRED");
    const released = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ bindingKey: "drop-form", formId: "form-drop", provider: "facebook", requestedStatus: "approved" })])
    );
    assert.equal(released.statusCode, 200, released.body);
    assert.equal(released.json().bindings[0].status, "approved");
    assert.equal(released.json().bindings[0].originConfirmed, false);
  });

  test("concurrent approval of one exact identity stores a single approved row", async () => {
    const clientAccountId = await createClient("race");
    const firstId = await createDraft(clientAccountId, "vet-race-a");
    const secondId = await createDraft(clientAccountId, "vet-race-b");
    const [left, right] = await Promise.all([
      saveClientCampaignBindings(prisma, saveCommand(clientAccountId, firstId, 1, "form-race"), process.env, "ADMIN"),
      saveClientCampaignBindings(prisma, saveCommand(clientAccountId, secondId, 1, "form-race"), process.env, "ADMIN"),
    ]);
    const results = [left, right];
    assert.equal(results.filter((result) => result.ok).length, 1);
    assert.equal(results.filter((result) => result.error === "review_required" && result.outcome === "REVIEW_REQUIRED").length, 1);
    const winner = results.find((result) => result.ok);
    const loser = results.find((result) => !result.ok);
    assert.equal(winner?.revision, 2);
    assert.equal(loser?.revision, 1);
    assert.equal(loser?.conflicts?.[0]?.code, "exact_identifier_overlap");
    assert.equal(loser?.conflicts?.[0]?.scope, "same_client");
    assert.equal(
      await prisma.clientCampaignSourceIdentity.count({
        where: { normalizedValue: "form-race", active: true, bindingStatus: "approved" },
      }),
      1
    );
    assert.equal(await prisma.clientCampaignSourceBinding.count({ where: { clientCampaignId: loser?.campaignId, status: { not: "superseded" } } }), 0);
    assert.equal(await commandCount(left.requestId), 1);
    assert.equal(await commandCount(right.requestId), 1);
  });

  test("concurrent updates with the same revision let one write win", async () => {
    const clientAccountId = await createClient("revision");
    const campaignId = await createDraft(clientAccountId, "vet-revision");
    const firstRequest = randomUUID();
    const secondRequest = randomUUID();
    const [left, right] = await Promise.all([
      updateClientCampaign(prisma, updateCommand(clientAccountId, campaignId, 1, "Veteran FEX Left", firstRequest), process.env, "ADMIN"),
      updateClientCampaign(prisma, updateCommand(clientAccountId, campaignId, 1, "Veteran FEX Right", secondRequest), process.env, "ADMIN"),
    ]);
    const results = [left, right];
    assert.equal(results.filter((result) => result.ok && result.revision === 2).length, 1);
    assert.equal(results.filter((result) => result.error === "revision_conflict").length, 1);
    const stored = await prisma.clientCampaign.findUniqueOrThrow({ where: { id: campaignId } });
    assert.equal(stored.revision, 2);
    assert.equal([left, right].some((result) => result.ok && result.campaign?.displayName === stored.displayName), true);
    assert.equal(await prisma.clientCampaignRegistryCommand.count({ where: { clientCampaignId: campaignId } }), 2);
    const conflictRequest = results.find((result) => result.error === "revision_conflict")?.requestId;
    assert.equal(await commandCount(conflictRequest), 0);
  });

  test("direct SQL cannot break the identity guard, the approved unique index, or the command log", async () => {
    const clientAccountId = await createClient("sql");
    const otherClientId = await createClient("sql-other");
    const campaignId = await createDraft(clientAccountId, "vet-sql");
    const saved = await post(
      bindingsUrl(clientAccountId, campaignId),
      bindingsBody(1, [binding({ bindingKey: "sql-form", formId: "form-sql", provider: "facebook", requestedStatus: "recorded" })])
    );
    assert.equal(saved.statusCode, 200, saved.body);
    const bindingRow = await prisma.clientCampaignSourceBinding.findFirstOrThrow({ where: { clientCampaignId: campaignId } });

    await assert.rejects(
      () =>
        prisma.$executeRaw`
          UPDATE "ClientCampaignSourceIdentity"
          SET "bindingStatus" = 'approved'::"ClientCampaignSourceBindingStatus"
          WHERE "bindingId" = ${bindingRow.id}
        `,
      /active campaign identity status must match its binding/
    );
    await assert.rejects(
      () =>
        prisma.$executeRaw`
          UPDATE "ClientCampaignSourceIdentity"
          SET "clientAccountId" = ${otherClientId}
          WHERE "bindingId" = ${bindingRow.id}
        `,
      /campaign identity client must match the campaign/
    );

    const command = await prisma.clientCampaignRegistryCommand.findFirstOrThrow({ where: { clientCampaignId: campaignId } });
    await assert.rejects(
      () => prisma.clientCampaignRegistryCommand.update({ where: { id: command.id }, data: { actor: "ADMIN" } }),
      /immutable/
    );

    await assert.rejects(
      () =>
        prisma.$executeRaw`
          INSERT INTO "ClientCampaignSourceBinding" (
            "id", "clientCampaignId", "bindingKey", "evidenceJson", "status", "revision", "actor", "createdAt", "updatedAt"
          ) VALUES (
            ${`cbind${seq}`}, ${campaignId}, 'bare-recorded', '{}'::jsonb, 'recorded'::"ClientCampaignSourceBindingStatus", 1, 'ADMIN', NOW(), NOW()
          )
        `,
      /requires an exact identity/
    );

    await assert.rejects(
      () =>
        prisma.$transaction(async (tx) => {
          await tx.$executeRaw`
            INSERT INTO "ClientCampaignSourceBinding" (
              "id", "clientCampaignId", "bindingKey", "evidenceJson", "status", "revision", "actor", "createdAt", "updatedAt"
            ) VALUES (
              ${`csug${seq}`}, ${campaignId}, 'suggested-with-id', '{}'::jsonb, 'suggested'::"ClientCampaignSourceBindingStatus", 1, 'ADMIN', NOW(), NOW()
            )
          `;
          await tx.$executeRaw`
            INSERT INTO "ClientCampaignSourceIdentity" (
              "id", "bindingId", "clientCampaignId", "clientAccountId", "provider", "kind", "normalizedValue", "active", "bindingStatus", "createdAt"
            ) VALUES (
              ${`cid${seq}`}, ${`csug${seq}`}, ${campaignId}, ${clientAccountId},
              'facebook'::"SourceLeadProvider", 'form_id'::"ClientCampaignIdentifierKind", 'form-suggested', true,
              'suggested'::"ClientCampaignSourceBindingStatus", NOW()
            )
          `;
        }),
      /suggested campaign binding cannot store an exact identity/
    );

    const secondId = await createDraft(clientAccountId, "vet-sql-b");
    const second = await post(
      bindingsUrl(clientAccountId, secondId),
      bindingsBody(1, [binding({ bindingKey: "approved-form", formId: "form-approved", provider: "facebook", requestedStatus: "approved" })])
    );
    assert.equal(second.statusCode, 200, second.body);
    const secondBinding = await prisma.clientCampaignSourceBinding.findFirstOrThrow({
      where: { clientCampaignId: secondId, bindingKey: "approved-form" },
    });
    await assert.rejects(
      () =>
        prisma.$executeRaw`
          INSERT INTO "ClientCampaignSourceIdentity" (
            "id", "bindingId", "clientCampaignId", "clientAccountId", "provider", "kind", "normalizedValue", "active", "bindingStatus", "createdAt"
          ) VALUES (
            ${`cdup${seq}`}, ${secondBinding.id}, ${secondId}, ${clientAccountId},
            'facebook'::"SourceLeadProvider", 'form_id'::"ClientCampaignIdentifierKind", 'form-approved', true,
            'approved'::"ClientCampaignSourceBindingStatus", NOW()
          )
        `,
      /ClientCampaignSourceIdentity_one_approved_key|duplicate key|Unique constraint failed|already exists/
    );

    const destination = await post(destinationUrl(clientAccountId, campaignId), destinationBody(2, { workflowIdGhl: "wf-sql" }));
    assert.equal(destination.statusCode, 200, destination.body);
    await assert.rejects(
      () =>
        prisma.$executeRaw`
          UPDATE "ClientCampaignDestinationSelection"
          SET "workflowLiveVerified" = true
          WHERE "clientCampaignId" = ${campaignId}
        `,
      /ClientCampaignDestinationSelection_shape_chk|check constraint/
    );
    const row = await prisma.clientCampaignDestinationSelection.findUniqueOrThrow({ where: { clientCampaignId: campaignId } });
    assert.equal(row.workflowLiveVerified, false);
    assert.equal(row.mapPublished, false);
  });

  test("another client's campaign id and destination cannot be used", async () => {
    const clientAccountId = await createClient("tenant");
    const otherClientId = await createClient("tenant-other");
    const campaignId = await createDraft(clientAccountId, "vet-tenant");
    const foreignRead = await app.inject({
      method: "GET",
      url: resource(otherClientId, campaignId),
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(foreignRead.statusCode, 404);
    assert.equal(foreignRead.json().error, "campaign_not_found");
    assert.equal(JSON.stringify(foreignRead.json()).includes(clientAccountId), false);
    const foreignWrite = await post(resource(otherClientId, campaignId), updateBody(1));
    assert.equal(foreignWrite.statusCode, 404);
    assert.equal(foreignWrite.json().error, "campaign_not_found");

    await prisma.clientGhlDestination.create({
      data: { clientAccountId, destinationSubaccountIdGhl: `loc-${clientAccountId}`, deliveryEnabled: false },
    });
    const otherCampaignId = await createDraft(otherClientId, "nurse-tenant");
    const borrowed = await post(
      destinationUrl(otherClientId, otherCampaignId),
      destinationBody(1, { ghlLocationId: `loc-${clientAccountId}`, workflowIdGhl: "wf-borrowed" })
    );
    assert.equal(borrowed.statusCode, 409);
    assert.equal(borrowed.json().error, "ghl_location_mismatch");
    assert.equal(JSON.stringify(borrowed.json()).includes(clientAccountId), false);
    assert.equal(await prisma.clientCampaignDestinationSelection.count({ where: { clientCampaignId: otherCampaignId } }), 0);
  });

  test("the registry flag off leaves the inventory read available", async () => {
    const clientAccountId = await createClient("flag");
    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "false";
    const blocked = await post(collection(clientAccountId), createBody({ slug: "vet-blocked" }));
    assert.equal(blocked.statusCode, 404);
    assert.equal(blocked.json().error, "client_campaign_registry_disabled");
    const inventory = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${clientAccountId}/campaign-inventory`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(inventory.statusCode, 200);
    assert.equal(inventory.json().readOnly, true);
    assert.equal(inventory.json().writesPerformed, false);
    assert.equal(await prisma.clientCampaign.count({ where: { clientAccountId } }), 0);
    process.env.SA360_CLIENT_CAMPAIGN_REGISTRY_ENABLED = "true";
  });
});

function binding(overrides: Partial<BindingDraft> = {}): BindingDraft {
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

function bindingsBody(expectedRevision: number, bindings: BindingDraft[], requestId = randomUUID()) {
  return { requestId, expectedRevision, intent: "save_bindings", bindings };
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

function updateBody(expectedRevision: number) {
  return {
    requestId: randomUUID(),
    expectedRevision,
    intent: "update",
    displayName: "Veteran FEX Campaign A",
    nicheKey: "VET",
    productType: "life_insurance",
    status: "draft",
  };
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

function saveCommand(clientAccountId: string, campaignId: string, expectedRevision: number, formId: string) {
  return {
    intent: "save_bindings" as const,
    clientAccountId,
    campaignId,
    requestId: randomUUID(),
    expectedRevision,
    bindings: [binding({ bindingKey: "race-form", formId, provider: "facebook", requestedStatus: "approved" })],
  };
}

function updateCommand(clientAccountId: string, campaignId: string, expectedRevision: number, displayName: string, requestId: string) {
  return {
    intent: "update" as const,
    clientAccountId,
    campaignId,
    requestId,
    expectedRevision,
    displayName,
    nicheKey: "VET",
    productType: "life_insurance",
    status: "draft",
  };
}

async function createClient(label: string): Promise<string> {
  seq += 1;
  const clientAccountId = `rev${label}${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48);
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: label, status: "onboarding" },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function createDraft(clientAccountId: string, slug: string): Promise<string> {
  const created = await createClientCampaign(
    prisma,
    {
      intent: "create",
      clientAccountId,
      requestId: randomUUID(),
      expectedRevision: 0,
      slug,
      displayName: "Veteran FEX Campaign A",
      nicheKey: "VET",
      productType: "life_insurance",
    },
    process.env,
    "ADMIN"
  );
  assert.equal(created.ok, true, created.error);
  return created.campaignId as string;
}

async function commandCount(requestId: string | undefined): Promise<number> {
  if (!requestId) return 0;
  return prisma.clientCampaignRegistryCommand.count({ where: { requestId } });
}

async function post(url: string, payload: unknown) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
    payload: payload as object,
  });
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
