import assert from "node:assert/strict";
import test from "node:test";

import { STAFF_SESSION_COOKIE, STAFF_SESSION_HEADER } from "@sa360/shared/staff-google-session";
import { STAFF_GOOGLE_SERVICE_HEADER } from "@sa360/shared/staff-google-service";

import {
  STAFF_ADMIN_COC_AUTHORIZE_PATH,
  STAFF_ADMIN_COC_SERVICE_HEADER,
  STAFF_ADMIN_COC_SESSION_COOKIE,
  STAFF_ADMIN_COC_SESSION_HEADER,
  STAFF_CAPABILITIES_PATH,
  classifyStaffAdminCocResponse,
  classifyStaffCapabilitiesResponse,
  fetchStaffAdminCocDecision,
  fetchStaffCapabilities,
  readStaffAdminCocOrigin,
  staffAdminCocLandingPath,
  staffCapabilitiesLandingPath,
} from "./staff-admin-coc-decision.ts";

const PRINCIPAL = "c123456789012345678901234";

test("only a confirmed authorize body is an admin decision", () => {
  assert.equal(classifyStaffAdminCocResponse(200, { ok: true, staffPrincipalId: PRINCIPAL }), "admin");
  assert.equal(classifyStaffAdminCocResponse(200, { ok: true, staffPrincipalId: PRINCIPAL, role: "ADMIN" }), "admin");
  assert.equal(classifyStaffAdminCocResponse(200, { ok: true, staffPrincipalId: "not-a-principal" }), "anonymous");
  assert.equal(classifyStaffAdminCocResponse(200, { ok: true }), "anonymous");
  assert.equal(classifyStaffAdminCocResponse(403, { ok: false }), "limited");
  assert.equal(classifyStaffAdminCocResponse(401, { ok: false }), "anonymous");
  assert.equal(classifyStaffAdminCocResponse(503, { ok: false }), "anonymous");
  assert.equal(staffAdminCocLandingPath("admin"), "/");
  assert.equal(staffAdminCocLandingPath("limited"), "/staff");
  assert.equal(staffAdminCocLandingPath("anonymous"), "/staff");
  assert.equal(STAFF_ADMIN_COC_SESSION_COOKIE, STAFF_SESSION_COOKIE);
  assert.equal(STAFF_ADMIN_COC_SESSION_HEADER, STAFF_SESSION_HEADER);
  assert.equal(STAFF_ADMIN_COC_SERVICE_HEADER, STAFF_GOOGLE_SERVICE_HEADER);
});

test("the authorize request sends the staff session and never the admin API key", async () => {
  let captured: { url: string; headers: Headers } | undefined;
  const decision = await fetchStaffAdminCocDecision({
    origin: "https://api.example.test",
    serviceSecret: "staff-google-service-secret-32-characters",
    sessionToken: "sf1.session.token",
    fetchImpl: async (url, init) => {
      captured = { url: String(url), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({ ok: true, staffPrincipalId: PRINCIPAL }), { status: 200 });
    },
  });
  assert.equal(decision, "admin");
  assert.equal(captured?.url, `https://api.example.test${STAFF_ADMIN_COC_AUTHORIZE_PATH}`);
  assert.equal(captured?.headers.get(STAFF_ADMIN_COC_SERVICE_HEADER), "staff-google-service-secret-32-characters");
  assert.equal(captured?.headers.get(STAFF_ADMIN_COC_SESSION_HEADER), "sf1.session.token");
  assert.equal(captured?.headers.get("x-sa360-admin-key"), null);
  assert.equal(readStaffAdminCocOrigin("https://api.example.test/internal"), null);
  assert.equal(readStaffAdminCocOrigin("http://example.test"), null);
  assert.equal(readStaffAdminCocOrigin("http://127.0.0.1:3001"), "http://127.0.0.1:3001");
});

test("capabilities fail closed unless the permission list matches the access label", () => {
  assert.deepEqual(
    classifyStaffCapabilitiesResponse(200, {
      ok: true,
      access: "admin",
      permissions: ["admin_coc"],
      staffPrincipalId: PRINCIPAL,
    }),
    { access: "admin", permissions: ["admin_coc"], staffPrincipalId: PRINCIPAL }
  );
  assert.equal(
    classifyStaffCapabilitiesResponse(200, {
      ok: true,
      access: "admin",
      permissions: ["team_workspace"],
      staffPrincipalId: PRINCIPAL,
    }).access,
    "anonymous"
  );
  assert.deepEqual(
    classifyStaffCapabilitiesResponse(200, {
      ok: true,
      access: "workspace",
      permissions: ["team_workspace", "team_manager"],
      staffPrincipalId: PRINCIPAL,
    }).access,
    "workspace"
  );
  assert.equal(
    classifyStaffCapabilitiesResponse(200, {
      ok: true,
      access: "workspace",
      permissions: ["team_workspace", "admin_coc"],
      staffPrincipalId: PRINCIPAL,
    }).access,
    "anonymous"
  );
  assert.deepEqual(classifyStaffCapabilitiesResponse(403, { ok: false }).access, "anonymous");
  assert.equal(staffCapabilitiesLandingPath("admin"), "/");
  assert.equal(staffCapabilitiesLandingPath("workspace"), "/team-workspace");
  assert.equal(staffCapabilitiesLandingPath("limited"), "/staff");
});

test("capabilities fetch does not send the admin API key", async () => {
  let captured: Headers | undefined;
  const result = await fetchStaffCapabilities({
    origin: "https://api.example.test",
    serviceSecret: "staff-google-service-secret-32-characters",
    sessionToken: "sf1.session.token",
    fetchImpl: async (url, init) => {
      captured = new Headers(init?.headers);
      assert.equal(String(url), `https://api.example.test${STAFF_CAPABILITIES_PATH}`);
      return new Response(
        JSON.stringify({
          ok: true,
          access: "workspace",
          permissions: ["team_workspace", "team_operations"],
          staffPrincipalId: PRINCIPAL,
        }),
        { status: 200 }
      );
    },
  });
  assert.equal(result.access, "workspace");
  assert.equal(result.permissions.includes("admin_coc"), false);
  assert.equal(captured?.get("x-sa360-admin-key"), null);
});
