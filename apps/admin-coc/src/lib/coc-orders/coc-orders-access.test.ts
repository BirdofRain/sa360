import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { isNavItemActive } from "../bulk-imports/nav-active.ts";
import {
  ADMIN_COC_ROLE_ADMIN,
  ADMIN_COC_ROLE_OBSERVER,
  isObserverBffReadAllowed,
  isObserverDocumentPath,
} from "../admin-coc-observer-access.ts";
import { resolveAdminCocRouteGate, type AdminCocRouteGateInput } from "../admin-coc-route-gate.ts";
import { COC_ORDERS_HREF, configurationNav, operationsNav, planningNav } from "../nav.ts";
import { resolvePageMeta } from "../page-meta.ts";

const OBSERVER: Omit<AdminCocRouteGateInput, "pathname"> = {
  host: "admin.example",
  marketingHostsEnv: "",
  adminPasswordConfigured: true,
  hasAdminSession: false,
  adminSessionRole: ADMIN_COC_ROLE_OBSERVER,
  hasValidPortalSession: false,
  clientPortalLiveConfigured: false,
  frontOfficeDevPreview: false,
};

const ADMIN: Omit<AdminCocRouteGateInput, "pathname"> = {
  ...OBSERVER,
  hasAdminSession: true,
  adminSessionRole: ADMIN_COC_ROLE_ADMIN,
};

const ANON: Omit<AdminCocRouteGateInput, "pathname"> = {
  ...OBSERVER,
  adminSessionRole: null,
};

test("Orders nav points at the COC page and does not activate Front Office", () => {
  const orders = operationsNav.find((item) => item.href === COC_ORDERS_HREF);
  assert.equal(orders?.label, "Orders");
  assert.equal(
    operationsNav.some((item) => item.href === "/front-office" && item.label === "Front Office"),
    true
  );
  const items = [...operationsNav, ...configurationNav, ...planningNav];
  assert.equal(isNavItemActive("/orders", COC_ORDERS_HREF, items), true);
  assert.equal(isNavItemActive("/orders", "/front-office", items), false);
  assert.equal(isNavItemActive("/front-office", "/front-office", items), true);
  assert.equal(isNavItemActive("/front-office/orders", "/front-office", items), true);
});

test("Orders page title is Orders and Front Office orders keep their own shell", () => {
  const meta = resolvePageMeta("/orders");
  assert.equal(meta.title, "Orders");
  assert.match(meta.description ?? "", /Fulfillment Ops/);
  assert.equal(resolvePageMeta("/front-office/orders").title, "Command Center");
});

test("observers are forbidden on COC orders while Front Office access stays unchanged", () => {
  assert.equal(isObserverDocumentPath("/orders"), false);
  assert.equal(isObserverDocumentPath("/front-office/orders"), false);
  assert.equal(isObserverBffReadAllowed("GET", "/api/coc/orders"), false);
  assert.equal(isObserverBffReadAllowed("POST", "/api/coc/orders/ord_1/approve"), false);
  assert.equal(
    operationsNav.filter((item) => isObserverDocumentPath(item.href)).some((item) => item.href === "/orders"),
    false
  );

  assert.deepEqual(resolveAdminCocRouteGate({ ...OBSERVER, pathname: "/orders" }), {
    kind: "forbidden",
    surface: "document",
  });
  assert.deepEqual(
    resolveAdminCocRouteGate({ ...OBSERVER, pathname: "/api/coc/orders", method: "GET" }),
    { kind: "forbidden", surface: "api" }
  );
  assert.deepEqual(
    resolveAdminCocRouteGate({
      ...OBSERVER,
      pathname: "/api/coc/orders/ord_1/approve",
      method: "POST",
    }),
    { kind: "forbidden", surface: "api" }
  );
  assert.deepEqual(
    resolveAdminCocRouteGate({
      ...OBSERVER,
      pathname: "/api/coc/orders/ord_1/confirm-payment",
      method: "POST",
    }),
    { kind: "forbidden", surface: "api" }
  );
  assert.deepEqual(
    resolveAdminCocRouteGate({
      ...OBSERVER,
      pathname: "/api/coc/orders/ord_1/mark-payment-not-required",
      method: "POST",
    }),
    { kind: "forbidden", surface: "api" }
  );

  assert.equal(resolveAdminCocRouteGate({ ...ADMIN, pathname: "/orders" }).kind, "allow");
  assert.equal(
    resolveAdminCocRouteGate({ ...ANON, pathname: "/orders" }).kind,
    "redirect"
  );
  assert.deepEqual(
    resolveAdminCocRouteGate({ ...ANON, pathname: "/api/coc/orders", method: "GET" }),
    { kind: "unauthorized" }
  );

  assert.deepEqual(resolveAdminCocRouteGate({ ...ANON, pathname: "/front-office/orders" }), {
    kind: "redirect",
    pathname: "/front-office/login-chooser",
    next: "/front-office/orders",
  });
  assert.equal(
    resolveAdminCocRouteGate({ ...ADMIN, pathname: "/front-office/orders" }).kind,
    "allow"
  );
  assert.equal(
    resolveAdminCocRouteGate({ ...OBSERVER, pathname: "/front-office/orders" }).kind,
    "redirect"
  );
  assert.deepEqual(
    resolveAdminCocRouteGate({ ...ANON, pathname: "/api/front-office/orders", method: "GET" }),
    { kind: "unauthorized" }
  );
});

test("the COC orders page and loader do not import preview orders", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const page = fs.readFileSync(path.join(root, "app/(dashboard)/orders/page.tsx"), "utf8");
  const loader = fs.readFileSync(path.join(root, "lib/coc-orders/load-coc-lead-orders.ts"), "utf8");
  for (const src of [page, loader]) {
    assert.doesNotMatch(src, /getMockOrders|getOrdersMockOnly|getLeadOrdersWithFallback|FoPreviewBanner/);
    assert.doesNotMatch(src, /SA360_FRONT_OFFICE_DEMO_MODE/);
  }
  assert.match(page, /requireAdminCocAdminSession/);
  assert.match(page, /loadCocLeadOrders/);
  assert.match(loader, /fetchAdminLeadOrdersList/);
  assert.match(loader, /mapApiLeadOrderToFrontOffice/);
});
