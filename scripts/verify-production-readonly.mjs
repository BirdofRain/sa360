/**
 * Read-only production API verification — no DO API, no writes.
 */
import { config } from "dotenv";

config();

const base = process.env.PRODUCTION_API_BASE ?? "https://sa360-sw6oq.ondigitalocean.app";
const adminKey = process.env.ADMIN_API_KEY;
if (!adminKey) throw new Error("ADMIN_API_KEY required in .env");

const adminHeaders = {
  "x-sa360-admin-key": adminKey,
  Accept: "application/json",
};

async function fetchStatus(path, headers = {}) {
  const url = `${base}${path}`;
  const res = await fetch(url, { headers });
  let body;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 500);
  }
  return { path, status: res.status, body };
}

const results = {
  generatedAt: new Date().toISOString(),
  apiBase: base,
  expectedCommitSha: "b797eb9d3753ada144856c8e296560eceaf999ff",
  checks: {},
};

results.checks.health = await fetchStatus("/health");
results.checks.healthDb = await fetchStatus("/health/db");
results.checks.deliveryRuntimeMode = await fetchStatus("/admin/v1/delivery-runtime-mode", adminHeaders);
results.checks.adminHealth = await fetchStatus("/admin/v1/health", adminHeaders);

const lf2ReadPaths = [
  "/admin/v1/fulfillment-execution/allocations/nonexistent-allocation-id",
  "/admin/v1/fulfillment-execution/instructions/nonexistent-instruction-id/ghl-live/canary/preflight",
  "/admin/v1/fulfillment-shadow/source-leads/nonexistent-source-lead-id",
];

results.checks.lf2Reads = [];
for (const path of lf2ReadPaths) {
  results.checks.lf2Reads.push(await fetchStatus(path, adminHeaders));
}

console.log(JSON.stringify(results, null, 2));
