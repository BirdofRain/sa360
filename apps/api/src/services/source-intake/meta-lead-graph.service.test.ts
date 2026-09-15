import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFixtureGraphLead,
  classifyMetaGraphResult,
  isRetryableMetaGraphOutcome,
  META_GRAPH_FETCH_TIMEOUT_MS,
} from "./meta-lead-graph.service.js";

test("classifyMetaGraphResult maps 200 lead bodies to success", () => {
  assert.equal(
    classifyMetaGraphResult({ ok: true, status: 200, body: { id: "lead_1", field_data: [] } }),
    "success"
  );
});

test("classifyMetaGraphResult maps 429 and 5xx and network to retryable", () => {
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 429, body: {} }),
    "retryable_failure"
  );
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 500, body: {} }),
    "retryable_failure"
  );
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 0, body: { error: "network_error" } }),
    "retryable_failure"
  );
  assert.equal(isRetryableMetaGraphOutcome("retryable_failure"), true);
});

test("classifyMetaGraphResult maps auth, not found, malformed, and 4xx as terminal", () => {
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 401, body: { error: { code: 190 } } }),
    "auth_failure"
  );
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 403, body: {} }),
    "auth_failure"
  );
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 404, body: {} }),
    "not_found"
  );
  assert.equal(
    classifyMetaGraphResult({ ok: true, status: 200, body: { error: "weird" } }),
    "malformed"
  );
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 400, body: { error: { code: 100 } } }),
    "not_found"
  );
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 418, body: { error: "teapot" } }),
    "non_retryable_failure"
  );
  assert.equal(isRetryableMetaGraphOutcome("auth_failure"), false);
  assert.equal(isRetryableMetaGraphOutcome("not_found"), false);
  assert.equal(isRetryableMetaGraphOutcome("malformed"), false);
});

test("Graph fetch timeout is below the default BullMQ stall interval", () => {
  assert.equal(META_GRAPH_FETCH_TIMEOUT_MS, 25_000);
  assert.equal(META_GRAPH_FETCH_TIMEOUT_MS < 30_000, true);
});

test("buildFixtureGraphLead never includes an access token", () => {
  const body = buildFixtureGraphLead("lead_fix", {
    leadgenId: "lead_fix",
    firstName: "Jane",
    email: "jane@example.test",
    campaignId: "camp_1",
  });
  assert.equal(body.id, "lead_fix");
  assert.equal(JSON.stringify(body).includes("access_token"), false);
});
