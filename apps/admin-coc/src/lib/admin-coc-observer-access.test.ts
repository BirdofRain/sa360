import assert from "node:assert/strict";
import test from "node:test";

import {
  isAdminCocObserverLoginAvailable,
  isAdminCocPasswordConfigured,
} from "./admin-coc-auth.ts";
import {
  ADMIN_COC_ROLE_ADMIN,
  ADMIN_COC_ROLE_OBSERVER,
  isObserverAdminApiGetAllowed,
  isObserverBffReadAllowed,
  isObserverDocumentPath,
  observerLandingPath,
} from "./admin-coc-observer-access.ts";
import { resolveAdminCocRouteGate, type AdminCocRouteGateInput } from "./admin-coc-route-gate.ts";
import { parseAdminCocSessionTokenEdge } from "./admin-coc-session-edge.ts";
import {
  ADMIN_COC_SESSION_VERSION,
  createAdminCocSessionToken,
  parseAdminCocSessionToken,
} from "./admin-coc-session.ts";

const SECRET = "admin-coc-session-secret-32b";

function gateOn(): void {
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  delete process.env.ADMIN_COC_OBSERVER_PASSWORD;
}

const OBSERVER_BASE: Omit<AdminCocRouteGateInput, "pathname"> = {
  host: "admin.example",
  marketingHostsEnv: "preview.example",
  adminPasswordConfigured: true,
  hasAdminSession: false,
  adminSessionRole: ADMIN_COC_ROLE_OBSERVER,
  hasValidPortalSession: false,
  clientPortalLiveConfigured: true,
  frontOfficeDevPreview: false,
  portalAccessQuery: false,
};

test("legacy ac1 admin tokens without role stay ADMIN", async (t) => {
  const snap = process.env.ADMIN_COC_SESSION_SECRET;
  t.after(() => {
    if (snap === undefined) delete process.env.ADMIN_COC_SESSION_SECRET;
    else process.env.ADMIN_COC_SESSION_SECRET = snap;
  });
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;

  const legacy = createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_ADMIN, {
    omitRole: true,
  });
  assert.ok(legacy);
  assert.equal(legacy.startsWith(`${ADMIN_COC_SESSION_VERSION}.`), true);
  const body = JSON.parse(Buffer.from(legacy.split(".")[1]!, "base64url").toString("utf8")) as {
    role?: string;
  };
  assert.equal(body.role, undefined);
  assert.equal(parseAdminCocSessionToken(legacy)?.role, ADMIN_COC_ROLE_ADMIN);
  assert.equal(await parseAdminCocSessionTokenEdge(legacy), ADMIN_COC_ROLE_ADMIN);

  const stamped = createAdminCocSessionToken();
  assert.equal(parseAdminCocSessionToken(stamped)?.role, ADMIN_COC_ROLE_ADMIN);
});

test("observer tokens verify and a tampered role fails", async (t) => {
  const snap = process.env.ADMIN_COC_SESSION_SECRET;
  t.after(() => {
    if (snap === undefined) delete process.env.ADMIN_COC_SESSION_SECRET;
    else process.env.ADMIN_COC_SESSION_SECRET = snap;
  });
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;

  const token = createAdminCocSessionToken(undefined, SECRET, ADMIN_COC_ROLE_OBSERVER);
  assert.equal(parseAdminCocSessionToken(token)?.role, ADMIN_COC_ROLE_OBSERVER);
  assert.equal(await parseAdminCocSessionTokenEdge(token), ADMIN_COC_ROLE_OBSERVER);

  const parts = token!.split(".");
  const forgedBody = Buffer.from(
    JSON.stringify({
      ...JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")),
      role: ADMIN_COC_ROLE_ADMIN,
    }),
    "utf8"
  ).toString("base64url");
  const forged = `${parts[0]}.${forgedBody}.${parts[2]}`;
  assert.equal(parseAdminCocSessionToken(forged), null);
  assert.equal(await parseAdminCocSessionTokenEdge(forged), null);
});

test("observer login is unavailable unless a distinct password is configured", (t) => {
  const keys = ["ADMIN_COC_PASSWORD", "ADMIN_COC_SESSION_SECRET", "ADMIN_COC_OBSERVER_PASSWORD"] as const;
  const snap = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (snap[key] === undefined) delete process.env[key];
      else process.env[key] = snap[key];
    }
  });
  gateOn();
  assert.equal(isAdminCocObserverLoginAvailable(), false);
  process.env.ADMIN_COC_OBSERVER_PASSWORD = "operator-password";
  assert.equal(isAdminCocObserverLoginAvailable(), false);
  process.env.ADMIN_COC_OBSERVER_PASSWORD = "observer-password";
  assert.equal(isAdminCocObserverLoginAvailable(), true);
  assert.equal(isAdminCocPasswordConfigured(), true);
});

