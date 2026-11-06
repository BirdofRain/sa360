import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Fastify from "fastify";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { adminTeamWorkspaceRoutes } from "./admin-team-workspace.js";
import { isTeamWorkspaceApiEnabled } from "../services/team-workspace/team-workspace-read.js";

const CLIENT = "alex_gross";
const ADMIN_KEY = "team-workspace-test-key";
const LOCATION = "loc_should_not_leak";
const PHONE = "+15551212";
const EMAIL = "person@example.test";
const SECRET_URL = "https://user:token_secret@hooks.example.test/lead?sig=abcdef";
const SIGNING_SECRET = "super-secret-value";

type Call = { op: string };

function clientRow() {
  return {
    clientAccountId: CLIENT,
    clientDisplayName: "Alex Gross",
    status: "onboarding",
    onboardingSetup: {
      status: "draft",
      revision: 1,
      setupDataJson: {
        destinationChoice: "both",
        clientPhone: PHONE,
        clientEmail: EMAIL,
        existingSpreadsheetUrl: SECRET_URL,
        ghlLocationId: LOCATION,
      },
    },
    ghlDestination: {
      deliveryEnabled: false,
      deliveryMode: "shadow",
      destinationSubaccountIdGhl: LOCATION,
    },
    companySheetsDestination: {
      campaignDispatchEnabled: false,
      campaignDispatchNotBefore: new Date("2026-11-01T15:00:00.000Z"),
      agedDispatchEnabled: false,
    },
    deliveryTargets: [
      {
        enabled: false,
        configMetadataJson: {
          endpointUrl: SECRET_URL,
          signingSecret: SIGNING_SECRET,
        },
      },
    ],
  };
}

function createDb(client: object | null = clientRow()) {
  const calls: Call[] = [];
  const db = {
    clientAccount: {
      findUnique: async (args: { where: { clientAccountId: string } }) => {
        calls.push({ op: "findUnique" });
        if (!client) return null;
        const row = client as { clientAccountId: string };
        if (args.where.clientAccountId !== row.clientAccountId) return null;
        return client;
      },
      update: async () => {
        calls.push({ op: "update" });
        throw new Error("unexpected write");
      },
      create: async () => {
        calls.push({ op: "create" });
        throw new Error("unexpected write");
      },
      delete: async () => {
        calls.push({ op: "delete" });
        throw new Error("unexpected write");
      },
    },
  };
  return { db, calls };
}

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ADMIN_API_KEY: ADMIN_KEY,
    SA360_TEAM_WORKSPACE_ENABLED: "true",
    ...overrides,
  };
}

async function buildApp(options: { client?: object | null; env?: NodeJS.ProcessEnv } = {}) {
  const { db, calls } = createDb(options.client);
  const app = Fastify();
  await app.register(adminTeamWorkspaceRoutes, {
    prefix: "/admin/v1",
    db: db as never,
    env: options.env ?? env(),
  });
  return { app, calls };
}

const previousAdminKey = process.env.ADMIN_API_KEY;
const previousAdminAlias = process.env.SA360_ADMIN_KEY;

test.before(() => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  delete process.env.SA360_ADMIN_KEY;
});

test.after(() => {
  if (previousAdminKey === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = previousAdminKey;
  if (previousAdminAlias === undefined) delete process.env.SA360_ADMIN_KEY;
  else process.env.SA360_ADMIN_KEY = previousAdminAlias;
});

test("team workspace flag accepts only exact true", () => {
  assert.equal(isTeamWorkspaceApiEnabled({ SA360_TEAM_WORKSPACE_ENABLED: "true" }), true);
  assert.equal(isTeamWorkspaceApiEnabled({ SA360_TEAM_WORKSPACE_ENABLED: " true " }), true);
  for (const value of [undefined, "", "TRUE", "True", "1", "yes", "on", "false"]) {
    assert.equal(isTeamWorkspaceApiEnabled({ SA360_TEAM_WORKSPACE_ENABLED: value }), false, String(value));
  }
});

test("flag off returns team_workspace_disabled and does not read the client", async () => {
  const { app, calls } = await buildApp({
    env: env({ SA360_TEAM_WORKSPACE_ENABLED: undefined }),
  });
  const response = await app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { ok: false, error: "team_workspace_disabled" });
  assert.deepEqual(calls, []);
  await app.close();
});

test("loose flag values stay off", async () => {
  for (const value of ["TRUE", "1", "yes", "on"]) {
    const { app, calls } = await buildApp({
      env: env({ SA360_TEAM_WORKSPACE_ENABLED: value }),
    });
    const response = await app.inject({
      method: "GET",
      url: `/admin/v1/team-workspace/clients/${CLIENT}`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(response.statusCode, 404, value);
    assert.equal(response.json().error, "team_workspace_disabled");
    assert.deepEqual(calls, []);
    await app.close();
  }
});

test("missing and wrong admin keys do not read the client", async () => {
  const { app, calls } = await buildApp();
  const missing = await app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
  });
  assert.equal(missing.statusCode, 401);
  const wrong = await app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": "nope" },
  });
  assert.equal(wrong.statusCode, 401);
  assert.deepEqual(calls, []);
  await app.close();
});

test("an unconfigured admin key returns 503", async () => {
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  const { app, calls } = await buildApp({
    env: { SA360_TEAM_WORKSPACE_ENABLED: "true" },
  });
  const response = await app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(calls, []);
  await app.close();
  process.env.ADMIN_API_KEY = ADMIN_KEY;
});

