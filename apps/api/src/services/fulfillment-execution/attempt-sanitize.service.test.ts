import test from "node:test";
import assert from "node:assert/strict";

import {
  containsPersistedSecret,
  sanitizeAttemptPayload,
} from "./attempt-sanitize.service.js";

test("sanitizeAttemptPayload strips nested secrets recursively", () => {
  const sanitized = sanitizeAttemptPayload({
    contact: { name: "Ada" },
    oauthToken: "secret-value",
    nested: { authorization: "Bearer abc", ok: true },
  });
  assert.ok(sanitized);
  assert.equal("oauthToken" in sanitized, false);
  assert.equal("authorization" in (sanitized.nested as Record<string, unknown>), false);
  assert.equal((sanitized.contact as Record<string, unknown>).name, "Ada");
});

test("containsPersistedSecret detects authorization headers", () => {
  const hits = containsPersistedSecret({
    headers: { Authorization: "Bearer secret" },
  });
  assert.ok(hits.some((path) => path.includes("Authorization")));
});

test("sanitizeAttemptPayload never stores bearer tokens", () => {
  const sanitized = sanitizeAttemptPayload({
    headers: { authorization: "Bearer abc123" },
  });
  const hits = containsPersistedSecret(sanitized);
  assert.equal(hits.length, 0);
});
