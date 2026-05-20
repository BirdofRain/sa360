import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPortalFetchFailure,
  portalFetchFailureDetail,
  resolvePortalPreviewBannerCopy,
} from "./portal-display.ts";

test("not_configured preview banner mentions API settings", () => {
  const copy = resolvePortalPreviewBannerCopy("not_configured");
  assert.ok(copy.previewBanner.includes("Configure the client portal API settings"));
  assert.equal(copy.warningTitle, undefined);
});

test("live_fetch_failed preview banner explains sample fallback", () => {
  const copy = resolvePortalPreviewBannerCopy("live_fetch_failed", {
    status: 502,
    body: "bad gateway",
  });
  assert.equal(
    copy.previewBanner,
    "Preview dashboard — showing sample data because live metrics could not be loaded."
  );
  assert.equal(copy.warningTitle, "Live dashboard unavailable");
  assert.ok(copy.warningDetail?.includes("could not be reached"));
});

test("classifyPortalFetchFailure: 401 is unauthorized", () => {
  assert.equal(
    classifyPortalFetchFailure({ status: 401, body: '{"ok":false,"error":"Unauthorized"}' }),
    "unauthorized"
  );
  assert.match(
    portalFetchFailureDetail("unauthorized"),
    /portal API key was rejected/i
  );
});

test("classifyPortalFetchFailure: 503 tenant message", () => {
  assert.equal(
    classifyPortalFetchFailure({
      status: 503,
      body: JSON.stringify({
        ok: false,
        error: "Client portal tenant not configured",
        hint: "Set CLIENT_PORTAL_CLIENT_ACCOUNT_ID on the API.",
      }),
    }),
    "tenant_not_configured"
  );
});

test("classifyPortalFetchFailure: status 0 is api unreachable", () => {
  assert.equal(
    classifyPortalFetchFailure({ status: 0, body: "fetch failed" }),
    "api_unreachable"
  );
});

test("classifyPortalFetchFailure: unknown status", () => {
  assert.equal(
    classifyPortalFetchFailure({ status: 418, body: '{"error":"teapot"}' }),
    "unknown"
  );
});
