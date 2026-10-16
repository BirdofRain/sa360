import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_COC_ROLE_ADMIN, ADMIN_COC_ROLE_OBSERVER } from "./admin-coc-observer-access.ts";
import {
  resolveAdminCocRouteGate,
  type AdminCocRouteGateInput,
} from "./admin-coc-route-gate.ts";

const BASE: Omit<AdminCocRouteGateInput, "pathname"> = {
  host: "portal.lifeagentlaunch.com",
  marketingHostsEnv: "",
  adminPasswordConfigured: true,
  hasAdminSession: false,
  hasMetaReviewerSession: true,
  hasValidPortalSession: false,
  clientPortalLiveConfigured: true,
  frontOfficeDevPreview: false,
  portalAccessQuery: false,
};

function gate(pathname: string, extra: Partial<AdminCocRouteGateInput> = {}) {
  return resolveAdminCocRouteGate({ ...BASE, pathname, ...extra });
}

test("reviewer sessions stay inside the Meta review workspace", () => {
  assert.deepEqual(gate("/meta-review"), { kind: "allow", attachAgentWorkspaceCsp: false });
  assert.deepEqual(gate("/meta-review/login"), { kind: "allow", attachAgentWorkspaceCsp: false });
  assert.deepEqual(gate("/meta-review/logout"), { kind: "allow", attachAgentWorkspaceCsp: false });

  const documents = [
    "/action-center",
    "/clients",
    "/clients/demo",
    "/portal",
    "/portal/orders",
    "/lead-inventory",
    "/inventory",
    "/webhooks",
    "/lead-timeline",
    "/admin",
    "/settings",
    "/flags",
    "/feature-flags",
    "/fulfillment",
    "/orders",
    "/login",
    "/",
  ];
  for (const pathname of documents) {
    assert.deepEqual(
      gate(pathname),
      { kind: "forbidden", surface: "reviewer" },
      pathname
    );
  }

  for (const pathname of [
    "/api/agent-workspace",
    "/api/agent-workspace/context",
    "/api/client-portal/dashboard",
    "/api/lead-inventory/review/items",
  ]) {
    assert.deepEqual(gate(pathname, { method: "GET" }), {
      kind: "forbidden",
      surface: "api",
    });
  }

  assert.deepEqual(gate("/meta-review/../clients"), {
    kind: "forbidden",
    surface: "reviewer",
  });
  assert.deepEqual(gate("/meta-review/%2e%2e/clients"), {
    kind: "forbidden",
    surface: "reviewer",
  });
});

test("anonymous reviewer login stays public and operator routes stay on the admin login", () => {
  const anonymous = gate("/meta-review/login", { hasMetaReviewerSession: false });
  assert.deepEqual(anonymous, { kind: "allow", attachAgentWorkspaceCsp: false });

  const clients = gate("/clients", { hasMetaReviewerSession: false });
  assert.equal(clients.kind, "redirect");
  if (clients.kind === "redirect") assert.equal(clients.pathname, "/login");

  const workspace = gate("/meta-review", { hasMetaReviewerSession: false });
  assert.equal(workspace.kind, "redirect");
  if (workspace.kind === "redirect") assert.equal(workspace.pathname, "/login");
});

test("an admin session is not narrowed by a reviewer cookie", () => {
  const decision = gate("/action-center", {
    hasAdminSession: true,
    adminSessionRole: ADMIN_COC_ROLE_ADMIN,
    hasMetaReviewerSession: true,
  });
  assert.deepEqual(decision, { kind: "allow", attachAgentWorkspaceCsp: false });
  assert.deepEqual(
    gate("/meta-review", {
      hasAdminSession: true,
      adminSessionRole: ADMIN_COC_ROLE_ADMIN,
      hasMetaReviewerSession: true,
    }),
    { kind: "allow", attachAgentWorkspaceCsp: false }
  );
});

test("an observer cookie plus a reviewer cookie stays inside the review workspace", () => {
  const both = {
    hasAdminSession: false,
    adminSessionRole: ADMIN_COC_ROLE_OBSERVER,
    hasMetaReviewerSession: true,
  };
  assert.deepEqual(gate("/clients", both), { kind: "forbidden", surface: "reviewer" });
  assert.deepEqual(gate("/meta-review", both), { kind: "allow", attachAgentWorkspaceCsp: false });
});

test("local fail-open does not promote a reviewer cookie to operator access", () => {
  assert.deepEqual(gate("/clients", { adminPasswordConfigured: false }), {
    kind: "forbidden",
    surface: "reviewer",
  });
});
