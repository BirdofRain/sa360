import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import Fastify from "fastify";

import { STAFF_ENROLLMENT_ISSUER_HEADER } from "@sa360/shared/staff-enrollment";
import { STAFF_SESSION_HEADER, signStaffSession } from "@sa360/shared/staff-google-session";
import { STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";

import { verifyAdminApiKey } from "../lib/admin-auth.js";
import type { ProvisionedStaffPrincipal } from "../lib/staff-google-identity.js";
import { createMemoryStaffSessionRegistry } from "../lib/staff-session-registry.js";
import { staffAdminCocRoutes, type StaffAdminCocRouteDeps } from "./staff-admin-coc.js";

const CLIENT_ID = "staff-test-client.apps.googleusercontent.com";
const SECRET = "staff-session-secret-at-least-32-characters";
const SERVICE = "staff-google-service-secret-32-characters";
const ISSUER = "staff-enrollment-issuer-secret-32-chars";
const PRINCIPAL = "c123456789012345678901234";
const SUB = "102938475610293847561";
const EMAIL = "ada.staff@example.com";

function issuedNow(): number {
  return Math.floor(Date.now() / 1000);
}

function enabled(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SA360_STAFF_GOOGLE_SIGNIN_ENABLED: "true",
    SA360_STAFF_GOOGLE_CLIENT_ID: CLIENT_ID,
    SA360_STAFF_SESSION_SECRET: SECRET,
    SA360_STAFF_GOOGLE_SERVICE_SECRET: SERVICE,
    SA360_STAFF_ENROLLMENT_ISSUER_SECRET: ISSUER,
    ...extra,
  };
}

function bound(overrides: Partial<ProvisionedStaffPrincipal> = {}): ProvisionedStaffPrincipal {
  return {
    id: PRINCIPAL,
    email: EMAIL,
    status: "active",
    provider: "google",
    providerSubject: SUB,
    disabledAt: null,
    ...overrides,
  };
}

function sessionToken(): string {
  return signStaffSession({ staffPrincipalId: PRINCIPAL, googleSub: SUB, nowSec: issuedNow(), secret: SECRET }).token;
}

async function build(overrides: StaffAdminCocRouteDeps = {}) {
  const registry = overrides.sessionRegistry ?? createMemoryStaffSessionRegistry();
  const principal = bound();
  const app = Fastify();
  await app.register(staffAdminCocRoutes, {
    sessionRegistry: registry,
    findById: async () => principal,
    allows: async () => "allowed",
    grant: async () => ({
      ok: true,
      alreadyGranted: false,
      grant: {
        staffPermissionId: "cperm0000000000000000001",
        staffPrincipalId: PRINCIPAL,
        email: EMAIL,
        permission: "admin_coc",
        status: "granted",
        grantedAt: new Date("2026-11-11T16:00:00.000Z"),
        revokedAt: null,
      },
    }),
    revoke: async () => ({
      ok: true,
      grant: {
        staffPermissionId: "cperm0000000000000000001",
        staffPrincipalId: PRINCIPAL,
        email: EMAIL,
        permission: "admin_coc",
        status: "revoked",
        grantedAt: new Date("2026-11-11T16:00:00.000Z"),
        revokedAt: new Date("2026-11-11T17:00:00.000Z"),
      },
    }),
    status: async () => ({
      ok: true,
      staffPrincipalId: PRINCIPAL,
      email: EMAIL,
      status: "active",
      providerSubject: SUB,
      adminCoc: "absent",
      staffPermissionId: null,
    }),
    ...overrides,
    env: overrides.env ?? enabled(),
  });
  return { app, registry, principal };
}

test("authorize requires the service credential, a live registry row, and the admin_coc grant", async () => {
  const { app, registry } = await build();
  const token = sessionToken();
  const missing = await app.inject({ method: "POST", url: "/internal/staff/admin-coc/authorize" });
  assert.equal(missing.statusCode, 401);

  const adminKey = await app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/authorize",
    headers: { "x-sa360-admin-key": "admin-key", [STAFF_SESSION_HEADER]: token },
  });
  assert.equal(adminKey.statusCode, 401);

  const unregistered = await app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/authorize",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: token },
  });
  assert.equal(unregistered.statusCode, 401);

  const signed = signStaffSession({ staffPrincipalId: PRINCIPAL, googleSub: SUB, nowSec: issuedNow(), secret: SECRET });
  assert.equal(await registry.register(signed.claims, issuedNow()), "registered");
  const denied = await build({
    sessionRegistry: registry,
    allows: async () => "absent",
  });
  const noGrant = await denied.app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/authorize",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: signed.token },
  });
  assert.equal(noGrant.statusCode, 403);
  assert.equal(JSON.stringify(noGrant.json()).includes("admin"), false);

  const allowed = await build({ sessionRegistry: registry, allows: async () => "allowed" });
  const ok = await allowed.app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/authorize",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: signed.token },
  });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json(), { ok: true, staffPrincipalId: PRINCIPAL });
  assert.equal(JSON.stringify(ok.json()).includes("x-sa360-admin-key"), false);
  assert.equal(JSON.stringify(ok.json()).includes(SERVICE), false);
});

