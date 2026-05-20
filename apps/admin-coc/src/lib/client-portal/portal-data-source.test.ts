import test from "node:test";
import assert from "node:assert/strict";
import { isClientPortalApiConfigured } from "../client-portal-api/keys.ts";
import { resolvePortalRenderMode } from "./access-gate.ts";
import { buildMockClientPortalDashboard } from "./mock-data.ts";

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
      gateRequired: false,
      hasAccess: false,
    }),
    "mock"
  );
  const mock = buildMockClientPortalDashboard("7d");
  assert.equal(mock.ok, true);
  assert.ok(mock.funnel.leadsReceived > 0);
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  if (prevB !== undefined) process.env.NEXT_PUBLIC_SA360_API_BASE_URL = prevB;
});

test("live mode without portal access cookie resolves to access_gate not live fetch", () => {
  assert.equal(
    resolvePortalRenderMode({
      apiConfigured: true,
      gateRequired: true,
      hasAccess: false,
    }),
    "access_gate"
  );
});
