import test from "node:test";
import assert from "node:assert/strict";
import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import { resolvePortalRenderMode } from "./access-gate.ts";
import { buildMockClientPortalDashboard } from "./mock-data.ts";
import {
  classifyPortalFetchFailure,
  resolvePortalPreviewBannerCopy,
} from "./portal-display.ts";

test("/portal uses mock path when client portal API env is missing", () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevB = process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.CLIENT_PORTAL_API_KEY;
  delete process.env.NEXT_PUBLIC_SA360_API_BASE_URL;
  delete process.env.NEXT_PUBLIC_API_BASE_URL;
  assert.equal(isClientPortalApiConfigured(), false);
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: false,
      hasSession: false,
      loginConfigured: false,
      gateRequired: false,
    }),
    "mock"
  );
  const mock = buildMockClientPortalDashboard("7d");
  assert.equal(mock.ok, true);
  assert.ok(mock.funnel.leadsReceived > 0);
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
});

test("live mode without session resolves to access_gate when legacy access code gate active", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      gateRequired: true,
      hasSession: false,
      loginConfigured: false,
    }),
    "access_gate"
  );
});

test("live mode without session redirects to login when login env configured", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      gateRequired: false,
      hasSession: false,
      loginConfigured: true,
    }),
    "login_required"
  );
});

test("not_configured fallback copy does not mention setting API key when already omitted", () => {
  const copy = resolvePortalPreviewBannerCopy("not_configured");
  assert.ok(!copy.previewBanner.includes("Set CLIENT_PORTAL_API_KEY"));
  assert.ok(copy.previewBanner.includes("Configure the client portal API settings"));
});

test("live fetch failed fallback uses distinct preview and warning detail", () => {
  const failure = { status: 401, body: '{"ok":false,"error":"Unauthorized"}' };
  const copy = resolvePortalPreviewBannerCopy("live_fetch_failed", failure);
  assert.equal(classifyPortalFetchFailure(failure), "unauthorized");
  assert.ok(copy.previewBanner.includes("could not be loaded"));
  assert.equal(copy.warningTitle, "Live dashboard unavailable");
  assert.ok(copy.warningDetail?.includes("rejected"));
});
