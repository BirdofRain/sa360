import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { STAFF_ENROLLMENT_ISSUER_HEADER } from "@sa360/shared/staff-enrollment";
import { STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";
import { STAFF_SESSION_HEADER, signStaffSession } from "@sa360/shared/staff-google-session";

import type { ProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import { createMemoryStaffSessionRegistry } from "../lib/staff-session-registry.js";
import { staffGoogleRoutes } from "./staff-google.js";
import { staffTeamRoutes, type StaffTeamRouteDeps } from "./staff-team.js";

const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const SECRET = "staff-session-secret-at-least-32-characters";
const SERVICE = "staff-google-service-secret-32-characters";
const ISSUER = "staff-enrollment-issuer-secret-32-chars";
const ADMIN_KEY = "shared-admin-api-key";
const PRINCIPAL = "c123456789012345678901234";
const SUB = "102938475610293847561";

function issuedNow(): number {
  return Math.floor(Date.now() / 1000);
}

function enabled(): NodeJS.ProcessEnv {
  return {
    SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true",
    SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
    SA360_STAFF_SESSION_SECRET: SECRET,
    SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
    SA360_STAFF_ENROLLMENT_ISSUER_SECRET: ISSUER,
    SA360_ADMIN_API_KEY: ADMIN_KEY,
  };
}

function principal(overrides: Partial<ProvisionedStaffPrincipal> = {}): ProvisionedStaffPrincipal {
  return {
    id: PRINCIPAL,
    email: "ada.staff@lifeagentlaunch.com",
    status: "active",
    provider: "google",
    providerSubject: SUB,
    disabledAt: null,
    ...overrides,
  };
}

async function teamApp(overrides: StaffTeamRouteDeps = {}) {
  const registry = overrides.sessionRegistry ?? createMemoryStaffSessionRegistry();
  const app = Fastify();
  await app.register(staffTeamRoutes, {
    env: enabled(),
    sessionRegistry: registry,
    findById: async () => principal(),
    allows: async () => "allowed",
    list: async () => ({ ok: true, members: [] }),
    permissions: async () => ["admin_coc"],
    invite: async () => ({ ok: false, code: "rejected" }),
    changeAccess: async () => ({ ok: false, code: "rejected" }),
    revoke: async () => ({ ok: false, code: "rejected" }),
    disable: async () => ({ ok: false, code: "rejected" }),
    ...overrides,
  });
  return { app, registry };
}

function sessionToken(): { token: string; claims: ReturnType<typeof signStaffSession>["claims"] } {
  return signStaffSession({ staffPrincipalId: PRINCIPAL, googleSub: SUB, nowSec: issuedNow(), secret: SECRET });
}

test("team management rejects the admin key, issuer secret, and a logged-out staff session", async () => {
  const { app, registry } = await teamApp();
  const signed = sessionToken();
  const list = { method: "POST" as const, url: "/internal/staff/team/members", payload: {} };

  assert.equal((await app.inject(list)).statusCode, 401);
  assert.equal(
    (await app.inject({ ...list, headers: { "x-sa360-admin-key": ADMIN_KEY, [STAFF_SESSION_HEADER]: signed.token } })).statusCode,
    401
  );
  assert.equal(
    (
      await app.inject({
        ...list,
        headers: { [STAFF_ENROLLMENT_ISSUER_HEADER]: ISSUER, [STAFF_SESSION_HEADER]: signed.token },
      })
    ).statusCode,
    401
  );
  assert.equal(
    (await app.inject({ ...list, headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: signed.token } }))
      .statusCode,
    401
  );

  assert.equal(await registry.register(signed.claims, issuedNow()), "registered");
  assert.equal(await registry.revoke(signed.claims, issuedNow()), "revoked");
  const revoked = await app.inject({
    ...list,
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: signed.token },
  });
  assert.equal(revoked.statusCode, 401);
  assert.equal(JSON.stringify(revoked.json()).includes(ADMIN_KEY), false);
  assert.equal(JSON.stringify(revoked.json()).includes(ISSUER), false);
});

