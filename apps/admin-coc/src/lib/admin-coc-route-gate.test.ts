import assert from "node:assert/strict";
import test from "node:test";

import {
  isAdminCocOAuthCallbackPath,
  isAgentWorkspaceDocumentPath,
  resolveAdminCocRouteGate,
  type AdminCocRouteGateDecision,
  type AdminCocRouteGateInput,
} from "./admin-coc-route-gate.ts";

const ADMIN_HOST = {
  host: "admin.example",
  marketingHostsEnv: "preview.example,www.preview.example",
};

const MARKETING_HOST = {
  forwardedHost: "Preview.Example:443",
  marketingHostsEnv: "preview.example,www.preview.example",
};

const UNAUTH_ADMIN: Omit<AdminCocRouteGateInput, "pathname"> = {
  ...ADMIN_HOST,
  adminPasswordConfigured: true,
  hasAdminSession: false,
  hasValidPortalSession: false,
  clientPortalLiveConfigured: true,
  frontOfficeDevPreview: false,
  portalAccessQuery: false,
};

const AUTH_ADMIN: Omit<AdminCocRouteGateInput, "pathname"> = {
  ...UNAUTH_ADMIN,
  hasAdminSession: true,
};

const MARKETING: Omit<AdminCocRouteGateInput, "pathname"> = {
  ...MARKETING_HOST,
  adminPasswordConfigured: true,
  hasAdminSession: false,
  hasValidPortalSession: false,
  clientPortalLiveConfigured: true,
  frontOfficeDevPreview: false,
  portalAccessQuery: false,
};

function decision(
  base: Omit<AdminCocRouteGateInput, "pathname">,
  pathname: string,
  extra: Partial<AdminCocRouteGateInput> = {}
): AdminCocRouteGateDecision {
  return resolveAdminCocRouteGate({ ...base, pathname, ...extra });
}

function assertRedirect(
  actual: AdminCocRouteGateDecision,
  pathname: string,
  next?: string,
  label?: string
): void {
  assert.equal(actual.kind, "redirect", label);
  if (actual.kind !== "redirect") return;
  assert.equal(actual.pathname, pathname, label);
  assert.equal(actual.next, next, label);
}

function assertAllow(
  actual: AdminCocRouteGateDecision,
  attachAgentWorkspaceCsp = false,
  label?: string
): void {
  assert.deepEqual(
    actual,
    { kind: "allow", attachAgentWorkspaceCsp },
    label
  );
}

test("agent-workspace document paths are the only CSP targets", () => {
  assert.equal(isAgentWorkspaceDocumentPath("/agent-workspace"), true);
  assert.equal(isAgentWorkspaceDocumentPath("/agent-workspace/extra"), true);
  assert.equal(isAgentWorkspaceDocumentPath("/api/agent-workspace/context"), false);
  assert.equal(isAgentWorkspaceDocumentPath("/action-center"), false);
  assert.equal(isAdminCocOAuthCallbackPath("/integrations/oauth/callback"), true);
  assert.equal(isAdminCocOAuthCallbackPath("/integrations/ghl/oauth/callback"), true);
});

test("unauthenticated admin hostname: operator routes require the Admin C.O.C. cookie", () => {
  assertRedirect(
    decision(UNAUTH_ADMIN, "/action-center"),
    "/login",
    "/action-center",
    "/action-center"
  );
  assertRedirect(
    decision(UNAUTH_ADMIN, "/action-center", { search: "?clientAccountId=demo" }),
    "/login",
    "/action-center?clientAccountId=demo",
    "/action-center with query"
  );
  assertRedirect(
    decision(UNAUTH_ADMIN, "/agent-workspace"),
    "/login",
    "/agent-workspace",
    "/agent-workspace"
  );
  assertRedirect(
    decision(UNAUTH_ADMIN, "/agent-workspace", {
      search: "?clientAccountId=acct&locationId=loc_1",
    }),
    "/login",
    "/agent-workspace?clientAccountId=acct&locationId=loc_1",
    "/agent-workspace with query"
  );
  assertRedirect(decision(UNAUTH_ADMIN, "/clients"), "/login", "/clients", "/clients");
  assertRedirect(decision(UNAUTH_ADMIN, "/"), "/login", undefined, "/");
  assertRedirect(
    decision(UNAUTH_ADMIN, "/source-intake"),
    "/login",
    "/source-intake",
    "unknown-to-visitor operator page"
  );
  assertRedirect(
    decision(UNAUTH_ADMIN, "/not-a-real-admin-page"),
    "/login",
    "/not-a-real-admin-page",
    "unknown admin route fail-closed"
  );

  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/agent-workspace/context"), {
    kind: "unauthorized",
  });
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/agent-workspace/actions/what-happened"), {
    kind: "unauthorized",
  });
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/action-dashboard/actions"), {
    kind: "unauthorized",
  });
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/fulfillment-ops/orders"), {
    kind: "unauthorized",
  });
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/lead-inventory/review/summary"), {
    kind: "unauthorized",
  });
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/unknown-admin-bff"), {
    kind: "unauthorized",
  });
});

