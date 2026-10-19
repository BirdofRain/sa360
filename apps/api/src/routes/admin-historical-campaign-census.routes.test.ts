import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../app.js";
import { PROVENANCE_AUDIT_KEY_HEADER } from "../lib/provenance-audit-auth.js";

const AUDIT_KEY = "audit-only-key-0123456789";
const ADMIN_KEY = "admin-key-0123456789abc";
const CENSUS = "/admin/v1/fulfillment-ops/historical-campaign-census";
const ORDER = "/admin/v1/fulfillment-ops/historical-campaign-orders/LO-1053";

const OTHER_ROUTES = [
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/orders/order_1/selection/commit" },
  { method: "POST" as const, url: "/admin/v1/fulfillment-ops/allocations/alloc_1/release" },
  { method: "GET" as const, url: "/admin/v1/fulfillment-ops/orders" },
  { method: "GET" as const, url: "/admin/v1/fulfillment-ops/bootstrap" },
];

function saveEnv() {
  return {
    flag: process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED,
    auditFlag: process.env.SA360_PROVENANCE_AUDIT_ENABLED,
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
  assign("SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED", prev.flag);
  assign("SA360_PROVENANCE_AUDIT_ENABLED", prev.auditFlag);
  assign("SA360_AUDIT_READONLY_KEY", prev.audit);
  assign("ADMIN_API_KEY", prev.admin);
  assign("SA360_ADMIN_KEY", prev.alias);
}

test("disabled historical census routes are 404 and contain no counts", async () => {
  const app = await buildApp();
  const prev = saveEnv();
  delete process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_AUDIT_READONLY_KEY = AUDIT_KEY;
  process.env.SA360_PROVENANCE_AUDIT_ENABLED = "true";
  try {
    for (const url of [CENSUS, ORDER]) {
      for (const headers of [
        {},
        { "x-sa360-admin-key": ADMIN_KEY },
        { [PROVENANCE_AUDIT_KEY_HEADER]: AUDIT_KEY },
      ]) {
        const res = await app.inject({ method: "GET", url, headers });
        assert.equal(res.statusCode, 404);
        assert.equal(res.json().code, "historical_campaign_census_disabled");
        assert.equal(JSON.stringify(res.json()).includes("inventoryRows"), false);
        assert.equal(JSON.stringify(res.json()).includes("LO-1053"), false);
      }
    }
  } finally {
    restoreEnv(prev);
    await app.close();
  }
});

test("enabled historical census routes reject the audit credential and filters", async () => {
  const app = await buildApp();
  const prev = saveEnv();
  process.env.SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED = "true";
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_AUDIT_READONLY_KEY = AUDIT_KEY;
  delete process.env.SA360_PROVENANCE_AUDIT_ENABLED;
  try {
    const auditOnCensus = await app.inject({
      method: "GET",
      url: CENSUS,
      headers: { [PROVENANCE_AUDIT_KEY_HEADER]: AUDIT_KEY },
    });
    assert.equal(auditOnCensus.statusCode, 401);

    const auditOnOrder = await app.inject({
      method: "GET",
      url: ORDER,
      headers: { [PROVENANCE_AUDIT_KEY_HEADER]: AUDIT_KEY },
    });
    assert.equal(auditOnOrder.statusCode, 401);

    const auditKeyAsAdmin = await app.inject({
      method: "GET",
      url: CENSUS,
      headers: { "x-sa360-admin-key": AUDIT_KEY },
    });
    assert.equal(auditKeyAsAdmin.statusCode, 401);

    const filtered = await app.inject({
      method: "GET",
      url: `${CENSUS}?label=secret`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(filtered.statusCode, 400);
    assert.equal(filtered.json().code, "historical_campaign_census_filters_rejected");

    const filteredOrder = await app.inject({
      method: "GET",
      url: `${ORDER}?include=payload`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(filteredOrder.statusCode, 400);

    const invalid = await app.inject({
      method: "GET",
      url: "/admin/v1/fulfillment-ops/historical-campaign-orders/lo-1053",
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().code, "historical_order_number_invalid");

    const posted = await app.inject({
      method: "POST",
      url: CENSUS,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { originClientAccountId: "client_x" },
    });
    assert.equal(posted.statusCode, 404);

    for (const url of [
      "/admin/v1/historical-campaign-associations/ownership-previews",
      "/admin/v1/historical-campaign-associations/ownership-confirmations",
      "/admin/v1/historical-campaign-associations/ownership-reassignments",
      "/admin/v1/historical-campaign-resale/previews",
      "/admin/v1/historical-campaign-resale/confirmations",
    ]) {
      const future = await app.inject({
        method: "POST",
        url,
        headers: { "x-sa360-admin-key": ADMIN_KEY },
        payload: { originClientAccountId: "client_x" },
      });
      assert.equal(future.statusCode, 404, url);
    }

    const provenanceOff = await app.inject({
      method: "GET",
      url: "/admin/v1/fulfillment-ops/provenance-impact",
      headers: { [PROVENANCE_AUDIT_KEY_HEADER]: AUDIT_KEY },
    });
    assert.equal(provenanceOff.statusCode, 404);
    assert.equal(provenanceOff.json().code, "provenance_impact_audit_disabled");
    assert.equal(JSON.stringify(provenanceOff.json()).includes("inventoryRows"), false);

    for (const target of OTHER_ROUTES) {
      const res = await app.inject({
        method: target.method,
        url: target.url,
        headers: { [PROVENANCE_AUDIT_KEY_HEADER]: AUDIT_KEY },
        payload: target.method === "POST" ? { clientAccountId: "client_x" } : undefined,
      });
      assert.equal(res.statusCode, 401, `${target.method} ${target.url}`);
    }
  } finally {
    restoreEnv(prev);
    await app.close();
  }
});