test("a live session without admin_coc cannot create or change staff", async () => {
  const { app, registry } = await teamApp({
    allows: async () => "absent",
    permissions: async () => ["team_workspace", "team_manager"],
    invite: async () => {
      throw new Error("manager must not invite");
    },
    changeAccess: async () => {
      throw new Error("manager must not change access");
    },
  });
  const signed = sessionToken();
  assert.equal(await registry.register(signed.claims, issuedNow()), "registered");
  const headers = { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: signed.token };
  const capabilities = await app.inject({ method: "POST", url: "/internal/staff/session/capabilities", headers });
  assert.equal(capabilities.statusCode, 200);
  assert.deepEqual(capabilities.json(), {
    ok: true,
    access: "workspace",
    permissions: ["team_workspace", "team_manager"],
    staffPrincipalId: PRINCIPAL,
  });
  assert.equal(JSON.stringify(capabilities.json()).includes("admin_coc"), false);

  const created = await app.inject({
    method: "POST",
    url: "/internal/staff/team/members/create",
    headers,
    payload: { email: "new.person@lifeagentlaunch.com", accessLevel: "administrator", confirmAdministrator: true, role: "administrator" },
  });
  assert.equal(created.statusCode, 403);
  assert.equal(created.json().code, "forbidden");

  const changed = await app.inject({
    method: "POST",
    url: "/internal/staff/team/members/access",
    headers,
    payload: { staffPrincipalId: PRINCIPAL, email: "ada.staff@lifeagentlaunch.com", accessLevel: "administrator", confirmAdministrator: true },
  });
  assert.equal(changed.statusCode, 403);
});

test("administrator confirmation is required and a disabled principal fails closed", async () => {
  let invited = 0;
  const { app, registry } = await teamApp({
    invite: async (input) => {
      invited += 1;
      assert.equal(input.accessLevel, "administrator");
      assert.equal(input.confirmAdministrator, false);
      return { ok: false, code: "confirmation_required" };
    },
  });
  const signed = sessionToken();
  assert.equal(await registry.register(signed.claims, issuedNow()), "registered");
  const headers = { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: signed.token };
  const missingLevel = await app.inject({
    method: "POST",
    url: "/internal/staff/team/members/create",
    headers,
    payload: { email: "new.person@lifeagentlaunch.com", role: "administrator" },
  });
  assert.equal(missingLevel.statusCode, 400);
  assert.equal(invited, 0);

  const unconfirmed = await app.inject({
    method: "POST",
    url: "/internal/staff/team/members/create",
    headers,
    payload: { email: "new.person@lifeagentlaunch.com", accessLevel: "administrator" },
  });
  assert.equal(unconfirmed.statusCode, 400);
  assert.equal(unconfirmed.json().code, "confirmation_required");
  assert.equal(invited, 1);

  const disabled = await teamApp({
    findById: async () => principal({ status: "disabled", disabledAt: new Date("2026-11-11T00:00:00.000Z") }),
    sessionRegistry: registry,
  });
  const denied = await disabled.app.inject({ method: "POST", url: "/internal/staff/team/members", headers });
  assert.equal(denied.statusCode, 401);
});

test("claim returns no oracle and ignores a caller-supplied principal or enrollment secret", async () => {
  let claims = 0;
  const app = Fastify();
  await app.register(staffGoogleRoutes, {
    env: enabled(),
    recordSignIn: async () => undefined,
    verifyIdToken: async () => ({
      ok: true,
      identity: {
        sub: SUB,
        email: "unapproved.person@lifeagentlaunch.com",
        emailVerified: true,
        nonce: "n".repeat(43),
        hd: "lifeagentlaunch.com",
      },
    }),
    claimApproved: async (input: { hostedDomain?: string; identity: { email: string } }) => {
      claims += 1;
      assert.equal(input.hostedDomain, "lifeagentlaunch.com");
      assert.equal(input.identity.email, "unapproved.person@lifeagentlaunch.com");
      return { ok: false, code: "not_invited" };
    },
  });
  const headers = { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE };
  const planted = await app.inject({
    method: "POST",
    url: "/internal/staff/google/claim",
    headers,
    payload: { idToken: "synthetic", nonce: "n".repeat(43), staffPrincipalId: PRINCIPAL, enrollmentSecret: "secret" },
  });
  assert.equal(planted.statusCode, 401);
  assert.deepEqual(planted.json(), { ok: false });
  assert.equal(claims, 0);

  const unapproved = await app.inject({
    method: "POST",
    url: "/internal/staff/google/claim",
    headers,
    payload: { idToken: "synthetic", nonce: "n".repeat(43) },
  });
  assert.equal(unapproved.statusCode, 401);
  assert.deepEqual(unapproved.json(), { ok: false });
  assert.equal(JSON.stringify(unapproved.json()).includes("not_invited"), false);
  assert.equal(claims, 1);

  const missingService = await app.inject({
    method: "POST",
    url: "/internal/staff/google/claim",
    headers: { "x-sa360-admin-key": ADMIN_KEY },
    payload: { idToken: "synthetic", nonce: "n".repeat(43) },
  });
  assert.equal(missingService.statusCode, 401);
  assert.equal(claims, 1);
});
