import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import Fastify from "fastify";

import { prisma } from "../../lib/db.js";
import { isUsableGhlLocationConfigSnapshot } from "../../lib/ghl-config-snapshot-validity.js";
import { recordGhlDestinationConfigRequest } from "../ghl-destination-config-request.js";
import { adminGhlConfigRoutes } from "../../routes/admin-ghl-config.js";
import { discoverGhlLocationConfig } from "./ghl-config-discovery.service.js";

const TOKEN = "phase2n-discovery-test-token";
const SECRET_BODY = "super-secret-access-token-value";
const savedToken = process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
const savedAdmin = process.env.ADMIN_API_KEY;

const clientIds: string[] = [];
const locationIds: string[] = [];
let seq = 0;

before(() => {
  process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN = TOKEN;
  process.env.ADMIN_API_KEY ??= "snapshot-refresh-test-admin";
});

after(async () => {
  if (savedToken === undefined) delete process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  else process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN = savedToken;
  if (savedAdmin === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = savedAdmin;
  if (locationIds.length > 0) {
    await prisma.ghlDestinationConfigurationRequest.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.ghlLocationConfigSnapshot.deleteMany({ where: { locationId: { in: locationIds } } });
    await prisma.ghlLocationConnection.deleteMany({ where: { locationId: { in: locationIds } } });
  }
  if (clientIds.length > 0) {
    await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    await prisma.campaignRoutingRule.deleteMany({ where: { clientAccountId: { in: clientIds } } });
    await prisma.ghlLiveDeliveryRun.deleteMany({ where: { destinationClientAccountId: { in: clientIds } } });
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } });
  }
});

test("Invalid JWT refresh keeps the usable snapshot and Load recovers it", async () => {
  const world = await seedLocation();
  const calls: Call[] = [];
  const good = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId), calls),
  });
  assert.equal(good.ok, true);
  if (good.ok) {
    assert.equal(good.discovery.snapshotVerification, "live");
    assert.equal(good.discovery.workflows[0]?.id, "wf_keep");
  }

  const failed = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(failHandlers(401, { message: "Invalid JWT", access_token: SECRET_BODY }), calls),
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.code, "RECONNECT_REQUIRED");
    assert.match(failed.error, /Invalid JWT/);
    assert.match(failed.error, /Reconnect the location/);
    assert.match(failed.error, /not current verification/);
    assert.equal(failed.preservedSnapshot?.workflows[0]?.id, "wf_keep");
    assert.equal(failed.preservedSnapshot?.snapshotVerification, "previously_captured");
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(TOKEN));
    assert.doesNotMatch(JSON.stringify(failed), new RegExp(SECRET_BODY));
  }

  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: mockFetch(failHandlers(401, { message: "Invalid JWT" }), calls),
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.discovery.workflows[0]?.id, "wf_keep");
    assert.equal(loaded.discovery.snapshotVerification, "previously_captured");
    assert.match(loaded.discovery.errors.join(" "), /not current GoHighLevel verification/);
    assert.equal(loaded.discovery.location.id, world.locationId);
  }
  const rows = await snapshots(world.locationId);
  assert.equal(rows.length, 2);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[0]!), false);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[1]!), true);
  assert.equal(workflowIds(rows[1]?.workflowsJson).has("wf_keep"), true);
  assert.equal(calls.every((call) => call.method === "GET"), true);
  assert.equal(await operationalCount(world.clientAccountId), 0);

  const request = await recordGhlDestinationConfigRequest(
    prisma,
    command(world, "wf_keep"),
    { SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "true" }
  );
  assert.equal(request.ok, false);
  if (!request.ok) assert.equal(request.error, "snapshot_not_current");
  assert.equal(await prisma.ghlDestinationConfigurationRequest.count({ where: { clientAccountId: world.clientAccountId } }), 0);
  assert.equal(await operationalCount(world.clientAccountId), 0);
});

test("a workflow endpoint failure does not replace the usable workflows", async () => {
  const world = await seedLocation();
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId), []),
  });
  const calls: Call[] = [];
  const failed = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(
      {
        ...successHandlers(world.locationId),
        workflows: () => jsonResponse(500, { message: "upstream unavailable" }),
      },
      calls
    ),
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.code, "PARTIAL_FAILURE");
    assert.equal(failed.preservedSnapshot?.workflows[0]?.id, "wf_keep");
    assert.equal(failed.preservedSnapshot?.snapshotVerification, "previously_captured");
  }
  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) assert.equal(loaded.discovery.workflows[0]?.id, "wf_keep");
  const rows = await snapshots(world.locationId);
  assert.equal(workflowIds(rows[0]?.workflowsJson).size, 0);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[0]!), false);
  assert.match(JSON.stringify(rows[0]?.errorsJson), /workflows:/);
  assert.equal(calls.every((call) => call.method === "GET"), true);
});