test("observer route gate allowlists diagnostics and forbids mutations", () => {
  const allow = (pathname: string, method?: string) =>
    resolveAdminCocRouteGate({ ...OBSERVER_BASE, pathname, method });
  assert.equal(allow("/webhooks").kind, "allow");
  assert.equal(allow("/source-intake").kind, "allow");
  assert.equal(allow("/", "GET").kind, "allow");
  assert.deepEqual(allow("/api/lead-inventory/review/summary", "GET"), {
    kind: "allow",
    attachAgentWorkspaceCsp: false,
  });
  assert.deepEqual(allow("/api/lead-inventory/review/actions/preview", "POST"), {
    kind: "forbidden",
    surface: "api",
  });
  assert.deepEqual(allow("/api/fulfillment-ops/orders", "GET"), {
    kind: "forbidden",
    surface: "api",
  });
  assert.deepEqual(allow("/api/fulfillment-ops/allocations/a/reserve", "POST"), {
    kind: "forbidden",
    surface: "api",
  });
  assert.deepEqual(allow("/clients"), { kind: "forbidden", surface: "document" });
  assert.deepEqual(allow("/flags"), { kind: "forbidden", surface: "document" });
  assert.deepEqual(allow("/agent-workspace"), { kind: "forbidden", surface: "document" });
  assert.deepEqual(allow("/source-intake/imports"), { kind: "forbidden", surface: "document" });
  assert.deepEqual(allow("/api/agent-workspace/context", "GET"), {
    kind: "forbidden",
    surface: "api",
  });
  assert.equal(allow("/login").kind, "allow");
  assert.equal(allow("/portal/login").kind, "allow");
  assert.equal(resolveAdminCocRouteGate({ ...OBSERVER_BASE, pathname: "/portal" }).kind, "redirect");
  assert.equal(
    resolveAdminCocRouteGate({ ...OBSERVER_BASE, pathname: "/front-office" }).kind,
    "redirect"
  );
  assert.equal(
    resolveAdminCocRouteGate({ ...OBSERVER_BASE, pathname: "/get-started" }).kind,
    "allow"
  );
});

test("anonymous operator routes still redirect and admin sessions stay open", () => {
  const anon = resolveAdminCocRouteGate({
    ...OBSERVER_BASE,
    adminSessionRole: null,
    pathname: "/webhooks",
  });
  assert.equal(anon.kind, "redirect");
  const admin = resolveAdminCocRouteGate({
    ...OBSERVER_BASE,
    hasAdminSession: true,
    adminSessionRole: ADMIN_COC_ROLE_ADMIN,
    pathname: "/clients",
  });
  assert.equal(admin.kind, "allow");
  const legacyFlag = resolveAdminCocRouteGate({
    ...OBSERVER_BASE,
    hasAdminSession: true,
    adminSessionRole: undefined,
    pathname: "/flags",
  });
  assert.equal(legacyFlag.kind, "allow");
});

test("admin API key allowlist is read-only and excludes secrets", () => {
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/webhook-requests?limit=10"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/lead-timeline?leadUid=x"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/source-leads/lead_1"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/routing/dry-run-decisions/d1/delivery-plan"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/delivery-runtime-mode"), true);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/source-leads/lead_1/reject"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/source-leads/lead_1/approve-delivery"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/clients/c1"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/ghl/oauth/debug"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/ghl/connections"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/fulfillment-ops/orders"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/routing/rules/r1/delivery-config"), false);
  assert.equal(isObserverBffReadAllowed("GET", "/api/lead-inventory/review/items/item_1"), true);
  assert.equal(isObserverBffReadAllowed("POST", "/api/lead-inventory/review/actions/commit"), false);
  assert.equal(isObserverBffReadAllowed("GET", "/api/lead-inventory/review/actions/req-1"), true);
  assert.equal(isObserverBffReadAllowed("POST", "/api/lead-inventory/review/actions/preview"), false);
  assert.equal(isObserverDocumentPath("/source-intake/imports"), false);
  assert.equal(isObserverDocumentPath("/webhooks/future"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/../clients"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/%2e%2e/clients"), false);
  assert.equal(isObserverAdminApiGetAllowed("/admin/v1/coc/future-endpoint"), false);
  assert.equal(observerLandingPath("/clients"), "/webhooks");
  assert.equal(observerLandingPath("/webhooks?live=1"), "/webhooks?live=1");
});
