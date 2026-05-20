import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMockClientPortalDashboard,
  buildMockClientPortalDashboardNoVoice,
} from "./mock-data.ts";
import { formatPercent, formatRelativeTime, mapClientPortalDashboard } from "./map-client-dashboard.ts";

test("mapClientPortalDashboard preserves funnel counts", () => {
  const raw = buildMockClientPortalDashboard("7d");
  const mapped = mapClientPortalDashboard(raw);
  assert.equal(mapped.funnel.leadsReceived, raw.funnel.leadsReceived);
  assert.equal(mapped.ok, true);
});

test("30d mock scales funnel above 7d", () => {
  const seven = buildMockClientPortalDashboard("7d");
  const thirty = buildMockClientPortalDashboard("30d");
  assert.ok(thirty.funnel.leadsReceived > seven.funnel.leadsReceived);
});

test("buildMockClientPortalDashboardNoVoice disables ai card", () => {
  const dash = buildMockClientPortalDashboardNoVoice("7d");
  assert.equal(dash.aiVoice.enabled, false);
});

test("formatPercent formats rates", () => {
  assert.equal(formatPercent(0.67), "67%");
  assert.equal(formatPercent(0), "0%");
});

test("formatRelativeTime returns readable string", () => {
  const recent = new Date(Date.now() - 5 * 60_000).toISOString();
  assert.match(formatRelativeTime(recent), /min ago/);
});