test("a network timeout keeps the previous usable snapshot", async () => {
  const world = await seedLocation();
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId), []),
  });
  const failed = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(failHandlers(0, null, () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    }), []),
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.code, "TIMEOUT");
    assert.match(failed.error, /timed out/);
    assert.equal(failed.preservedSnapshot?.snapshotVerification, "previously_captured");
    assert.equal(failed.preservedSnapshot?.workflows[0]?.id, "wf_keep");
  }
  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.discovery.workflows[0]?.id, "wf_keep");
    assert.match(loaded.discovery.errors.join(" "), /previously captured/);
  }
});

test("a failed refresh with no earlier usable snapshot is not returned as empty success", async () => {
  const world = await seedLocation();
  const failed = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(failHandlers(401, { message: "Invalid JWT" }), []),
  });
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.code, "RECONNECT_REQUIRED");
    assert.equal(failed.preservedSnapshot, null);
    assert.match(failed.error, /No usable snapshot was stored/);
  }
  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loaded.ok, false);
  if (!loaded.ok) assert.equal(loaded.code, "NO_USABLE_SNAPSHOT");
  const rows = await snapshots(world.locationId);
  assert.equal(rows.length, 1);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[0]!), false);
});

test("an older usable snapshot is recovered when the newest snapshot is bad", async () => {
  const world = await seedLocation();
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId, [{ id: "wf_old", name: "Older", status: "published" }]), []),
  });
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId, [{ id: "wf_keep", name: "Keep Me", status: "published" }]), []),
  });
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(failHandlers(401, { message: "Invalid JWT" }), []),
  });
  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.discovery.workflows[0]?.id, "wf_keep");
    assert.equal(loaded.discovery.snapshotVerification, "previously_captured");
  }
  const rows = await snapshots(world.locationId);
  assert.equal(rows.length, 3);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[0]!), false);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[1]!), true);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[2]!), true);
});

test("a complete refresh replaces the usable snapshot with the new discovery", async () => {
  const world = await seedLocation();
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId), []),
  });
  const refreshed = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId, [{ id: "wf_new", name: "New", status: "published" }]), []),
  });
  assert.equal(refreshed.ok, true);
  if (refreshed.ok) {
    assert.equal(refreshed.discovery.snapshotVerification, "live");
    assert.equal(refreshed.discovery.fromCache, false);
    assert.equal(refreshed.discovery.workflows[0]?.id, "wf_new");
    assert.deepEqual(refreshed.discovery.errors, []);
  }
  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.discovery.workflows[0]?.id, "wf_new");
    assert.equal(loaded.discovery.snapshotVerification, "cached");
  }
  const rows = await snapshots(world.locationId);
  assert.equal(rows.length, 2);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[0]!), true);
  assert.equal(workflowIds(rows[1]?.workflowsJson).has("wf_keep"), true);

  const request = await recordGhlDestinationConfigRequest(
    prisma,
    command(world, "wf_new"),
    { SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "true" }
  );
  assert.equal(request.ok, true);
  assert.equal(await operationalCount(world.clientAccountId), 0);
});

test("an authenticated empty workflow list is a successful discovery", async () => {
  const world = await seedLocation();
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId), []),
  });
  const empty = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId, []), []),
  });
  assert.equal(empty.ok, true);
  if (empty.ok) {
    assert.equal(empty.discovery.snapshotVerification, "live");
    assert.deepEqual(empty.discovery.workflows, []);
    assert.deepEqual(empty.discovery.errors, []);
  }
  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.deepEqual(loaded.discovery.workflows, []);
    assert.equal(loaded.discovery.snapshotVerification, "cached");
  }
  const rows = await snapshots(world.locationId);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[0]!), true);
  assert.equal(workflowIds(rows[1]?.workflowsJson).has("wf_keep"), true);
  const request = await recordGhlDestinationConfigRequest(
    prisma,
    command(world, "wf_keep"),
    { SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "true" }
  );
  assert.equal(request.ok, false);
  if (!request.ok) assert.equal(request.error, "workflow_not_in_snapshot");
});

