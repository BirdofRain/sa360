import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { staffWorkspaceAdminApiAllowed } from "./staff-workspace-api-allowlist.ts";

const CLIENT = "client_123";
const WORKSPACE = ["team_workspace"] as const;
const MANAGER = ["team_workspace", "team_manager"] as const;
const OPERATIONS = ["team_workspace", "team_operations"] as const;

test("workspace reads stay on the client and configuration-request list", () => {
  assert.equal(staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", "/admin/v1/clients"), true);
  assert.equal(staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", `/admin/v1/clients/${CLIENT}`), true);
  assert.equal(staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", `/admin/v1/clients/${CLIENT}/setup`), true);
  assert.equal(staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", `/admin/v1/clients/${CLIENT}/onboarding`), true);
  assert.equal(staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", `/admin/v1/clients/${CLIENT}/source-funnels`), true);
  assert.equal(
    staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", `/admin/v1/clients/${CLIENT}/source-campaign-requests`),
    true
  );
  assert.equal(
    staffWorkspaceAdminApiAllowed(
      WORKSPACE,
      "GET",
      `/admin/v1/clients/${CLIENT}/onboarding-attribution/6f1e2d3c-4b5a-4678-89ab-cdef01234567`
    ),
    true
  );
  assert.equal(
    staffWorkspaceAdminApiAllowed(OPERATIONS, "GET", `/admin/v1/clients/${CLIENT}/onboarding-attribution/6f1e2d3c-4b5a-4678-89ab-cdef01234567`),
    true
  );
  assert.equal(
    staffWorkspaceAdminApiAllowed(MANAGER, "POST", `/admin/v1/clients/${CLIENT}/onboarding-attribution/6f1e2d3c-4b5a-4678-89ab-cdef01234567`),
    false
  );
  assert.equal(
    staffWorkspaceAdminApiAllowed([], "GET", `/admin/v1/clients/${CLIENT}/onboarding-attribution/6f1e2d3c-4b5a-4678-89ab-cdef01234567`),
    false
  );
  assert.equal(
    staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", `/admin/v1/team-workspace/clients/${CLIENT}/source-campaign-review`),
    true
  );
  assert.equal(staffWorkspaceAdminApiAllowed(OPERATIONS, "GET", `/admin/v1/clients/${CLIENT}`), true);
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "GET", `/admin/v1/clients/${CLIENT}/delivery-config`), true);
  assert.equal(staffWorkspaceAdminApiAllowed(OPERATIONS, "GET", `/admin/v1/clients/${CLIENT}/delivery-config`), true);
  assert.equal(staffWorkspaceAdminApiAllowed(WORKSPACE, "GET", `/admin/v1/clients/${CLIENT}/delivery-config`), true);
  assert.equal(staffWorkspaceAdminApiAllowed([], "GET", `/admin/v1/clients/${CLIENT}/delivery-config`), false);
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "GET", "/portal/harbor_benefits"), false);
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "POST", `/admin/v1/clients/${CLIENT}/ghl-config`), false);
  assert.equal(staffWorkspaceAdminApiAllowed(OPERATIONS, "POST", `/admin/v1/clients/${CLIENT}/ghl-config`), false);
  assert.equal(staffWorkspaceAdminApiAllowed([], "GET", "/admin/v1/clients"), false);
});

test("manager writes are the request paths and operations cannot use them", () => {
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "POST", "/admin/v1/clients"), true);
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "PATCH", `/admin/v1/clients/${CLIENT}`), true);
  assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, "PATCH", `/admin/v1/clients/${CLIENT}/setup`), true);
  assert.equal(
    staffWorkspaceAdminApiAllowed(MANAGER, "POST", `/admin/v1/clients/${CLIENT}/ghl-destination-configuration`),
    true
  );
  assert.equal(
    staffWorkspaceAdminApiAllowed(MANAGER, "POST", `/admin/v1/clients/${CLIENT}/company-sheets-destination-configuration`),
    true
  );
  assert.equal(staffWorkspaceAdminApiAllowed(OPERATIONS, "POST", "/admin/v1/clients"), false);
  assert.equal(staffWorkspaceAdminApiAllowed(OPERATIONS, "PATCH", `/admin/v1/clients/${CLIENT}/setup`), false);
  assert.equal(staffWorkspaceAdminApiAllowed(WORKSPACE, "POST", `/admin/v1/clients/${CLIENT}/source-campaign-requests`), false);
});

test("delivery, correction, diagnostics, and path tricks stay closed", () => {
  const denied = [
    ["POST", `/admin/v1/clients/${CLIENT}/ghl-destination/activate-ongoing`],
    ["POST", `/admin/v1/clients/${CLIENT}/ghl-destination/test-delivery`],
    ["POST", `/admin/v1/clients/${CLIENT}/ghl-config`],
    ["DELETE", `/admin/v1/clients/${CLIENT}`],
    ["GET", "/admin/v1/metrics/summary"],
    ["GET", "/admin/v1/command-center"],
    ["POST", "/admin/v1/facebook-association-correction"],
    ["GET", "/admin/v1/staff/team/members"],
    ["GET", `/admin/v1/clients/${CLIENT}/setup/../ghl-destination/activate-ongoing`],
    ["GET", "/admin/v1/clients/../metrics/summary"],
    ["GET", "/admin/v1//clients"],
    ["GET", "/admin/v1/metrics/summary?path=/admin/v1/clients"],
    ["POST", `/admin/v1/clients/%2e%2e/metrics/summary`],
  ] as const;
  for (const [method, path] of denied) {
    assert.equal(staffWorkspaceAdminApiAllowed(MANAGER, method, path), false, `${method} ${path}`);
  }
  assert.equal(
    staffWorkspaceAdminApiAllowed(MANAGER, "GET", `/admin/v1/clients/${CLIENT}/setup?next=/admin/v1/metrics/summary`),
    true
  );
});

test("team workspace loads and delegated actions keep their flags and do not attach the admin key themselves", () => {
  const load = readFileSync(new URL("./team-workspace/load.ts", import.meta.url), "utf8");
  assert.match(load, /requireStaffWorkspacePermission\("team_workspace"\)/);
  assert.equal(load.includes("requireAdminCocAdminSession"), false);
  assert.match(load, /isTeamWorkspaceEnabled/);
  const server = readFileSync(new URL("./admin-api/server.ts", import.meta.url), "utf8");
  assert.match(server, /staffWorkspaceAdminApiAllowed/);
  const team = readFileSync(new URL("../app/actions/team-management.ts", import.meta.url), "utf8");
  assert.equal(team.includes("SA360_ADMIN_API_KEY"), false);
  assert.equal(team.includes("NEXT_PUBLIC_"), false);
});
