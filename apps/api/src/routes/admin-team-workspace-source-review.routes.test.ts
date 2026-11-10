import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Fastify from "fastify";

import { CLIENT_PORTAL_ASSERTION_HEADER } from "@sa360/shared/client-portal-assertion";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import { adminTeamWorkspaceRoutes } from "./admin-team-workspace.js";

const CLIENT = "alex_gross";
const OTHER = "beta_client";
const ADMIN_KEY = "source-review-test-key";
const FUNNEL = "funnel-1";
const CAMPAIGN = "campaign-1";

type Call = string;

type FunnelRow = {
  id: string;
  provider: string;
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  pageSlug: string | null;
  associationStatus: string;
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
};

type RuleRow = {
  id: string;
  clientAccountId: string;
  campaignId: string | null;
  active: boolean;
  deliveryEnabled: boolean;
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
};

function funnel(overrides: Partial<FunnelRow> = {}): FunnelRow {
  return {
    id: "funnel-row",
    provider: "nextgen",
    providerFunnelId: FUNNEL,
    parentUrlKey: null,
    pageSlug: null,
    associationStatus: "confirmed",
    originClientAccountId: CLIENT,
    suggestedClientAccountId: null,
    ...overrides,
  };
}

function rule(overrides: Partial<RuleRow> = {}): RuleRow {
  return {
    id: "rule-row",
    clientAccountId: CLIENT,
    campaignId: CAMPAIGN,
    active: true,
    deliveryEnabled: false,
    effectiveStart: null,
    effectiveEnd: null,
    ...overrides,
  };
}

function createDb(options: {
  client?: { revision: number; setupDataJson: unknown } | null;
  funnels?: FunnelRow[];
  rules?: RuleRow[];
  failReads?: boolean;
} = {}) {
  const calls: Call[] = [];
  const whereSeen: unknown[] = [];
  const fail = (op: string) => async () => {
    calls.push(op);
    throw new Error(`unexpected ${op}`);
  };
  const db = {
    clientAccount: {
      findUnique: async (args: { where: { clientAccountId: string } }) => {
        calls.push("client.findUnique");
        if (!options.client || args.where.clientAccountId !== CLIENT) return null;
        return {
          clientAccountId: CLIENT,
          onboardingSetup: options.client,
        };
      },
      update: fail("client.update"),
      create: fail("client.create"),
      delete: fail("client.delete"),
    },
    sourceFunnel: {
      findMany: async (args: { where: unknown }) => {
        calls.push("sourceFunnel.findMany");
        whereSeen.push(args.where);
        if (options.failReads) throw new Error("source read failed");
        return options.funnels ?? [];
      },
      update: fail("sourceFunnel.update"),
      create: fail("sourceFunnel.create"),
      delete: fail("sourceFunnel.delete"),
    },
    campaignRoutingRule: {
      findMany: async () => {
        calls.push("campaignRoutingRule.findMany");
        if (options.failReads) throw new Error("rule read failed");
        return options.rules ?? [];
      },
      update: fail("campaignRoutingRule.update"),
      create: fail("campaignRoutingRule.create"),
      delete: fail("campaignRoutingRule.delete"),
    },
    $transaction: fail("$transaction"),
    $executeRaw: fail("$executeRaw"),
    $queryRaw: fail("$queryRaw"),
  };
  return { db, calls, whereSeen };
}

function env(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SA360_TEAM_WORKSPACE_ENABLED: "true",
    SA360_NATIVE_CLIENT_SETUP_ENABLED: "true",
    ...overrides,
  };
}

async function build(options: Parameters<typeof createDb>[0] = {}, routeEnv = env()) {
  const { db, calls, whereSeen } = createDb(options);
  const app = Fastify();
  await app.register(adminTeamWorkspaceRoutes, { prefix: "/admin/v1", db: db as never, env: routeEnv });
  return { app, calls, whereSeen };
}

const saved = {
  revision: 4,
  setupDataJson: { providerFunnelId: FUNNEL, providerCampaignId: CAMPAIGN, trafficSourceName: "NextGen page" },
};