test("a malformed HTTP 200 does not replace a usable snapshot", async () => {
  const world = await seedLocation();
  const calls: Call[] = [];
  await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(world.locationId), calls),
  });
  const malformed: Array<{ label: string; handlers: Partial<Handlers> }> = [
    { label: "empty location", handlers: { location: () => jsonResponse(200, {}) } },
    { label: "malformed location wrapper", handlers: { location: () => jsonResponse(200, { location: {} }) } },
    { label: "location id mismatch", handlers: { location: () => jsonResponse(200, { id: "other-location", name: "Other" }) } },
    { label: "workflow pipelines collection", handlers: { workflows: () => jsonResponse(200, { pipelines: [] }) } },
    { label: "workflow error object", handlers: { workflows: () => jsonResponse(200, { message: "could not read workflows" }) } },
  ];
  for (const item of malformed) {
    const failed = await discoverGhlLocationConfig({
      locationId: world.locationId,
      refresh: true,
      fetchImpl: mockFetch({ ...successHandlers(world.locationId), ...item.handlers }, calls),
    });
    assert.equal(failed.ok, false, item.label);
    if (!failed.ok) {
      assert.equal(failed.code, "PARTIAL_FAILURE", item.label);
      assert.equal(failed.preservedSnapshot?.workflows[0]?.id, "wf_keep", item.label);
      assert.equal(failed.preservedSnapshot?.snapshotVerification, "previously_captured", item.label);
    }
  }
  const rows = await snapshots(world.locationId);
  assert.equal(rows.length, 1 + malformed.length);
  assert.equal(isUsableGhlLocationConfigSnapshot(rows[0]!), false);
  assert.equal(workflowIds(rows.at(-1)?.workflowsJson).has("wf_keep"), true);
  const loaded = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loaded.ok, true);
  if (loaded.ok) {
    assert.equal(loaded.discovery.workflows[0]?.id, "wf_keep");
    assert.equal(loaded.discovery.snapshotVerification, "previously_captured");
  }
  const request = await recordGhlDestinationConfigRequest(
    prisma,
    command(world, "wf_keep"),
    { SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "true" }
  );
  assert.equal(request.ok, false);
  if (!request.ok) assert.equal(request.error, "snapshot_not_current");
  assert.equal(await prisma.ghlDestinationConfigurationRequest.count({ where: { clientAccountId: world.clientAccountId } }), 0);
  assert.equal(await operationalCount(world.clientAccountId), 0);
  assert.equal(calls.every((call) => call.method === "GET"), true);
});

test("wrapped locations and data envelopes are successful discoveries", async () => {
  const world = await seedLocation();
  const calls: Call[] = [];
  const fields = [
    { id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" },
    { id: "field_branch", name: "Branch of Service", fieldKey: "contact.branch_of_service" },
    { id: "field_reason", name: "Primary Reason", fieldKey: "contact.primary_reason" },
  ];
  const discovered = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(
      {
        location: () => jsonResponse(200, { location: { id: world.locationId, name: "Wrapped", companyId: "co" } }),
        pipelines: () => jsonResponse(200, { data: [{ id: "pipe_data", name: "Data pipe", stages: [] }] }),
        workflows: () => jsonResponse(200, { data: [{ id: "wf_data", name: "From data", status: "published" }] }),
        users: () => jsonResponse(200, { items: [] }),
        customFields: () => jsonResponse(200, { data: fields }),
        tags: () => jsonResponse(200, { results: [] }),
      },
      calls
    ),
  });
  assert.equal(discovered.ok, true);
  if (discovered.ok) {
    assert.equal(discovered.discovery.snapshotVerification, "live");
    assert.equal(discovered.discovery.location.id, world.locationId);
    assert.equal(discovered.discovery.location.name, "Wrapped");
    assert.equal(discovered.discovery.workflows[0]?.id, "wf_data");
    assert.equal(discovered.discovery.pipelines[0]?.id, "pipe_data");
    assert.deepEqual(discovered.discovery.errors, []);
  }

  const empty = await discoverGhlLocationConfig({
    locationId: world.locationId,
    refresh: true,
    fetchImpl: mockFetch(
      {
        ...successHandlers(world.locationId, []),
        workflows: () => jsonResponse(200, { data: [] }),
      },
      calls
    ),
  });
  assert.equal(empty.ok, true);
  if (empty.ok) {
    assert.deepEqual(empty.discovery.workflows, []);
    assert.equal(empty.discovery.snapshotVerification, "live");
    assert.equal(empty.discovery.location.id, world.locationId);
  }
  const rejected = await recordGhlDestinationConfigRequest(
    prisma,
    command(world, "wf_data"),
    { SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "true" }
  );
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error, "workflow_not_in_snapshot");
  assert.equal(await operationalCount(world.clientAccountId), 0);
  assert.equal(calls.every((call) => call.method === "GET"), true);
});

