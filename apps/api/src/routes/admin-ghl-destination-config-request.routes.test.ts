import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import { recordGhlDestinationConfigRequest } from "../services/ghl-destination-config-request.js";
import { adminGhlDestinationConfigRequestRoutes } from "./admin-ghl-destination-config-request.js";

const ADMIN_KEY = "ghl-destination-config-test-key";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const apiSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const clientIds: string[] = [];
const locationIds: string[] = [];
let app: FastifyInstance;
let seq = 0;

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  flag: process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED,
};

test("the configuration request does not touch operational writers or readers", () => {
  const service = readFileSync(
    new URL("../services/ghl-destination-config-request.ts", import.meta.url),
    "utf8"
  );
  const route = readFileSync(new URL("./admin-ghl-destination-config-request.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    path.join(repoRoot, "prisma/migrations/20261110143000_ghl_destination_configuration_request/migration.sql"),
    "utf8"
  );
  const observer = readFileSync(
    path.join(repoRoot, "apps/admin-coc/src/lib/admin-coc-observer-access.ts"),
    "utf8"
  );
  for (const source of [service, route]) {
    for (const forbidden of [
      "saveClientGhlConfig",
      "linkGhlConnectionToClient",
      "applyLalAiBot1WebformConfiguration",
      "executeSelectedGhlDeliveryTest",
      "executeRecordedGhlDelivery",
      "activateOngoingGhl",
      "createCampaignRoutingRule",
      "deliveryMode:",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  }
  assert.equal(service.includes('FROM "ClientGhlDestination"'), true);
  assert.equal(service.includes("FOR UPDATE"), true);
  assert.equal(service.includes("live_destination"), true);
  assert.equal(observer.includes("ghl-destination-configuration"), false);
  assert.match(migration, /SET LOCAL lock_timeout = '3s'/);
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;$/m);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE/);
  assert.equal(migration.includes("GRANT SELECT, INSERT, UPDATE, DELETE"), false);
  assert.equal(migration.includes('UPDATE "ClientGhlDestination"'), false);
  assert.equal(migration.includes('UPDATE "CampaignRoutingRule"'), false);
  assert.equal(migration.includes("deliveryEnabled"), true);
  for (const relative of [
    "services/association-ongoing-delivery.ts",
    "services/association-ghl-delivery-source.ts",
    "services/ghl-delivery-adapter/ghl-live-canary.service.ts",
    "services/ghl-config-discovery/client-ghl-config.service.ts",
    "services/ghl-oauth/ghl-connection.service.ts",
    "services/routing-matcher.service.ts",
    "services/ghl-association-dispatch/ghl-association-dispatch.ts",
    "services/activate-ongoing-ghl.ts",
    "services/lead-delivery/direct-demo-delivery.service.ts",
  ]) {
    const source = readFileSync(path.join(apiSrc, relative), "utf8");
    assert.equal(source.includes("GhlDestinationConfigurationRequest"), false, relative);
  }
});

describe("GoHighLevel destination configuration requests", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED = "true";
    app = Fastify({ logger: false });
    await app.register(adminGhlDestinationConfigRequestRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    await app.close();
    if (clientIds.length > 0) {
      await prisma.ghlDestinationConfigurationRequest
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.clientGhlDestination
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.ghlLiveDeliveryRun
        .deleteMany({ where: { destinationClientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.campaignRoutingRule
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    if (locationIds.length > 0) {
      await prisma.ghlLocationConfigSnapshot
        .deleteMany({ where: { locationId: { in: locationIds } } })
        .catch(() => undefined);
      await prisma.ghlLocationConnection
        .deleteMany({ where: { locationId: { in: locationIds } } })
        .catch(() => undefined);
    }
    restoreEnv("ADMIN_API_KEY", savedEnv.admin);
    restoreEnv("SA360_ADMIN_KEY", savedEnv.alias);
    restoreEnv("SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED", savedEnv.flag);
  });

  test("admin auth, portal and workspace credentials, and the exact-true flag refuse the route", async () => {
    const world = await createWorld();
    const missing = await app.inject({ method: "POST", url: url(world.clientAccountId), payload: body(world) });
    assert.equal(missing.statusCode, 401);

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

    process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED = "TRUE";
    const flagged = await post(world);
    assert.equal(flagged.statusCode, 404);
    assert.equal(flagged.json().error, "ghl_destination_config_request_disabled");
    const direct = await recordGhlDestinationConfigRequest(prisma, command(world), process.env);
    assert.equal(direct.ok, false);
    if (!direct.ok) assert.equal(direct.error, "feature_disabled");
    process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED = "true";
    assert.equal(await requestCount(world.clientAccountId), 0);
    assert.equal(await operationalChanges(world), false);
  });

  test("a client without a destination stores the request and does not create a destination", async () => {
    const world = await createWorld();
    const beforeOps = await operationalSnapshot(world);
    const saved = await post(world);
    assert.equal(saved.statusCode, 200);
    const json = saved.json();
    assert.equal(json.ok, true);
    assert.equal(json.replayed, false);
    assert.equal(json.locationId, world.locationId);
    assert.equal(json.workflowId, "wf_exact");
    assert.deepEqual(json.fieldMappings, surveyMappings());
    assert.equal(json.destinationUpdated, false);
    assert.equal(json.deliveryArmed, false);
    assert.equal(json.enrollmentPerformed, false);
    assert.equal(json.routingChanged, false);
    assert.equal(json.liveDestinationChanged, false);
    assert.equal(await prisma.clientGhlDestination.findUnique({ where: { clientAccountId: world.clientAccountId } }), null);
    assert.equal(await requestCount(world.clientAccountId), 1);
    assert.deepEqual(await operationalSnapshot(world), beforeOps);

    const read = await app.inject({ method: "GET", url: url(world.clientAccountId), headers: adminHeaders() });
    assert.equal(read.statusCode, 200);
    assert.equal(read.json().liveDestination, false);
    assert.equal(read.json().destinationUpdatedAt, null);
    assert.equal(read.json().configuration.workflowId, "wf_exact");
    assert.equal(read.json().destinationUpdated, false);
  });

  test("an inactive destination is unchanged while the request stores explicit ids", async () => {
    const world = await createWorld();
    await createDestination(world, { workflowId: "wf_old" });
    const beforeRow = await destinationRow(world.clientAccountId);
    const saved = await post(world, undefined, { expectedDestinationUpdatedAt: beforeRow.updatedAt });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().workflowId, "wf_exact");
    const afterRow = await destinationRow(world.clientAccountId);
    assert.equal(afterRow.destinationWorkflowIdGhl, "wf_old");
    assert.equal(afterRow.deliveryEnabled, false);
    assert.equal(afterRow.deliveryMode, "shadow");
    assert.equal(afterRow.clientCutoverApproved, false);
    assert.equal(afterRow.internalApprovalStatus, "not_reviewed");
    assert.equal(afterRow.updatedAt, beforeRow.updatedAt);
    assert.deepEqual(afterRow.sourceAttributeFieldMapJson, { desired_coverage: "old_field" });
    assert.deepEqual(afterRow.sa360CustomFieldIdMapJson, {});
    assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: world.clientAccountId } }), 0);
    assert.equal(await prisma.campaignRoutingRule.count({ where: { clientAccountId: world.clientAccountId } }), 0);
  });

  test("a live destination is read-only and a live change during the save rolls back", async () => {
    const world = await createWorld();
    await createDestination(world, { live: true });
    const beforeRow = await destinationRow(world.clientAccountId);
    const refused = await post(world, undefined, { expectedDestinationUpdatedAt: beforeRow.updatedAt });
    assert.equal(refused.statusCode, 409);
    assert.equal(refused.json().error, "live_destination");
    assert.equal(refused.json().destinationUpdated, false);
    assert.equal(refused.json().deliveryArmed, false);
    assert.equal(await requestCount(world.clientAccountId), 0);
    assert.equal((await destinationRow(world.clientAccountId)).updatedAt, beforeRow.updatedAt);

    const shadow = await createWorld();
    await createDestination(shadow, { workflowId: "wf_shadow" });
    const shadowBefore = await destinationRow(shadow.clientAccountId);
    const raced = await recordGhlDestinationConfigRequest(
      prisma,
      command(shadow, { expectedDestinationUpdatedAt: shadowBefore.updatedAt }),
      process.env,
      {
        afterDestinationLock: async (tx, clientAccountId) => {
          await tx.clientGhlDestination.update({
            where: { clientAccountId },
            data: {
              deliveryEnabled: true,
              deliveryMode: "live",
              clientCutoverApproved: true,
              internalApprovalStatus: "approved",
            },
          });
        },
      }
    );
    assert.equal(raced.ok, false);
    if (!raced.ok) assert.equal(raced.error, "live_destination");
    const shadowAfter = await destinationRow(shadow.clientAccountId);
    assert.equal(shadowAfter.deliveryEnabled, false);
    assert.equal(shadowAfter.deliveryMode, "shadow");
    assert.equal(shadowAfter.clientCutoverApproved, false);
    assert.equal(shadowAfter.internalApprovalStatus, "not_reviewed");
    assert.equal(shadowAfter.destinationWorkflowIdGhl, "wf_shadow");
    assert.equal(shadowAfter.updatedAt, shadowBefore.updatedAt);
    assert.equal(await requestCount(shadow.clientAccountId), 0);
    assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: shadow.clientAccountId } }), 0);
  });

  test("location, workflow, field, snapshot, and stale tokens are rejected without a write", async () => {
    const world = await createWorld();
    await createDestination(world, { workflowId: "wf_keep" });
    const beforeRow = await destinationRow(world.clientAccountId);
    const unlinked = await createWorld({ connection: false });
    const unlinkedResult = await post(unlinked);
    assert.equal(unlinkedResult.statusCode, 409);
    assert.equal(unlinkedResult.json().error, "location_not_linked");

    const other = await createWorld();
    await prisma.ghlLocationConnection.update({
      where: { locationId: world.locationId },
      data: { clientAccountId: other.clientAccountId },
    });
    const foreign = await post(world, undefined, { expectedDestinationUpdatedAt: beforeRow.updatedAt });
    assert.equal(foreign.statusCode, 409);
    assert.equal(foreign.json().error, "location_not_linked");
    await prisma.ghlLocationConnection.update({
      where: { locationId: world.locationId },
      data: { clientAccountId: world.clientAccountId, connectionStatus: "revoked" },
    });
    const revoked = await post(world, undefined, { expectedDestinationUpdatedAt: beforeRow.updatedAt });
    assert.equal(revoked.statusCode, 409);
    assert.equal(revoked.json().error, "location_not_linked");
    await prisma.ghlLocationConnection.update({
      where: { locationId: world.locationId },
      data: { connectionStatus: "connected" },
    });

    const named = await post(world, undefined, {
      expectedDestinationUpdatedAt: beforeRow.updatedAt,
      workflowId: "Published LAL AI BOT-1 VET Webform workflow #8",
    });
    assert.equal(named.statusCode, 409);
    assert.equal(named.json().error, "workflow_not_in_snapshot");

    const byKey = await post(world, undefined, {
      expectedDestinationUpdatedAt: beforeRow.updatedAt,
      fieldMappings: [{ key: "desired_coverage", fieldId: "contact.desired_coverage" }],
    });
    assert.equal(byKey.statusCode, 409);
    assert.equal(byKey.json().error, "field_id_unverified");
    assert.equal(JSON.stringify(byKey.json()).includes("field_coverage"), false);

    const byName = await post(world, undefined, {
      expectedDestinationUpdatedAt: beforeRow.updatedAt,
      fieldMappings: [{ key: "branch_of_service", fieldId: "Branch of Service" }],
    });
    assert.equal(byName.statusCode, 409);
    assert.equal(byName.json().error, "field_id_unverified");

    const duplicate = await post(world, undefined, {
      expectedDestinationUpdatedAt: beforeRow.updatedAt,
      fieldMappings: [
        { key: "branch_of_service", fieldId: "field_shared" },
        { key: "primary_reason", fieldId: "field_shared" },
      ],
    });
    assert.equal(duplicate.statusCode, 409);
    assert.equal(duplicate.json().error, "duplicate_field_mapping");

    const unknown = await post(world, undefined, {
      expectedDestinationUpdatedAt: beforeRow.updatedAt,
      fieldMappings: [{ key: "vet", fieldId: "field_coverage" }],
    });
    assert.equal(unknown.statusCode, 400);
    assert.equal(unknown.json().error, "invalid_field_key");

    const missingSnapshot = await createWorld({ snapshot: false });
    const missing = await post(missingSnapshot);
    assert.equal(missing.statusCode, 409);
    assert.equal(missing.json().error, "snapshot_missing");

    const expiredWorld = await createWorld({ fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
    const expired = await post(expiredWorld);
    assert.equal(expired.statusCode, 409);
    assert.equal(expired.json().error, "snapshot_expired");

    const stale = await post(world, undefined, {
      expectedDestinationUpdatedAt: new Date(Date.parse(beforeRow.updatedAt) - 1000).toISOString(),
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, "destination_stale");

    const wrongRevision = await post(world, undefined, {
      expectedDestinationUpdatedAt: beforeRow.updatedAt,
      expectedRevision: 4,
    });
    assert.equal(wrongRevision.statusCode, 409);
    assert.equal(wrongRevision.json().error, "revision_conflict");

    assert.equal((await destinationRow(world.clientAccountId)).destinationWorkflowIdGhl, "wf_keep");
    assert.equal((await destinationRow(world.clientAccountId)).updatedAt, beforeRow.updatedAt);
    assert.equal(await requestCount(world.clientAccountId), 0);
    assert.equal(await requestCount(unlinked.clientAccountId), 0);
    assert.equal(await requestCount(expiredWorld.clientAccountId), 0);
  });

  test("the same request replays and a changed retry does not replace the stored row", async () => {
    const world = await createWorld();
    const first = await post(world);
    assert.equal(first.statusCode, 200);
    const requestId = first.json().requestId as string;
    const second = await post(world, undefined, { requestId, expectedRevision: 0 });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().replayed, true);
    assert.equal(second.json().revision, 1);
    assert.equal(await requestCount(world.clientAccountId), 1);

    const changed = await post(world, undefined, {
      requestId,
      expectedRevision: 0,
      workflowId: "wf_other",
    });
    assert.equal(changed.statusCode, 409);
    assert.equal(changed.json().error, "request_id_reused");
    assert.equal(await requestCount(world.clientAccountId), 1);
    const stored = await prisma.ghlDestinationConfigurationRequest.findFirstOrThrow({
      where: { clientAccountId: world.clientAccountId },
    });
    assert.equal(stored.workflowId, "wf_exact");
    assert.equal(stored.status, "stored");

    const next = await post(world, undefined, { expectedRevision: 1 });
    assert.equal(next.statusCode, 200);
    assert.equal(await requestCount(world.clientAccountId), 2);
    const head = await prisma.ghlDestinationConfigurationRequest.findFirstOrThrow({
      where: { clientAccountId: world.clientAccountId, status: "stored" },
    });
    assert.equal(head.requestId, next.json().requestId);
    assert.equal(await prisma.clientGhlDestination.count({ where: { clientAccountId: world.clientAccountId } }), 0);
  });
});

