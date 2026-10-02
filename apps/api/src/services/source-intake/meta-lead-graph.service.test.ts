import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFixtureGraphLead,
  buildMetaAppSecretProof,
  classifyMetaGraphResult,
  describeMetaGraphFailure,
  isRetryableMetaGraphOutcome,
  readMetaGraphError,
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

test("Graph rate limits and transient faults arrive as HTTP 400 and are retryable", () => {
  for (const code of [1, 2, 4, 17, 32, 613, 80000, 80014]) {
    assert.equal(
      classifyMetaGraphResult({ ok: false, status: 400, body: { error: { code, type: "OAuthException" } } }),
      "retryable_failure",
      `code ${code}`
    );
  }
  assert.equal(
    classifyMetaGraphResult({
      ok: false,
      status: 400,
      body: { error: { code: 2, is_transient: true, message: "Please retry your request later." } },
    }),
    "retryable_failure"
  );
  // is_transient wins even on a code that would otherwise be terminal.
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 400, body: { error: { code: 100, is_transient: true } } }),
    "retryable_failure"
  );
});

test("Graph permission errors (10, 200-299) and OAuth 102/190 are auth failures", () => {
  for (const code of [10, 200, 230, 299, 102, 190]) {
    assert.equal(
      classifyMetaGraphResult({ ok: false, status: 400, body: { error: { code } } }),
      "auth_failure",
      `code ${code}`
    );
  }
  assert.equal(
    classifyMetaGraphResult({ ok: false, status: 400, body: { error: { type: "OAuthException" } } }),
    "auth_failure"
  );
});

test("describeMetaGraphFailure is operator-actionable and never includes a token", () => {
  const auth = describeMetaGraphFailure({
    outcome: "auth_failure",
    status: 400,
    leadgenId: "900000000000001",
    body: { error: { code: 190, error_subcode: 463, message: "Session has expired", type: "OAuthException" } },
  });
  assert.match(auth, /190\/463/);
  assert.match(auth, /leads_retrieval/);
  assert.match(auth, /requeue/i);
  const rl = describeMetaGraphFailure({
    outcome: "retryable_failure",
    status: 400,
    leadgenId: "900000000000001",
    body: { error: { code: 4, message: "Application request limit reached" } },
  });
  assert.match(rl, /retry/i);
  assert.match(rl, /no operator action/i);
  const token = describeMetaGraphFailure({ outcome: "token_unavailable", status: 0, leadgenId: "1", body: null });
  assert.match(token, /META_PAGE_ACCESS_TOKEN/);
  for (const text of [auth, rl, token]) assert.doesNotMatch(text, /access_token=|EAA[A-Za-z0-9]/);
  // Long Graph messages are truncated for storage.
  const detail = readMetaGraphError({ error: { code: 1, message: "x".repeat(500) } });
  assert.equal(detail?.message?.length, 200);
});

test("appsecret_proof is HMAC-SHA256(token, app secret) and derived per call", () => {
  const proof = buildMetaAppSecretProof("tok", "secret");
  assert.match(proof, /^[0-9a-f]{64}$/);
  assert.equal(proof, buildMetaAppSecretProof("tok", "secret"));
  assert.notEqual(proof, buildMetaAppSecretProof("tok2", "secret"));
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