test("a snapshot from another location is not reused", async () => {
  const first = await seedLocation();
  const second = await seedLocation();
  await discoverGhlLocationConfig({
    locationId: first.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(first.locationId, [{ id: "wf_a", name: "A", status: "published" }]), []),
  });
  await discoverGhlLocationConfig({
    locationId: second.locationId,
    refresh: true,
    fetchImpl: mockFetch(successHandlers(second.locationId, [{ id: "wf_b", name: "B", status: "published" }]), []),
  });
  await discoverGhlLocationConfig({
    locationId: second.locationId,
    refresh: true,
    fetchImpl: mockFetch(failHandlers(401, { message: "Invalid JWT" }), []),
  });
  const loadedFirst = await discoverGhlLocationConfig({
    locationId: first.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  const loadedSecond = await discoverGhlLocationConfig({
    locationId: second.locationId,
    refresh: false,
    fetchImpl: offlineFetch(),
  });
  assert.equal(loadedFirst.ok, true);
  assert.equal(loadedSecond.ok, true);
  if (loadedFirst.ok && loadedSecond.ok) {
    assert.equal(loadedFirst.discovery.workflows[0]?.id, "wf_a");
    assert.equal(loadedFirst.discovery.snapshotVerification, "cached");
    assert.equal(loadedSecond.discovery.workflows[0]?.id, "wf_b");
    assert.equal(loadedSecond.discovery.snapshotVerification, "previously_captured");
    assert.equal(loadedFirst.discovery.location.id, first.locationId);
    assert.equal(loadedSecond.discovery.location.id, second.locationId);
  }
  const foreign = await recordGhlDestinationConfigRequest(
    prisma,
    { ...command(second, "wf_a"), locationId: first.locationId },
    { SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED: "true" }
  );
  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.error, "location_not_linked");
});

test("the config route reports Invalid JWT and the following load returns the kept workflows", async () => {
  const world = await seedLocation();
  const app = Fastify({ logger: false });
  await app.register(adminGhlConfigRoutes, { prefix: "/admin/v1" });
  const originalFetch = globalThis.fetch;
  const calls: Call[] = [];
  let mode: "good" | "bad" = "good";
  globalThis.fetch = mockFetch({}, calls, () =>
    mode === "good" ? successHandlers(world.locationId) : failHandlers(401, { message: "Invalid JWT", refresh_token: SECRET_BODY })
  ) as typeof fetch;
  try {
    const seeded = await app.inject({
      method: "GET",
      url: `/admin/v1/ghl/locations/${world.locationId}/config?refresh=true`,
      headers: { "x-sa360-admin-key": process.env.ADMIN_API_KEY ?? "" },
    });
    assert.equal(seeded.statusCode, 200);
    assert.equal(seeded.json().workflows[0].id, "wf_keep");
    mode = "bad";
    const failed = await app.inject({
      method: "GET",
      url: `/admin/v1/ghl/locations/${world.locationId}/config?refresh=true`,
      headers: { "x-sa360-admin-key": process.env.ADMIN_API_KEY ?? "" },
    });
    assert.equal(failed.statusCode, 409);
    assert.equal(failed.json().code, "RECONNECT_REQUIRED");
    assert.match(failed.json().error, /Invalid JWT/);
    assert.doesNotMatch(failed.body, new RegExp(SECRET_BODY));
    const loaded = await app.inject({
      method: "GET",
      url: `/admin/v1/ghl/locations/${world.locationId}/config`,
      headers: { "x-sa360-admin-key": process.env.ADMIN_API_KEY ?? "" },
    });
    assert.equal(loaded.statusCode, 200);
    assert.equal(loaded.json().workflows[0].id, "wf_keep");
    assert.equal(loaded.json().snapshotVerification, "previously_captured");
    assert.equal(calls.every((call) => call.method === "GET"), true);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

type Call = { method: string; url: string };
type World = { clientAccountId: string; locationId: string };
type Handler = () => Response | Promise<Response>;
type Handlers = {
  location: Handler;
  pipelines: Handler;
  workflows: Handler;
  users: Handler;
  customFields: Handler;
  tags: Handler;
};

async function seedLocation(): Promise<World> {
  seq += 1;
  const clientAccountId = `snap${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  const locationId = `locsnap${seq}${Date.now().toString(36)}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Snapshot refresh",
      status: "onboarding",
      portalLoginEmail: `${clientAccountId}@portal.example`,
    },
  });
  clientIds.push(clientAccountId);
  locationIds.push(locationId);
  await prisma.ghlLocationConnection.create({
    data: {
      clientAccountId,
      locationId,
      locationName: "Snapshot location",
      accessTokenEncrypted: "not-a-real-cipher",
      refreshTokenEncrypted: "not-a-real-cipher",
      tokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      connectionStatus: "connected",
    },
  });
  return { clientAccountId, locationId };
}

