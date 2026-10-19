import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../app.js";
import { getAdminApiKey } from "../lib/admin-auth.js";

const AUDIT_KEY = "audit-only-key-0123456789";
const ADMIN_KEY = "admin-key-0123456789abc";
const ROUTE = "/admin/v1/fulfillment-ops/provenance-impact";

const WRITE_ROUTES = [
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/client-lead-orders" },
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/demo-orders" },
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/orders/order_1/selection/commit" },
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/orders/order_1/selection/preview" },
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/allocations/alloc_1/reserve" },
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/allocations/alloc_1/release" },
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/prepare-candidate" },
  { method: "GET" as const, url: "/admin/v1/fulfillment-ops/orders" },
  { method: "GET" as const, url: "/admin/v1/fulfillment-ops/bootstrap" },
  { method: "POST" as const, url: "/admin/v1/lead-inventory/review/actions/commit" },
];

function saveEnv() {
  return {
    flag: process.env.SA360_PROVENANCE_AUDIT_ENABLED,
    audit: process.env.SA360_AUDIT_READONLY_KEY,
    admin: process.env.ADMIN_API_KEY,
    alias: process.env.SA360_ADMIN_KEY,
  };
}

function restoreEnv(prev: ReturnType<typeof saveEnv>) {
  const assign = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  assign("SA360_PROVENANCE_AUDIT_ENABLED", prev.flag);
  assign("SA360_AUDIT_READONLY_KEY", prev.audit);
  assign("ADMIN_API_KEY", prev.admin);
  assign("SA360_ADMIN_KEY", prev.alias);
}

test("disabled provenance impact route is 404 for every credential", async () => {
  const app = await buildApp();
  const prev = saveEnv();
  delete process.env.SA360_PROVENANCE_AUDIT_ENABLED;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_AUDIT_READONLY_KEY = AUDIT_KEY;
  try {
    for (const headers of [
      {},
      { "x-sa360-admin-key": ADMIN_KEY },
      { "x-sa360-provenance-audit-key": AUDIT_KEY },
    ]) {
      const res = await app.inject({ method: "GET", url: ROUTE, headers });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().code, "provenance_impact_audit_disabled");
      assert.equal(JSON.stringify(res.json()).includes("availableBeforeGate"), false);
    }
  } finally {
    restoreEnv(prev);
    await app.close();
  }
});

test("enabled provenance impact route rejects missing credentials, filters, and the audit key on other routes", async () => {
  const app = await buildApp();
  const prev = saveEnv();
  process.env.SA360_PROVENANCE_AUDIT_ENABLED = "true";
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_AUDIT_READONLY_KEY = AUDIT_KEY;
  try {
    const anonymous = await app.inject({ method: "GET", url: ROUTE });
    assert.equal(anonymous.statusCode, 401);

    const wrong = await app.inject({
      method: "GET",
      url: ROUTE,
      headers: { "x-sa360-provenance-audit-key": "not-the-audit-key-0123" },
    });
    assert.equal(wrong.statusCode, 401);

    const auditKeyAsAdmin = await app.inject({
      method: "GET",
      url: ROUTE,
      headers: { "x-sa360-admin-key": AUDIT_KEY },
    });
    assert.equal(auditKeyAsAdmin.statusCode, 401);

    const adminKeyAsAudit = await app.inject({
      method: "GET",
      url: ROUTE,
      headers: { "x-sa360-provenance-audit-key": ADMIN_KEY },
    });
    assert.equal(adminKeyAsAudit.statusCode, 401);

    const filtered = await app.inject({
      method: "GET",
      url: `${ROUTE}?niche=trucker&table=LeadInventoryItem`,
      headers: { "x-sa360-admin-key": getAdminApiKey()! },
    });
    assert.equal(filtered.statusCode, 400);
    assert.equal(filtered.json().code, "provenance_impact_filters_rejected");

    for (const target of WRITE_ROUTES) {
      const res = await app.inject({
        method: target.method,
        url: target.url,
        headers: { "x-sa360-provenance-audit-key": AUDIT_KEY },
        payload: target.method === "POST" ? { clientAccountId: "client_x" } : undefined,
      });
      assert.equal(res.statusCode, 401, `${target.method} ${target.url}`);
      assert.equal(JSON.stringify(res.json()).includes(AUDIT_KEY), false);
    }

    const postAudit = await app.inject({
      method: "POST",
      url: ROUTE,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { sql: "UPDATE LeadInventoryItem SET status = 'available'" },
    });
    assert.equal(postAudit.statusCode, 404);
  } finally {
    restoreEnv(prev);
    await app.close();
  }
});

test("provenance impact has no credentials when both secrets are unset", async () => {
  const app = await buildApp();
  const prev = saveEnv();
  process.env.SA360_PROVENANCE_AUDIT_ENABLED = "true";
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  delete process.env.SA360_AUDIT_READONLY_KEY;
  try {
    const res = await app.inject({ method: "GET", url: ROUTE });
    assert.equal(res.statusCode, 503);
    assert.match(res.json().error, /not configured/);
  } finally {
    restoreEnv(prev);
    await app.close();
  }
});
