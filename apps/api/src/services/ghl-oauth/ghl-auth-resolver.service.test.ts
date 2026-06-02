import test from "node:test";
import assert from "node:assert/strict";
import { resolveGhlBearerAuthForLocation } from "./ghl-auth-resolver.service.js";

test("resolveGhlBearerAuthForLocation falls back to env private token", async () => {
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  process.env.GHL_PRIVATE_INTEGRATION_TOKEN = "env-pilot-token";
  try {
    const auth = await resolveGhlBearerAuthForLocation("loc_without_oauth_row");
    assert.ok(auth);
    assert.equal(auth.authMode, "env_private_token");
    assert.equal(auth.token, "env-pilot-token");
  } finally {
    if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
    else delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  }
});

test("resolveGhlBearerAuthForLocation returns null when no auth available", async () => {
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const prevAgent = process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  try {
    const auth = await resolveGhlBearerAuthForLocation("loc_missing");
    assert.equal(auth, null);
  } finally {
    if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
    if (prevAgent !== undefined) process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN = prevAgent;
  }
});