type World = {
  clientAccountId: string;
  locationId: string;
};

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-sa360-admin-key": ADMIN_KEY, ...extra };
}

function url(clientAccountId: string): string {
  return `/admin/v1/clients/${clientAccountId}/ghl-destination-configuration`;
}

function surveyMappings(): Array<{ key: string; fieldId: string }> {
  return [
    { key: "branch_of_service", fieldId: "field_branch" },
    { key: "desired_coverage", fieldId: "field_coverage" },
    { key: "primary_reason", fieldId: "field_reason" },
  ];
}

function body(world: World, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: randomUUID(),
    expectedRevision: 0,
    expectedDestinationUpdatedAt: null,
    locationId: world.locationId,
    workflowId: "wf_exact",
    fieldMappings: surveyMappings(),
    ...overrides,
  };
}

function command(world: World, overrides: Record<string, unknown> = {}) {
  const payload = body(world, overrides);
  return {
    clientAccountId: world.clientAccountId,
    requestId: String(payload.requestId),
    expectedRevision: Number(payload.expectedRevision),
    expectedDestinationUpdatedAt: payload.expectedDestinationUpdatedAt as string | null,
    locationId: String(payload.locationId),
    workflowId: String(payload.workflowId),
    fieldMappings: payload.fieldMappings as Array<{ key: string; fieldId: string }>,
  };
}