function command(world: World, workflowId: string) {
  return {
    clientAccountId: world.clientAccountId,
    requestId: randomUUID(),
    expectedRevision: 0,
    expectedDestinationUpdatedAt: null,
    locationId: world.locationId,
    workflowId,
    fieldMappings: [
      { key: "desired_coverage", fieldId: "field_coverage" },
      { key: "branch_of_service", fieldId: "field_branch" },
      { key: "primary_reason", fieldId: "field_reason" },
    ],
  };
}

async function snapshots(locationId: string) {
  return prisma.ghlLocationConfigSnapshot.findMany({
    where: { locationId },
    orderBy: [{ fetchedAt: "desc" }, { id: "desc" }],
  });
}

function workflowIds(json: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(json)) return ids;
  for (const item of json) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) ids.add(id.trim());
  }
  return ids;
}

async function operationalCount(clientAccountId: string): Promise<number> {
  const [destinations, rules, runs] = await Promise.all([
    prisma.clientGhlDestination.count({ where: { clientAccountId } }),
    prisma.campaignRoutingRule.count({ where: { clientAccountId } }),
    prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } }),
  ]);
  return destinations + rules + runs;
}

function offlineFetch(): typeof fetch {
  return (async () => {
    throw new Error("load must not call GoHighLevel");
  }) as typeof fetch;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function successHandlers(locationId: string, workflows: unknown[] = [{ id: "wf_keep", name: "Keep Me", status: "published" }]): Handlers {
  return {
    location: () => jsonResponse(200, { id: locationId, name: "Acme", companyId: "co", timezone: "America/New_York" }),
    pipelines: () => jsonResponse(200, { pipelines: [{ id: "pipe_1", name: "Sales", stages: [] }] }),
    workflows: () => jsonResponse(200, { workflows }),
    users: () => jsonResponse(200, { users: [] }),
    customFields: () =>
      jsonResponse(200, {
        customFields: [
          { id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" },
          { id: "field_branch", name: "Branch of Service", fieldKey: "contact.branch_of_service" },
          { id: "field_reason", name: "Primary Reason", fieldKey: "contact.primary_reason" },
        ],
      }),
    tags: () => jsonResponse(200, { tags: [] }),
  };
}

function failHandlers(status: number, body: unknown, factory?: Handler): Handlers {
  const respond: Handler = factory ?? (() => jsonResponse(status, body));
  return {
    location: respond,
    pipelines: respond,
    workflows: respond,
    users: respond,
    customFields: respond,
    tags: respond,
  };
}

function mockFetch(handlers: Partial<Handlers>, calls: Call[], resolve?: () => Partial<Handlers>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const url = String(input);
    calls.push({ method, url });
    if (method !== "GET") throw new Error(`unexpected GHL write ${method} ${url}`);
    const selected = { ...handlers, ...(resolve ? resolve() : {}) };
    if (url.includes("/customFields")) return selected.customFields!();
    if (url.includes("/tags")) return selected.tags!();
    if (url.includes("/workflows")) return selected.workflows!();
    if (url.includes("/users")) return selected.users!();
    if (url.includes("/pipelines")) return selected.pipelines!();
    if (url.includes("/locations/")) return selected.location!();
    throw new Error(`unexpected GHL url ${url}`);
  }) as typeof fetch;
}
