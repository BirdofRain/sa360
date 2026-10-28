import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { WORKSPACE_KEY_HEADER } from "../lib/workspace-auth.js";
import {
  adminClientOnboardingGoogleOnlyPreflightRoutes,
  presentPreflight,
} from "./admin-client-onboarding-google-only-preflight.js";
import type { GoogleOnlyPilotPreflight } from "../services/client-onboarding-v2/google-only-pilot-preflight.js";

const CLIENT = "alex_gross";

function report(): GoogleOnlyPilotPreflight {
  const unavailable = { state: "unavailable" as const, reason: "not read" };
  return {
    clientAccountId: CLIENT,
    worksheet: { state: "read", value: null },
    identities: { state: "read", value: [] },
    runs: { state: "read", value: [] },
    locks: { state: "read", value: [] },
    heldAppends: { state: "read", value: [] },
    unresolvedJobs: { state: "read", value: [] },
    grants: { state: "unverified", reason: "sa360_app role was not readable" },
    identityConflicts: { state: "read", value: { verifiedIdentityConflicts: 1, storedLeadConflicts: 2 } },
    quarantine: { state: "read", value: { labeledEventCount: 1, customerIntakeLabeledCount: 1, eligibleEventCount: 0 } },
    dispatch: unavailable,
  };
}

test("the preflight route is admin-only and returns no lead contact", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminClientOnboardingGoogleOnlyPreflightRoutes, {
    prefix: "/admin/v1",
    readPreflight: async () => report(),
  });
  const missing = await app.inject({ method: "GET", url: `/admin/v1/clients/${CLIENT}/onboarding/google-only-pilot/preflight` });
  assert.equal(missing.statusCode, 401);
  const observer = await app.inject({
    method: "GET",
    url: `/admin/v1/clients/${CLIENT}/onboarding/google-only-pilot/preflight`,
    headers: { cookie: "sa360_admin_session=observer", "x-sa360-admin-key": "admin-secret" },
  });
  assert.equal(observer.statusCode, 403);
  const portal = await app.inject({
    method: "GET",
    url: `/admin/v1/clients/${CLIENT}/onboarding/google-only-pilot/preflight`,
    headers: { [CLIENT_PORTAL_KEY_HEADER]: "portal", "x-sa360-admin-key": "admin-secret" },
  });
  assert.equal(portal.statusCode, 403);
  const workspace = await app.inject({
    method: "GET",
    url: `/admin/v1/clients/${CLIENT}/onboarding/google-only-pilot/preflight`,
    headers: { [WORKSPACE_KEY_HEADER]: "workspace", "x-sa360-admin-key": "admin-secret" },
  });
  assert.equal(workspace.statusCode, 403);
  const ok = await app.inject({
    method: "GET",
    url: `/admin/v1/clients/${CLIENT}/onboarding/google-only-pilot/preflight`,
    headers: { "x-sa360-admin-key": "admin-secret" },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.writes, false);
  assert.equal(body.externalCalls.sheets, false);
  assert.equal(body.externalCalls.ghl, false);
  assert.equal(body.decision.append, "no_go");
  assert.equal(body.grants.state, "unverified");
  assert.equal(body.identityConflicts.value.verifiedIdentityConflicts, 1);
  assert.equal(JSON.stringify(body).includes("@"), false);
  await app.close();
  if (prev === undefined) delete process.env.ADMIN_API_KEY;
  else process.env.ADMIN_API_KEY = prev;
});

test("presentPreflight does not turn an unverified grant into an empty list", () => {
  const body = presentPreflight(report());
  assert.equal(body.grants.state, "unverified");
  assert.equal(body.decision.setup, "no_go");
  assert.match(body.decision.reasons.join(" "), /unverified/);
});
