import assert from "node:assert/strict";
import test from "node:test";

import { ADMIN_COC_ROLE_ADMIN } from "./admin-coc-observer-access.ts";
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
    const decision = gate(pathname);
    assert.equal(decision.kind, "redirect", pathname);
    if (decision.kind !== "redirect") continue;
    assert.equal(decision.pathname, "/meta-review", pathname);
    assert.equal(decision.next, undefined, pathname);
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
});

test("local fail-open does not promote a reviewer cookie to operator access", () => {
  const decision = gate("/clients", { adminPasswordConfigured: false });
  assert.equal(decision.kind, "redirect");
  if (decision.kind === "redirect") {
    assert.equal(decision.pathname, "/meta-review");
    assert.equal(decision.next, undefined);
  }
});