test("unauthenticated admin hostname: Front Office, login, marketing, portal, and OAuth", () => {
  assertRedirect(
    decision(UNAUTH_ADMIN, "/front-office"),
    "/front-office/login-chooser",
    "/front-office"
  );
  assertRedirect(
    decision(UNAUTH_ADMIN, "/front-office/orders"),
    "/front-office/login-chooser",
    "/front-office/orders"
  );
  assertAllow(decision(UNAUTH_ADMIN, "/front-office/login-chooser"));
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/front-office/orders"), {
    kind: "unauthorized",
  });
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/front-office/dashboard"), {
    kind: "unauthorized",
  });

  assertAllow(decision(UNAUTH_ADMIN, "/login"));
  assertAllow(decision(UNAUTH_ADMIN, "/get-started"));
  assertAllow(decision(UNAUTH_ADMIN, "/get-started/register"));
  assertRedirect(
    decision(UNAUTH_ADMIN, "/get-started/setup"),
    "/get-started/register",
    undefined
  );
  assertAllow(
    decision(UNAUTH_ADMIN, "/get-started/setup", { clientPortalLiveConfigured: false })
  );

  assertAllow(decision(UNAUTH_ADMIN, "/portal/login"));
  assertAllow(decision(UNAUTH_ADMIN, "/portal/forgot-password"));
  assertAllow(decision(UNAUTH_ADMIN, "/portal/invite/token"));
  assertRedirect(decision(UNAUTH_ADMIN, "/portal"), "/portal/login", "/portal");
  assertRedirect(
    decision(UNAUTH_ADMIN, "/portal/orders"),
    "/portal/login",
    "/portal/orders"
  );
  assertAllow(
    decision(UNAUTH_ADMIN, "/portal", { portalAccessQuery: true })
  );
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/client-portal/dashboard"), {
    kind: "unauthorized",
  });
  assert.deepEqual(decision(UNAUTH_ADMIN, "/api/client-portal/orders"), {
    kind: "unauthorized",
  });
  assertAllow(
    decision(UNAUTH_ADMIN, "/portal/orders", { clientPortalLiveConfigured: false })
  );

  assertAllow(decision(UNAUTH_ADMIN, "/integrations/oauth/callback"));
  assertAllow(decision(UNAUTH_ADMIN, "/integrations/ghl/oauth/callback"));
});

test("authenticated admin hostname: operator surfaces allow; workspace HTML keeps CSP", () => {
  assertAllow(decision(AUTH_ADMIN, "/action-center"));
  assertAllow(decision(AUTH_ADMIN, "/action-center", { search: "?clientAccountId=demo" }));
  assertAllow(decision(AUTH_ADMIN, "/agent-workspace"), true);
  assertAllow(
    decision(AUTH_ADMIN, "/agent-workspace", { search: "?clientAccountId=acct" }),
    true
  );
  assertAllow(decision(AUTH_ADMIN, "/api/agent-workspace/context"));
  assertAllow(decision(AUTH_ADMIN, "/api/agent-workspace/actions/what-happened"));
  assertAllow(decision(AUTH_ADMIN, "/api/action-dashboard/actions"));
  assertAllow(decision(AUTH_ADMIN, "/clients"));
  assertAllow(decision(AUTH_ADMIN, "/"));
  assertAllow(decision(AUTH_ADMIN, "/source-intake"));
  assertAllow(decision(AUTH_ADMIN, "/not-a-real-admin-page"));
  assertAllow(decision(AUTH_ADMIN, "/front-office"));
  assertAllow(decision(AUTH_ADMIN, "/front-office/orders"));
  assertAllow(decision(AUTH_ADMIN, "/api/front-office/orders"));
  assertAllow(decision(AUTH_ADMIN, "/login"));
  assertAllow(decision(AUTH_ADMIN, "/get-started"));
  assertAllow(decision(AUTH_ADMIN, "/get-started/register"));
  assertRedirect(
    decision(AUTH_ADMIN, "/get-started/setup"),
    "/get-started/register",
    undefined,
    "setup still needs a portal session, not the admin cookie"
  );
  assertAllow(decision(AUTH_ADMIN, "/integrations/oauth/callback"));
});