test("portal, portal assertion, and workspace keys are forbidden before the admin key is used", async () => {
  const headers = [
    { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret", "x-sa360-admin-key": ADMIN_KEY },
    { [CLIENT_PORTAL_ASSERTION_HEADER]: "portal-assertion", "x-sa360-admin-key": ADMIN_KEY },
    { [WORKSPACE_KEY_HEADER]: "workspace-secret", "x-sa360-admin-key": ADMIN_KEY },
  ];
  for (const header of headers) {
    const { app, calls } = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: `/admin/v1/team-workspace/clients/${CLIENT}`,
      headers: header,
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { ok: false, error: "forbidden" });
    assert.deepEqual(calls, []);
    await app.close();
  }
});

test("an unknown or invalid client is not found and does not write", async () => {
  const missing = await buildApp({ client: null });
  const unknown = await missing.app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error, "client_not_found");
  assert.deepEqual(
    missing.calls.map((call) => call.op),
    ["findUnique"]
  );
  await missing.app.close();

  const invalid = await buildApp();
  const bad = await invalid.app.inject({
    method: "GET",
    url: "/admin/v1/team-workspace/clients/bad.id",
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(bad.statusCode, 404);
  assert.equal(bad.json().error, "client_not_found");
  assert.deepEqual(invalid.calls, []);
  await invalid.app.close();
});

test("a known client returns the read contract without secrets or canonical claims", async () => {
  const { app, calls } = await buildApp();
  const response = await app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.equal(body.contractVersion, "team_workspace_delivery_v1");
  assert.deepEqual(body.client, {
    clientAccountId: CLIENT,
    clientDisplayName: "Alex Gross",
    status: "onboarding",
  });
  assert.deepEqual(body.setupRequest, {
    present: true,
    status: "draft",
    revision: 1,
    destinationChoice: "both",
    operational: false,
  });
  assert.deepEqual(body.destinations.ghl, {
    configured: true,
    deliveryEnabled: false,
    deliveryMode: "shadow",
    locationIdPresent: true,
  });
  assert.deepEqual(body.destinations.companySheets, {
    configured: true,
    campaignDispatchEnabled: false,
    campaignDispatchNotBefore: "2026-11-01T15:00:00.000Z",
    agedDispatchEnabled: false,
  });
  assert.deepEqual(body.destinations.customWebhook, {
    present: true,
    enabled: false,
    endpointHost: "hooks.example.test",
  });
  assert.deepEqual(body.recentCanonicalDeliveries, []);
  assert.deepEqual(body.clientNotification, {
    enabled: false,
    canEnable: false,
    blockedReason: "recipient_not_verified",
    recipientVerified: false,
  });
  assert.deepEqual(body.notifications, { items: [] });
  assert.equal(Object.hasOwn(body.notifications, "enabled"), false);
  const serialized = response.body;
  for (const secret of [LOCATION, PHONE, EMAIL, SECRET_URL, SIGNING_SECRET, "token_secret", "sig=abcdef"]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
  assert.deepEqual(
    calls.map((call) => call.op),
    ["findUnique"]
  );
  await app.close();
});

test("a client with no setup or destinations stays undecided and unconfigured", async () => {
  const { app } = await buildApp({
    client: {
      clientAccountId: CLIENT,
      clientDisplayName: "Alex Gross",
      status: "onboarding",
      onboardingSetup: null,
      ghlDestination: null,
      companySheetsDestination: null,
      deliveryTargets: [],
    },
  });
  const response = await app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  const body = response.json();
  assert.equal(body.setupRequest.present, false);
  assert.equal(body.setupRequest.status, null);
  assert.equal(body.setupRequest.revision, 0);
  assert.equal(body.setupRequest.destinationChoice, "undecided");
  assert.equal(body.setupRequest.operational, false);
  assert.equal(body.destinations.ghl.configured, false);
  assert.equal(body.destinations.ghl.locationIdPresent, false);
  assert.equal(body.destinations.companySheets.configured, false);
  assert.equal(body.destinations.customWebhook.present, false);
  assert.deepEqual(body.recentCanonicalDeliveries, []);
  await app.close();
});

test("the process notify flag is not a client preference, and POST is not a route", async () => {
  const { app, calls } = await buildApp({
    env: env({ SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED: "true" }),
  });
  const read = await app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  const body = read.json();
  assert.deepEqual(body.clientNotification, {
    enabled: false,
    canEnable: false,
    blockedReason: "recipient_not_verified",
    recipientVerified: false,
  });
  assert.deepEqual(body.notifications, { items: [] });
  assert.equal(JSON.stringify(body).includes("SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED"), false);
  assert.equal(JSON.stringify(body).includes("recipientEmail"), false);
  const write = await app.inject({
    method: "POST",
    url: `/admin/v1/team-workspace/clients/${CLIENT}`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
    payload: { enabled: true },
  });
  assert.equal(write.statusCode, 404);
  assert.deepEqual(
    calls.map((call) => call.op),
    ["findUnique"]
  );
  await app.close();
});

test("app.ts mounts only the read route", () => {
  const source = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
  const mentions = source.match(/adminTeamWorkspaceRoutes/g) ?? [];
  assert.equal(mentions.length, 2);
  assert.match(source, /await app\.register\(adminTeamWorkspaceRoutes, \{ prefix: "\/admin\/v1" \}\);/);
  const route = readFileSync(new URL("./admin-team-workspace.ts", import.meta.url), "utf8");
  assert.equal(route.includes("app.post"), false);
  assert.equal(route.includes("app.put"), false);
  assert.equal(route.includes("app.patch"), false);
  assert.equal(route.includes("app.delete"), false);
});
