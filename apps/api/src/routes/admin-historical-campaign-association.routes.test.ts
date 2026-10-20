import assert from "node:assert/strict";
import { test } from "node:test";

import { buildApp } from "../app.js";
import { PROVENANCE_AUDIT_KEY_HEADER } from "../lib/provenance-audit-auth.js";

const ADMIN_KEY = "admin-key-0123456789abc";
const AUDIT_KEY = "audit-only-key-0123456789";
const CATALOG = "/admin/v1/fulfillment-ops/historical-campaign-catalog";
const PREVIEW = "/admin/v1/historical-campaign-associations/ownership-previews";
const SECRET = "hop-secret-label-zz";

function saveEnv() {
  return {
    flag: process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED,
    admin: process.env.ADMIN_API_KEY,
    alias: process.env.SA360_ADMIN_KEY,
    audit: process.env.SA360_AUDIT_READONLY_KEY,
  };
}

function restoreEnv(prev: ReturnType<typeof saveEnv>) {
  const assign = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  assign("SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED", prev.flag);
  assign("ADMIN_API_KEY", prev.admin);
  assign("SA360_ADMIN_KEY", prev.alias);
  assign("SA360_AUDIT_READONLY_KEY", prev.audit);
}

test("association routes stay disabled before auth and do not echo labels", async () => {
  const app = await buildApp();
  const prev = saveEnv();
  delete process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED;
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  try {
    for (const url of [CATALOG, PREVIEW]) {
      const res = await app.inject({
        method: "POST",
        url,
        payload: { label: SECRET, lotKey: "lot_a", campaigns: [{ normalizedLabel: SECRET }] },
      });
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().code, "historical_campaign_association_disabled");
      assert.equal(res.body.includes(SECRET), false);
      assert.equal(res.body.includes("inventoryRows"), false);
    }
    const almost = await app.inject({
      method: "POST",
      url: PREVIEW,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
    });
    assert.equal(almost.statusCode, 404);
    process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED = "TRUE";
    const wrong = await app.inject({ method: "POST", url: CATALOG, payload: { lotKey: "lot_a" } });
    assert.equal(wrong.statusCode, 404);
  } finally {
    restoreEnv(prev);
    await app.close();
  }
});

test("enabled association routes reject observers of the audit key, queries, and confirmation", async () => {
  const app = await buildApp();
  const prev = saveEnv();
  const chunks: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.env.SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED = "true";
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  process.env.SA360_AUDIT_READONLY_KEY = AUDIT_KEY;
  delete process.env.SA360_ADMIN_KEY;
  try {
    const missing = await app.inject({ method: "POST", url: PREVIEW, payload: {} });
    assert.equal(missing.statusCode, 401);

    const audit = await app.inject({
      method: "POST",
      url: PREVIEW,
      headers: { [PROVENANCE_AUDIT_KEY_HEADER]: AUDIT_KEY, "x-sa360-admin-key": AUDIT_KEY },
      payload: { proposedOriginClientAccountId: "client_a", campaigns: [] },
    });
    assert.equal(audit.statusCode, 401);

    const queried = await app.inject({
      method: "POST",
      url: `${PREVIEW}?label=${SECRET}`,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { lotKey: "lot_a" },
    });
    assert.equal(queried.statusCode, 400);
    assert.equal(queried.json().code, "historical_campaign_query_rejected");
    assert.equal(queried.body.includes(SECRET), false);

    const confirm = await app.inject({
      method: "POST",
      url: PREVIEW,
      headers: { "x-sa360-admin-key": ADMIN_KEY },
      payload: { confirmationPhrase: "CONFIRM HISTORICAL CAMPAIGN OWNERSHIP", label: SECRET },
    });
    assert.equal(confirm.statusCode, 400);
    assert.equal(confirm.json().code, "historical_ownership_confirmation_not_available");
    assert.equal(confirm.body.includes(SECRET), false);

    for (const url of [
      "/admin/v1/historical-campaign-associations/ownership-confirmations",
      "/admin/v1/historical-campaign-associations/ownership-reassignments",
      "/admin/v1/historical-campaign-resale/previews",
      "/admin/v1/historical-campaign-resale/confirmations",
      "/client/v1/historical-campaign-associations/ownership-previews",
      "/client/v1/fulfillment-ops/historical-campaign-catalog",
    ]) {
      const future = await app.inject({
        method: "POST",
        url,
        headers: { "x-sa360-admin-key": ADMIN_KEY },
        payload: { normalizedLabel: SECRET, originClientAccountId: "client_a" },
      });
      assert.equal(future.statusCode, 404, url);
      assert.equal(future.body.includes(SECRET), false);
      assert.equal(future.body.includes("historical_campaign_association_disabled"), false);
    }
    assert.equal(chunks.join("").includes(SECRET), false);
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
    restoreEnv(prev);
    await app.close();
  }
});