test("authenticated admin hostname: portal still uses the portal session", () => {
  assertRedirect(decision(AUTH_ADMIN, "/portal"), "/portal/login", "/portal");
  assert.deepEqual(decision(AUTH_ADMIN, "/api/client-portal/dashboard"), {
    kind: "unauthorized",
  });
  assertAllow(
    decision(AUTH_ADMIN, "/portal", { hasValidPortalSession: true })
  );
  assertAllow(
    decision(AUTH_ADMIN, "/api/client-portal/dashboard", { hasValidPortalSession: true })
  );
  assertAllow(
    decision(AUTH_ADMIN, "/get-started/setup", { hasValidPortalSession: true })
  );
});

test("public marketing hostname: Admin C.O.C. is 404 even with an admin cookie", () => {
  const authedMarketing = { ...MARKETING, hasAdminSession: true };
  const blocked = [
    "/login",
    "/action-center",
    "/agent-workspace",
    "/front-office",
    "/front-office/login-chooser",
    "/clients",
    "/source-intake",
    "/api/front-office/orders",
    "/api/agent-workspace/context",
    "/api/action-dashboard/actions",
    "/api/fulfillment-ops/orders",
    "/integrations/oauth/callback",
    "/dev/portal-journey",
  ];
  for (const pathname of blocked) {
    assert.deepEqual(decision(authedMarketing, pathname), { kind: "not-found" }, pathname);
    assert.deepEqual(decision(MARKETING, pathname), { kind: "not-found" }, `${pathname} unauth`);
  }

  assert.deepEqual(decision(MARKETING, "/"), {
    kind: "rewrite",
    pathname: "/get-started",
  });
  assertAllow(decision(MARKETING, "/get-started"));
  assertAllow(decision(MARKETING, "/get-started/register"));
  assertRedirect(
    decision(MARKETING, "/get-started/setup"),
    "/get-started/register",
    undefined
  );
  assertAllow(decision(MARKETING, "/portal/login"));
  assertRedirect(decision(MARKETING, "/portal"), "/portal/login", "/portal");
  assertRedirect(
    decision(MARKETING, "/portal/orders/new"),
    "/portal/login",
    "/portal/orders/new"
  );
  assert.deepEqual(decision(MARKETING, "/api/client-portal/dashboard"), {
    kind: "unauthorized",
  });
  assertAllow(
    decision(MARKETING, "/portal/orders/new", { hasValidPortalSession: true })
  );
  assertAllow(
    decision(MARKETING, "/api/client-portal/dashboard", { hasValidPortalSession: true })
  );
});

test("unset ADMIN_COC_PASSWORD fail-opens local admin pages but still 401s Front Office BFF without a session", () => {
  const local = { ...UNAUTH_ADMIN, adminPasswordConfigured: false };
  assertAllow(decision(local, "/action-center"));
  assertAllow(decision(local, "/agent-workspace"), true);
  assertAllow(decision(local, "/clients"));
  assertAllow(decision(local, "/api/agent-workspace/context"));
  assertRedirect(
    decision(local, "/front-office"),
    "/front-office/login-chooser",
    "/front-office"
  );
  assert.deepEqual(decision(local, "/api/front-office/orders"), { kind: "unauthorized" });
});

test("Front Office dev preview does not unlock Admin C.O.C. operator routes", () => {
  const preview = { ...UNAUTH_ADMIN, frontOfficeDevPreview: true };
  assertAllow(decision(preview, "/front-office"));
  assertAllow(decision(preview, "/api/front-office/orders"));
  assertRedirect(decision(preview, "/action-center"), "/login", "/action-center");
  assertRedirect(decision(preview, "/clients"), "/login", "/clients");
  assert.deepEqual(decision(preview, "/api/agent-workspace/context"), {
    kind: "unauthorized",
  });
});