test("a revoked staff session and a disabled principal cannot authorize", async () => {
  const { app, registry } = await build();
  const signed = signStaffSession({ staffPrincipalId: PRINCIPAL, googleSub: SUB, nowSec: issuedNow(), secret: SECRET });
  assert.equal(await registry.register(signed.claims, issuedNow()), "registered");
  assert.equal(await registry.revoke(signed.claims, issuedNow()), "revoked");
  const copied = await app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/authorize",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: signed.token },
  });
  assert.equal(copied.statusCode, 401);

  const fresh = signStaffSession({
    staffPrincipalId: PRINCIPAL,
    googleSub: SUB,
    nowSec: issuedNow(),
    secret: SECRET,
    sessionId: "disabled-session-id-00000001",
  });
  const disabledRegistry = createMemoryStaffSessionRegistry();
  await disabledRegistry.register(fresh.claims, issuedNow());
  const disabledApp = await build({
    sessionRegistry: disabledRegistry,
    findById: async () => bound({ status: "disabled", disabledAt: new Date("2026-11-11T00:00:00.000Z") }),
    allows: async () => {
      throw new Error("grant must not be consulted for a disabled principal");
    },
  });
  const rejected = await disabledApp.app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/authorize",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: fresh.token },
  });
  assert.equal(rejected.statusCode, 401);
});

test("grant and revoke require the issuer secret and ignore staff sessions and the admin key", async () => {
  const calls: string[] = [];
  const { app } = await build({
    grant: async (input) => {
      calls.push(`${input.staffPrincipalId}:${input.email}`);
      return { ok: false, code: "email_mismatch" };
    },
  });
  const hidden = await build({ env: enabled({ SA360_STAFF_ENROLLMENT_ENABLED: undefined, SA360_STAFF_ENROLLMENT_ISSUER_SECRET: "" }) });
  const missingSecret = await hidden.app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/grant",
    headers: { [STAFF_ENROLLMENT_ISSUER_HEADER]: ISSUER },
    payload: { staffPrincipalId: PRINCIPAL, email: EMAIL },
  });
  assert.equal(missingSecret.statusCode, 404);

  const enrollmentOff = await build({
    env: enabled({ SA360_STAFF_ENROLLMENT_ENABLED: "false" }),
    grant: async () => ({
      ok: true,
      alreadyGranted: false,
      grant: {
        staffPermissionId: "cperm0000000000000000001",
        staffPrincipalId: PRINCIPAL,
        email: EMAIL,
        permission: "admin_coc",
        status: "granted",
        grantedAt: new Date("2026-11-11T16:00:00.000Z"),
        revokedAt: null,
      },
    }),
  });
  const granted = await enrollmentOff.app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/grant",
    headers: { [STAFF_ENROLLMENT_ISSUER_HEADER]: ISSUER },
    payload: { staffPrincipalId: PRINCIPAL, email: EMAIL },
  });
  assert.equal(granted.statusCode, 200);
  assert.equal(granted.json().permission, "admin_coc");
  assert.equal(granted.json().email, EMAIL);

  const serviceOnly = await app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/grant",
    headers: { [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE, [STAFF_SESSION_HEADER]: sessionToken() },
    payload: { staffPrincipalId: PRINCIPAL, email: EMAIL },
  });
  assert.equal(serviceOnly.statusCode, 401);
  const adminOnly = await app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/revoke",
    headers: { "x-sa360-admin-key": "admin-key" },
    payload: { staffPrincipalId: PRINCIPAL, email: "ada.staff@example.com.attacker.test" },
  });
  assert.equal(adminOnly.statusCode, 401);
  assert.deepEqual(calls, []);

  const mismatch = await app.inject({
    method: "POST",
    url: "/internal/staff/admin-coc/grant",
    headers: { [STAFF_ENROLLMENT_ISSUER_HEADER]: ISSUER },
    payload: { staffPrincipalId: PRINCIPAL, email: "ada.staff@example.com.attacker.test" },
  });
  assert.equal(mismatch.statusCode, 401);
  assert.deepEqual(calls, [`${PRINCIPAL}:ada.staff@example.com.attacker.test`]);
});

test("a staff session is not an admin API key and does not open association correction", async () => {
  const preview = readFileSync(
    join(import.meta.dirname, "admin-facebook-association-correction-preview.ts"),
    "utf8"
  );
  const correction = readFileSync(
    join(import.meta.dirname, "../services/source-intake/facebook-association-correction-confirmation.ts"),
    "utf8"
  );
  const grantSource = readFileSync(join(import.meta.dirname, "../lib/staff-admin-coc.ts"), "utf8");
  assert.equal(preview.includes("STAFF_SESSION_HEADER"), false);
  assert.equal(preview.includes("admin_coc"), false);
  assert.equal(correction.includes("admin_coc"), false);
  assert.equal(grantSource.includes("facebook_association_correction"), true);
  assert.equal(grantSource.includes('permission: "facebook_association_correction"'), false);
  assert.equal(grantSource.includes("SA360_STAFF_GOOGLE_SIGNIN_ENABLED"), false);

  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "test-admin-key";
  try {
    const api = Fastify();
    api.get("/admin/v1/facebook-source-resolution/association-correction-preview", async (request, reply) => {
      if (!(await verifyAdminApiKey(request, reply))) return;
      return { ok: true };
    });
    const token = sessionToken();
    const rejected = await api.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution/association-correction-preview",
      headers: { [STAFF_SESSION_HEADER]: token, [STAFF_GOOGLE_SERVICE_HEADER]: SERVICE },
    });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.json().ok, false);
    const allowed = await api.inject({
      method: "GET",
      url: "/admin/v1/facebook-source-resolution/association-correction-preview",
      headers: { "x-sa360-admin-key": "test-admin-key" },
    });
    assert.equal(allowed.statusCode, 200);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});