async function post(
  world: World,
  headers?: Record<string, string>,
  overrides?: Record<string, unknown>
) {
  return app.inject({
    method: "POST",
    url: url(world.clientAccountId),
    headers: headers ?? adminHeaders(),
    payload: body(world, overrides),
  });
}

async function createWorld(options: { connection?: boolean; snapshot?: boolean; fetchedAt?: Date } = {}): Promise<World> {
  seq += 1;
  const clientAccountId = `gcr${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const locationId = `loc${seq}${Date.now().toString(36)}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "GHL config request",
      status: "onboarding",
      portalLoginEmail: `${clientAccountId}@portal.example`,
    },
  });
  clientIds.push(clientAccountId);
  locationIds.push(locationId);
  if (options.connection !== false) {
    await prisma.ghlLocationConnection.create({
      data: {
        clientAccountId,
        locationId,
        locationName: "Configured location",
        accessTokenEncrypted: "test-access",
        refreshTokenEncrypted: "test-refresh",
        tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        connectionStatus: "connected",
      },
    });
  }
  if (options.snapshot !== false) {
    await prisma.ghlLocationConfigSnapshot.create({
      data: {
        locationId,
        clientAccountId,
        fetchedAt: options.fetchedAt ?? new Date(),
        workflowsJson: [
          { id: "wf_exact", name: "Published LAL AI BOT-1 VET Webform workflow #8", status: "published" },
          { id: "wf_other", name: "Another Webform", status: "published" },
        ],
        customFieldsJson: [
          { id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" },
          { id: "field_branch", name: "Branch of Service", fieldKey: "contact.branch_of_service" },
          { id: "field_reason", name: "Primary Reason", fieldKey: "contact.primary_reason" },
          { id: "field_shared", name: "Shared", fieldKey: "contact.shared" },
        ],
      },
    });
  }
  return { clientAccountId, locationId };
}