async function getReview(options: Parameters<typeof createDb>[0], url = `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review`, routeEnv = env()) {
  const built = await build(options, routeEnv);
  const response = await built.app.inject({
    method: "GET",
    url,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  await built.app.close();
  return { response, calls: built.calls, whereSeen: built.whereSeen };
}

function bodyOf(response: { json: () => unknown }) {
  return response.json() as {
    availability: string;
    requestDisposition: string;
    sourceStatus: string | null;
    campaignStatus: string | null;
    sourceAssociated: boolean;
    deliveryActivated: boolean;
    deliveryConfirmed: boolean;
    liveRouting: boolean;
    campaignOwnership: string;
    attention: string[];
    requested: { providerFunnelId: string | null; providerCampaignId: string | null };
  };
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

test("a confirmed source for this client is associated, and delivery stays off", async () => {
  const { response, calls } = await getReview({ client: saved, funnels: [funnel()], rules: [rule()] });
  const body = bodyOf(response);
  assert.equal(response.statusCode, 200);
  assert.equal(body.sourceStatus, "confirmed_for_client");
  assert.equal(body.sourceAssociated, true);
  assert.equal(body.campaignStatus, "live_routing_rule");
  assert.equal(body.liveRouting, true);
  assert.equal(body.deliveryActivated, false);
  assert.equal(body.deliveryConfirmed, false);
  assert.equal(body.campaignOwnership, "this_client");
  assert.match(body.attention.join(" "), /delivery is not enabled/);
  assert.equal(calls.some((call) => call.includes("update") || call.includes("create") || call.includes("delete") || call.startsWith("$")), false);
});

test("a suggested source is registered and not associated", async () => {
  const { response } = await getReview({
    client: saved,
    funnels: [funnel({ associationStatus: "suggested", originClientAccountId: null, suggestedClientAccountId: CLIENT })],
    rules: [],
  });
  const body = bodyOf(response);
  assert.equal(body.sourceStatus, "registered_unconfirmed");
  assert.equal(body.sourceAssociated, false);
  assert.equal(body.campaignStatus, "no_matching_rule");
  assert.equal(body.deliveryActivated, false);
  assert.match(body.attention.join(" "), /suggestion is not an association/);
});

test("a source confirmed for another client is not associated and hides that client id", async () => {
  const { response } = await getReview({
    client: saved,
    funnels: [funnel({ originClientAccountId: OTHER })],
    rules: [],
  });
  const body = bodyOf(response);
  assert.equal(body.sourceStatus, "confirmed_for_other_client");
  assert.equal(body.sourceAssociated, false);
  assert.equal(response.body.includes(OTHER), false);
});

test("two matching source records are ambiguous and not associated", async () => {
  const { response } = await getReview({
    client: saved,
    funnels: [funnel({ id: "a", provider: "nextgen" }), funnel({ id: "b", provider: "other", originClientAccountId: OTHER })],
    rules: [],
  });
  const body = bodyOf(response);
  assert.equal(body.sourceStatus, "ambiguous");
  assert.equal(body.sourceAssociated, false);
  assert.equal(body.deliveryConfirmed, false);
});

test("a saved campaign id with no rule is not live routing", async () => {
  const { response, calls } = await getReview({ client: saved, funnels: [funnel()], rules: [] });
  const body = bodyOf(response);
  assert.equal(body.campaignStatus, "no_matching_rule");
  assert.equal(body.liveRouting, false);
  assert.equal(body.deliveryActivated, false);
  assert.equal(calls.includes("campaignRoutingRule.findMany"), true);
});

test("another client's live delivery-enabled rule does not enable delivery here", async () => {
  const { response } = await getReview({
    client: saved,
    funnels: [funnel()],
    rules: [rule({ id: "theirs", clientAccountId: OTHER, deliveryEnabled: true })],
  });
  const body = bodyOf(response);
  assert.equal(body.liveRouting, true);
  assert.equal(body.campaignOwnership, "another_client");
  assert.equal(body.deliveryActivated, false);
  assert.equal(body.deliveryConfirmed, false);
  assert.equal(response.body.includes(OTHER), false);
  assert.match(body.attention.join(" "), /another client/);
});

test("a stale expected revision does not verify and does not read registries", async () => {
  const { response, calls } = await getReview(
    { client: saved, funnels: [funnel()], rules: [rule({ deliveryEnabled: true })] },
    `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review?expectedRevision=1`
  );
  const body = bodyOf(response);
  assert.equal(body.requestDisposition, "stale");
  assert.equal(body.sourceAssociated, false);
  assert.equal(body.deliveryActivated, false);
  assert.equal(body.sourceStatus, null);
  assert.equal(body.liveRouting, false);
  assert.match(body.attention.join(" "), /Nothing was verified/);
  assert.equal(calls.includes("sourceFunnel.findMany"), false);
  assert.equal(calls.includes("campaignRoutingRule.findMany"), false);
});

test("an unreadable setup document is not reported as unregistered", async () => {
  const { response, calls } = await getReview({
    client: { revision: 2, setupDataJson: { notAField: true, providerFunnelId: FUNNEL } },
    funnels: [],
    rules: [],
  });
  const body = bodyOf(response);
  assert.equal(body.availability, "unreadable");
  assert.equal(body.sourceStatus, null);
  assert.equal(body.sourceAssociated, false);
  assert.equal(calls.includes("sourceFunnel.findMany"), false);
});

test("a failed registry read is unavailable rather than a clear verification", async () => {
  const { response } = await getReview({ client: saved, failReads: true });
  const body = bodyOf(response);
  assert.equal(body.availability, "unavailable");
  assert.equal(body.sourceAssociated, false);
  assert.equal(body.deliveryActivated, false);
  assert.equal(body.liveRouting, false);
  assert.match(body.attention.join(" "), /Nothing was verified/);
});

test("too many matching records are not partially verified", async () => {
  const funnels = Array.from({ length: 21 }, (_, index) => funnel({ id: `row-${index}`, provider: index % 2 === 0 ? "nextgen" : "other" }));
  const { response } = await getReview({ client: saved, funnels, rules: [] });
  const body = bodyOf(response);
  assert.equal(body.availability, "unavailable");
  assert.equal(body.sourceAssociated, false);
  assert.match(body.attention.join(" "), /Nothing was verified/);
});

test("a page URL is matched by its canonical key, not the raw URL", async () => {
  const { response, whereSeen } = await getReview({
    client: {
      revision: 1,
      setupDataJson: { nextgenFunnelUrl: "https://My.LeadCapture.io/p/dn_omzoj?v=1", providerCampaignId: CAMPAIGN },
    },
    funnels: [funnel({ providerFunnelId: null, parentUrlKey: "my.leadcapture.io/p/dn_omzoj" })],
    rules: [],
  });
  const body = bodyOf(response);
  assert.equal(body.sourceStatus, "confirmed_for_client");
  assert.equal(JSON.stringify(whereSeen).includes("my.leadcapture.io/p/dn_omzoj"), true);
  assert.equal(JSON.stringify(whereSeen).includes("https://"), false);
});

test("native setup turned off does not verify a stored document", async () => {
  const { response, calls } = await getReview({ client: saved, funnels: [funnel()], rules: [rule({ deliveryEnabled: true })] }, undefined, env({ SA360_NATIVE_CLIENT_SETUP_ENABLED: "yes" }));
  const body = bodyOf(response);
  assert.equal(body.availability, "unavailable");
  assert.equal(body.sourceAssociated, false);
  assert.equal(calls.includes("sourceFunnel.findMany"), false);
});

test("the team workspace flag must be exactly true, and foreign credentials do not read", async () => {
  for (const flag of ["TRUE", "1", "yes", "false"]) {
    const built = await build({ client: saved }, env({ SA360_TEAM_WORKSPACE_ENABLED: flag }));
    const response = await built.app.inject({
      method: "GET",
      url: `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(response.statusCode, 404);
    assert.deepEqual(built.calls, []);
    await built.app.close();
  }

  const portal = await build({ client: saved });
  const denied = await portal.app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review`,
    headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal-secret", "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(denied.statusCode, 403);
  assert.deepEqual(portal.calls, []);
  await portal.app.close();

  for (const header of [
    { [CLIENT_PORTAL_ASSERTION_HEADER]: "portal-assertion", "x-sa360-admin-key": ADMIN_KEY },
    { [WORKSPACE_KEY_HEADER]: "workspace-secret", "x-sa360-admin-key": ADMIN_KEY },
  ]) {
    const built = await build({ client: saved });
    const response = await built.app.inject({
      method: "GET",
      url: `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review`,
      headers: header,
    });
    assert.equal(response.statusCode, 403);
    assert.deepEqual(built.calls, []);
    await built.app.close();
  }
});

test("a missing admin key does not read, and an invalid revision is rejected first", async () => {
  const missing = await build({ client: saved });
  const unauthorized = await missing.app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review`,
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(missing.calls, []);
  await missing.app.close();

  const invalid = await build({ client: saved });
  const rejected = await invalid.app.inject({
    method: "GET",
    url: `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review?expectedRevision=1.5`,
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
  assert.equal(rejected.statusCode, 400);
  assert.deepEqual(invalid.calls, []);
  await invalid.app.close();
});

test("the review route stays read-only and off the observer allowlist", () => {
  const route = readFileSync(new URL("./admin-team-workspace.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../services/team-workspace/source-campaign-review-read.ts", import.meta.url), "utf8");
  const observer = readFileSync(new URL("../../../admin-coc/src/lib/admin-coc-observer-access.ts", import.meta.url), "utf8");
  const source = `${route}\n${service}`;
  for (const banned of ["app.post", "app.put", "app.patch", "app.delete", "confirmSourceFunnel", "createRoutingRule", "associateSourceFunnel", "$executeRaw"]) {
    assert.equal(source.includes(banned), false, banned);
  }
  assert.equal(observer.includes("source-campaign-review"), false);
  assert.equal(service.includes("reviewSavedSourceCampaignRequest"), true);
});
