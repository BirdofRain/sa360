import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWebhookMonitorSearchParams,
  webhookMonitorToAdminApiParams,
  WEBHOOK_MONITOR_PROCESSING_STATUS_OPTIONS,
  WEBHOOK_MONITOR_SOURCE_OPTIONS,
} from "./webhook-monitor-query.ts";

test("webhookMonitorToAdminApiParams defaults sort to receivedAt desc", () => {
  const params = webhookMonitorToAdminApiParams({});
  assert.equal(params.sortBy, "receivedAt");
  assert.equal(params.sortDirection, "desc");
});

test("live testing mode applies last-15-minutes filter", () => {
  const now = new Date("2026-05-18T15:00:00.000Z");
  const params = webhookMonitorToAdminApiParams({ live: true }, now);
  assert.ok(params.from);
  const fromMs = new Date(params.from!).getTime();
  assert.equal(fromMs, now.getTime() - 15 * 60_000);
  assert.equal(params.sortDirection, "desc");
});

test("chip last1h sets from one hour ago", () => {
  const now = new Date("2026-05-18T15:00:00.000Z");
  const params = webhookMonitorToAdminApiParams({ chip: "last1h" }, now);
  assert.equal(new Date(params.from!).getTime(), now.getTime() - 60 * 60_000);
});

test("parseWebhookMonitorSearchParams reads chip hideErrors live sort", () => {
  const q = parseWebhookMonitorSearchParams({
    chip: "errors",
    hideErrors: "1",
    live: "1",
    sort: "asc",
  });
  assert.equal(q.chip, "errors");
  assert.equal(q.hideErrors, true);
  assert.equal(q.live, true);
  assert.equal(q.sort, "asc");
});

test("webhookMonitorToAdminApiParams passes facebook_lead_ads source filter", () => {
  const params = webhookMonitorToAdminApiParams({ source: "facebook_lead_ads" });
  assert.equal(params.source, "facebook_lead_ads");
});

test("webhookMonitorToAdminApiParams ignores unknown source values", () => {
  const params = webhookMonitorToAdminApiParams({ source: "not_a_source" });
  assert.equal(params.source, undefined);
});

test("webhook monitor options include facebook_lead_ads and Meta processing statuses", () => {
  assert.equal(
    WEBHOOK_MONITOR_SOURCE_OPTIONS.some((s) => s.value === "facebook_lead_ads"),
    true
  );
  for (const status of [
    "handshake_ok",
    "handshake_denied",
    "captured",
    "duplicate",
    "signature_invalid",
    "processing_disabled",
    "normalized",
    "routing_review_required",
    "failed",
  ] as const) {
    assert.equal(WEBHOOK_MONITOR_PROCESSING_STATUS_OPTIONS.includes(status), true);
  }
});
