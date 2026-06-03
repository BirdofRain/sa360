import test from "node:test";
import assert from "node:assert/strict";
import { ghlReadOnlyGet } from "./ghl-config-discovery-client.js";

test("ghlReadOnlyGet returns error without calling fetch when OAuth auth missing", async () => {
  const prevToken = process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  const prevAgent = process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.GHL_PRIVATE_INTEGRATION_TOKEN;
  delete process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN;

  let fetchCalled = false;
  const fetchImpl = async () => {
    fetchCalled = true;
    return new Response("{}", { status: 200 });
  };

  try {
    const res = await ghlReadOnlyGet(
      "loc_no_auth_for_discovery_test",
      "/opportunities/pipelines",
      undefined,
      fetchImpl as typeof fetch
    );
    assert.equal(res.ok, false);
    assert.equal(fetchCalled, false);
    assert.match(res.errorMessage ?? "", /OAuth/i);
  } finally {
    if (prevToken !== undefined) process.env.GHL_PRIVATE_INTEGRATION_TOKEN = prevToken;
    if (prevAgent !== undefined) process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN = prevAgent;
  }
});
