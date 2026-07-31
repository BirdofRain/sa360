#!/usr/bin/env node
/**
 * Safe local/staging load probe for Admin COC API saturation diagnostics.
 *
 * NEVER points at production by default. Requires an explicit --base-url.
 *
 * Usage:
 *   node scripts/diagnostics/admin-coc-api-load.mjs \
 *     --base-url http://127.0.0.1:3000 \
 *     --admin-key "$ADMIN_API_KEY" \
 *     --requests 8 \
 *     --concurrency 2
 */

import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "base-url": { type: "string" },
    "admin-key": { type: "string" },
    requests: { type: "string", default: "8" },
    concurrency: { type: "string", default: "2" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (values.help || !values["base-url"]) {
  console.log(`Admin COC API load diagnostic (local/staging only)

Required:
  --base-url <url>     Explicit API origin (never defaults to production)

Optional:
  --admin-key <key>    Admin API key (or set ADMIN_API_KEY / SA360_ADMIN_API_KEY)
  --requests <n>       Total requests across all endpoints (default 8)
  --concurrency <n>    Max in-flight requests (default 2)
`);
  process.exit(values.help ? 0 : 1);
}

const baseUrl = values["base-url"].replace(/\/+$/, "");
const hostname = new URL(baseUrl).hostname.toLowerCase();
const blockedHosts = ["sa360-sw6oq.ondigitalocean.app", "ondigitalocean.app"];
if (blockedHosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
  console.error(
    "Refusing to run against a DigitalOcean production-like host. Use local/staging only."
  );
  process.exit(2);
}

const adminKey =
  values["admin-key"] ||
  process.env.SA360_ADMIN_API_KEY ||
  process.env.ADMIN_API_KEY ||
  process.env.SA360_ADMIN_KEY;
if (!adminKey) {
  console.error("Missing admin key. Pass --admin-key or set ADMIN_API_KEY.");
  process.exit(1);
}

const totalRequests = Math.max(1, Math.min(Number(values.requests) || 8, 100));
const concurrency = Math.max(1, Math.min(Number(values.concurrency) || 2, 10));

const endpoints = [
  "/admin/v1/coc/summary-metrics",
  "/admin/v1/coc/webhook-requests?limit=12&processingStatus=unauthorized",
  "/admin/v1/coc/webhook-requests?limit=12&processingStatus=validation_failed",
  "/admin/v1/coc/lead-fulfillment/overview",
  "/admin/v1/fulfillment-ops/bootstrap",
];

const memBefore = process.memoryUsage();
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

const latencies = [];
const statusCounts = new Map();
let success = 0;
let errors = 0;

async function one(path) {
  const started = performance.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        Accept: "application/json",
        "x-sa360-admin-key": adminKey,
      },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const ms = performance.now() - started;
    latencies.push(ms);
    statusCounts.set(res.status, (statusCounts.get(res.status) || 0) + 1);
    const looksHtml = /^\s*<!DOCTYPE|^\s*<html/i.test(text);
    if (res.ok && !looksHtml) success += 1;
    else errors += 1;
    return { path, status: res.status, ms, looksHtml };
  } catch (err) {
    const ms = performance.now() - started;
    latencies.push(ms);
    errors += 1;
    statusCounts.set(0, (statusCounts.get(0) || 0) + 1);
    return { path, status: 0, ms, error: err instanceof Error ? err.message : String(err) };
  }
}

const queue = [];
for (let i = 0; i < totalRequests; i += 1) {
  queue.push(endpoints[i % endpoints.length]);
}

const results = [];
let idx = 0;
async function worker() {
  while (idx < queue.length) {
    const current = queue[idx];
    idx += 1;
    results.push(await one(current));
  }
}

const workers = Array.from({ length: concurrency }, () => worker());
await Promise.all(workers);

histogram.disable();
const memAfter = process.memoryUsage();
latencies.sort((a, b) => a - b);
const avg = latencies.reduce((a, b) => a + b, 0) / (latencies.length || 1);
const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? 0;
const max = latencies[latencies.length - 1] ?? 0;

console.log(
  JSON.stringify(
    {
      baseHost: hostname,
      requestCount: totalRequests,
      concurrency,
      success,
      errors,
      averageLatencyMs: Math.round(avg),
      p95LatencyMs: Math.round(p95),
      maxLatencyMs: Math.round(max),
      statusDistribution: Object.fromEntries(statusCounts),
      memoryBeforeMb: Math.round((memBefore.heapUsed / 1024 / 1024) * 100) / 100,
      memoryAfterMb: Math.round((memAfter.heapUsed / 1024 / 1024) * 100) / 100,
      heapDeltaMb:
        Math.round(((memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024) * 100) / 100,
      eventLoopDelayP95Ms: Math.round(histogram.percentile(95) / 1e6),
      endpoints,
      sample: results.slice(0, 10),
    },
    null,
    2
  )
);
