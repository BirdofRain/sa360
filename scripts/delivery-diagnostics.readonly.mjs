#!/usr/bin/env node
/**
 * Read-only client for the SA360 delivery diagnostics API.
 *
 * It sends GET requests only. The admin key comes from the environment and is
 * never accepted as an argument, so it does not land in shell history or
 * process listings. It never prints the key.
 *
 *   SA360_ADMIN_KEY=... node scripts/delivery-diagnostics.readonly.mjs summary --window 24h
 *   SA360_ADMIN_KEY=... node scripts/delivery-diagnostics.readonly.mjs summary --client <clientAccountId> --window 7d
 *   SA360_ADMIN_KEY=... node scripts/delivery-diagnostics.readonly.mjs runs --client <clientAccountId> --status failed
 *   SA360_ADMIN_KEY=... node scripts/delivery-diagnostics.readonly.mjs run <runId> [<runId> ...]
 *
 * Base URL: --base-url or SA360_API_BASE_URL. HTTPS is required except for loopback.
 */

const USAGE = `Usage:
  delivery-diagnostics.readonly.mjs summary [--window 24h|7d] [--client ID] [--campaign ID]
  delivery-diagnostics.readonly.mjs runs (--client ID | --status STATUS) [--window 24h|7d] [--limit N] [--cursor C]
  delivery-diagnostics.readonly.mjs run RUN_ID [RUN_ID ...]
Options: --base-url URL (or SA360_API_BASE_URL). Key: SA360_ADMIN_KEY or ADMIN_API_KEY in the environment.`;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const STATUSES = new Set(["succeeded", "partial_success", "failed", "executing", "skipped_duplicate"]);
const TIMEOUT_MS = 20_000;

function fail(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--admin-key" || arg === "--key") {
      fail("The admin key is read from the environment only. It is never accepted as an argument.");
    }
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) fail(`Missing value for --${name}\n${USAGE}`);
      flags[name] = value;
      index += 1;
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

export function resolveBaseUrl(raw) {
  if (!raw) fail("Set --base-url or SA360_API_BASE_URL.");
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail("Base URL is not a valid URL.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    fail("Base URL must be https. Plain http is allowed for loopback only.");
  }
  if (url.username || url.password) fail("Base URL must not contain credentials.");
  return url.origin;
}

function checkId(label, value) {
  if (!SAFE_ID.test(value) || value.length > 128) fail(`${label} is not a valid identifier.`);
  return value;
}

export function buildRequests(positional, flags) {
  const [command, ...rest] = positional;
  const query = new URLSearchParams();
  const common = () => {
    if (flags.window) {
      if (!["24h", "7d"].includes(flags.window)) fail("--window must be 24h or 7d.");
      query.set("window", flags.window);
    }
    if (flags.client) query.set("clientAccountId", checkId("--client", flags.client));
  };
  if (command === "summary") {
    common();
    if (flags.campaign) query.set("campaignId", checkId("--campaign", flags.campaign));
    return [`/admin/v1/delivery-diagnostics/summary?${query}`];
  }
  if (command === "runs") {
    common();
    if (!flags.client && !flags.status) fail("runs needs --client or --status.");
    if (flags.status) {
      if (!STATUSES.has(flags.status)) fail("--status is not a known run status.");
      query.set("status", flags.status);
    }
    if (flags.limit) {
      const limit = Number(flags.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) fail("--limit must be 1 to 50.");
      query.set("limit", String(limit));
    }
    if (flags.cursor) query.set("cursor", flags.cursor);
    return [`/admin/v1/delivery-diagnostics/ghl-runs?${query}`];
  }
  if (command === "run") {
    if (rest.length === 0) fail(`run needs at least one run id.\n${USAGE}`);
    if (rest.length > 10) fail("run accepts at most 10 ids per call.");
    return rest.map((id) => `/admin/v1/delivery-diagnostics/ghl-runs/${encodeURIComponent(checkId("run id", id))}`);
  }
  return fail(USAGE);
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const key = (process.env.SA360_ADMIN_KEY || process.env.ADMIN_API_KEY || "").trim();
  if (!key) fail("Set SA360_ADMIN_KEY (or ADMIN_API_KEY) in the environment.");
  const base = resolveBaseUrl(flags["base-url"] || process.env.SA360_API_BASE_URL);
  const paths = buildRequests(positional, flags);

  const results = [];
  let exitCode = 0;
  for (const path of paths) {
    const response = await fetch(`${base}${path}`, {
      method: "GET",
      headers: { "x-sa360-admin-key": key, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { ok: false, error: "non_json_response" };
    }
    if (!response.ok) exitCode = 1;
    results.push({ path: path.split("?")[0], status: response.status, body });
  }
  process.stdout.write(`${JSON.stringify(results.length === 1 ? results[0].body : results, null, 2)}\n`);
  process.exit(exitCode);
}

import { fileURLToPath } from "node:url";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => fail(`Request failed: ${err instanceof Error ? err.name : "error"}`, 1));
}