async function createDestination(
  world: World,
  options: { live?: boolean; workflowId?: string } = {}
): Promise<void> {
  await prisma.clientGhlDestination.create({
    data: {
      clientAccountId: world.clientAccountId,
      destinationSubaccountIdGhl: world.locationId,
      locationName: "Saved location",
      destinationWorkflowIdGhl: options.workflowId ?? "wf_old",
      workflowTriggerMode: "tag_trigger",
      sourceAttributeFieldMapJson: { desired_coverage: "old_field" },
      sa360CustomFieldIdMapJson: {},
      deliveryMode: options.live ? "live" : "shadow",
      deliveryEnabled: options.live === true,
      clientCutoverApproved: options.live === true,
      internalApprovalStatus: options.live ? "approved" : "not_reviewed",
    },
  });
}

async function destinationRow(clientAccountId: string) {
  const row = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } });
  return {
    destinationWorkflowIdGhl: row.destinationWorkflowIdGhl,
    destinationSubaccountIdGhl: row.destinationSubaccountIdGhl,
    deliveryEnabled: row.deliveryEnabled,
    deliveryMode: row.deliveryMode,
    clientCutoverApproved: row.clientCutoverApproved,
    internalApprovalStatus: row.internalApprovalStatus,
    sourceAttributeFieldMapJson: row.sourceAttributeFieldMapJson,
    sa360CustomFieldIdMapJson: row.sa360CustomFieldIdMapJson,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function requestCount(clientAccountId: string): Promise<number> {
  return prisma.ghlDestinationConfigurationRequest.count({ where: { clientAccountId } });
}

async function operationalSnapshot(world: World): Promise<string> {
  const [runs, rules, destination] = await Promise.all([
    prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: world.clientAccountId } }),
    prisma.campaignRoutingRule.count({ where: { clientAccountId: world.clientAccountId } }),
    prisma.clientGhlDestination.findUnique({ where: { clientAccountId: world.clientAccountId } }),
  ]);
  return JSON.stringify({ runs, rules, destination: destination?.id ?? null });
}

async function operationalChanges(world: World): Promise<boolean> {
  const snapshot = JSON.parse(await operationalSnapshot(world)) as {
    runs: number;
    rules: number;
    destination: string | null;
  };
  return snapshot.runs !== 0 || snapshot.rules !== 0 || snapshot.destination !== null;
}
