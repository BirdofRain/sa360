/**
 * Behavior of Team Workspace access. A live capability decides the route.
 * Source text in the route gate is not the security check.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_COC_ROLE_OBSERVER } from "./admin-coc-observer-access.ts";
import {
  resolveAdminCocRouteGate,
  type AdminCocRouteGateDecision,
  type AdminCocRouteGateInput,
} from "./admin-coc-route-gate.ts";
import { classifyStaffCapabilitiesResponse, staffCapabilitiesLandingPath } from "./staff-admin-coc-decision.ts";
import { staffWorkspaceAdminApiAllowed } from "./staff-workspace-api-allowlist.ts";

const PRINCIPAL = "c123456789012345678901234";
const CLIENT = "client_123";

const UNAUTHENTICATED: Omit<AdminCocRouteGateInput, "pathname"> = {
  host: "admin.example",
  marketingHostsEnv: "preview.example",
  adminPasswordConfigured: true,
  hasAdminSession: false,
  hasValidPortalSession: false,
  clientPortalLiveConfigured: true,
  frontOfficeDevPreview: false,
  portalAccessQuery: false,
};

const MANAGER = ["team_workspace", "team_manager"] as const;
const OPERATIONS = ["team_workspace", "team_operations"] as const;

function gate(
  base: Omit<AdminCocRouteGateInput, "pathname">,
  pathname: string,
  extra: Partial<AdminCocRouteGateInput> = {}
): AdminCocRouteGateDecision {
  return resolveAdminCocRouteGate({ ...base, pathname, ...extra });
}

function assertRedirect(actual: AdminCocRouteGateDecision, pathname: string, next?: string): void {
  assert.equal(actual.kind, "redirect");
  if (actual.kind !== "redirect") return;
  assert.equal(actual.pathname, pathname);
  assert.equal(actual.next, next);
}

function assertAllow(actual: AdminCocRouteGateDecision): void {
  assert.deepEqual(actual, { kind: "allow", attachAgentWorkspaceCsp: false });
}

test("anonymous, limited, workspace, and administrator sessions keep their surfaces", () => {
  assert.equal(classifyStaffCapabilitiesResponse(401, { ok: false }).access, "anonymous");
  assertRedirect(gate(UNAUTHENTICATED, "/team-workspace"), "/login", "/team-workspace");
  assertRedirect(gate(UNAUTHENTICATED, "/"), "/login");
  assert.deepEqual(gate(UNAUTHENTICATED, "/api/coc/orders", { method: "GET" }), { kind: "unauthorized" });
  assertAllow(gate(UNAUTHENTICATED, "/staff/google/callback"));

  const limited = classifyStaffCapabilitiesResponse(200, {
    ok: true,
    access: "limited",
    permissions: [],
    staffPrincipalId: PRINCIPAL,
  });
  assert.equal(limited.access, "limited");
  assert.deepEqual(limited.permissions, []);
  assert.equal(staffCapabilitiesLandingPath("limited"), "/staff");
  const limitedSession = { ...UNAUTHENTICATED, staffAccess: "limited" as const };
  assertRedirect(gate(limitedSession, "/team-workspace"), "/staff");
  assertRedirect(gate(limitedSession, "/team-workspace/client_1"), "/staff");
  assertRedirect(gate(limitedSession, "/"), "/staff");
  assert.deepEqual(gate(limitedSession, "/api/coc/orders", { method: "GET" }), { kind: "forbidden", surface: "api" });
  assert.equal(staffWorkspaceAdminApiAllowed([], "GET", "/admin/v1/clients"), false);

  const workspaceSession = { ...UNAUTHENTICATED, staffAccess: "workspace" as const };
  for (const permissions of [MANAGER, OPERATIONS]) {
    const classified = classifyStaffCapabilitiesResponse(200, {
      ok: true,
      access: "workspace",
      permissions: [...permissions],
      staffPrincipalId: PRINCIPAL,
    });
    assert.equal(classified.access, "workspace");
    assert.equal(classified.permissions.includes("admin_coc"), false);
    assert.equal(staffCapabilitiesLandingPath("workspace"), "/team-workspace");
    assertAllow(gate(workspaceSession, "/team-workspace"));
    assertAllow(gate(workspaceSession, `/team-workspace/${CLIENT}`));
    assert.equal(staffWorkspaceAdminApiAllowed(permissions, "GET", "/admin/v1/clients"), true);
    assert.equal(staffWorkspaceAdminApiAllowed(permissions, "GET", `/admin/v1/clients/${CLIENT}`), true);
  }

  assertRedirect(gate(workspaceSession, "/"), "/team-workspace");
  assertRedirect(gate(workspaceSession, "/team-management"), "/team-workspace");
  assertRedirect(gate(workspaceSession, "/action-center"), "/team-workspace");
  assertRedirect(gate(workspaceSession, "/team-workspace/../"), "/team-workspace");
  assert.deepEqual(gate(workspaceSession, "/api/coc/orders", { method: "POST" }), { kind: "forbidden", surface: "api" });
  assert.deepEqual(gate(workspaceSession, "/api/fulfillment-ops/orders", { method: "GET" }), {
    kind: "forbidden",
    surface: "api",
  });
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "GET", "/admin/v1/metrics/summary"), false);
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "GET", "/admin/v1/command-center"), false);
  assert.equal(
    staffWorkspaceAdminApiAllowed(MANAGER, "POST", `/admin/v1/clients/${CLIENT}/ghl-destination/activate-ongoing`),
    false
  );
  assert.equal(staffWorkspaceAdminApiAllowed(OPERATIONS, "POST", "/admin/v1/clients"), false);
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "POST", "/admin/v1/clients"), true);

  for (const status of [401, 403, 503]) {
    assert.equal(classifyStaffCapabilitiesResponse(status, { ok: false }).access, "anonymous");
    assert.equal(classifyStaffCapabilitiesResponse(status, null).staffPrincipalId, null);
  }
  assertRedirect(gate(UNAUTHENTICATED, "/team-management"), "/login", "/team-management");

  const administrator = classifyStaffCapabilitiesResponse(200, {
    ok: true,
    access: "admin",
    permissions: ["admin_coc"],
    staffPrincipalId: PRINCIPAL,
  });
  assert.equal(administrator.access, "admin");
  assert.equal(staffCapabilitiesLandingPath("admin"), "/");
  const adminSession = { ...UNAUTHENTICATED, staffAccess: "admin" as const };
  assertAllow(gate(adminSession, "/"));
  assertAllow(gate(adminSession, "/team-management"));
  assertAllow(gate(adminSession, "/team-workspace"));
  assertAllow(gate(adminSession, "/api/coc/orders", { method: "POST" }));

  const sharedPassword = { ...UNAUTHENTICATED, hasAdminSession: true };
  assertAllow(gate(sharedPassword, "/"));
  assertAllow(gate(sharedPassword, "/team-management"));
  assertAllow(gate(sharedPassword, "/api/coc/orders", { method: "POST" }));
  assertRedirect(gate(sharedPassword, "/portal"), "/portal/login", "/portal");
  assert.deepEqual(gate(sharedPassword, "/api/client-portal/dashboard"), { kind: "unauthorized" });

  const observer = { ...UNAUTHENTICATED, adminSessionRole: ADMIN_COC_ROLE_OBSERVER };
  assertAllow(gate(observer, "/"));
  assertAllow(gate(observer, "/webhooks"));
  assert.deepEqual(gate(observer, "/team-workspace"), { kind: "forbidden", surface: "document" });
  assert.deepEqual(gate(observer, "/team-management"), { kind: "forbidden", surface: "document" });
  assert.deepEqual(gate(observer, "/api/coc/orders", { method: "POST" }), { kind: "forbidden", surface: "api" });

  const portal = { ...UNAUTHENTICATED, hasValidPortalSession: true };
  assertAllow(gate(portal, "/portal"));
  assertAllow(gate(portal, "/api/client-portal/dashboard"));
  assertRedirect(gate(portal, "/"), "/login");
  assertRedirect(gate(portal, "/team-workspace"), "/login", "/team-workspace");
  assert.deepEqual(gate(portal, "/api/coc/orders", { method: "GET" }), { kind: "unauthorized" });
});
