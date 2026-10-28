import assert from "node:assert/strict";
import test from "node:test";

import { shouldRetryGhlLiveAttempt } from "./ghl-live-transport.js";

test("writes are not retried after a timeout or 5xx", () => {
  assert.equal(
    shouldRetryGhlLiveAttempt({
      method: "POST",
      attempt: 1,
      maxAttempts: 2,
      allowRetry: true,
      transportError: true,
    }),
    false
  );
  assert.equal(
    shouldRetryGhlLiveAttempt({
      method: "POST",
      attempt: 1,
      maxAttempts: 2,
      allowRetry: true,
      status: 500,
    }),
    false
  );
  assert.equal(
    shouldRetryGhlLiveAttempt({
      method: "PUT",
      attempt: 1,
      maxAttempts: 2,
      allowRetry: true,
      status: 503,
    }),
    false
  );
});

test("a refused 429 may be retried once and a read may retry a 5xx", () => {
  assert.equal(
    shouldRetryGhlLiveAttempt({
      method: "POST",
      attempt: 1,
      maxAttempts: 2,
      allowRetry: true,
      status: 429,
    }),
    true
  );
  assert.equal(
    shouldRetryGhlLiveAttempt({
      method: "POST",
      attempt: 2,
      maxAttempts: 2,
      allowRetry: true,
      status: 429,
    }),
    false
  );
  assert.equal(
    shouldRetryGhlLiveAttempt({
      method: "GET",
      attempt: 1,
      maxAttempts: 2,
      allowRetry: true,
      status: 502,
    }),
    true
  );
  assert.equal(
    shouldRetryGhlLiveAttempt({
      method: "GET",
      attempt: 1,
      maxAttempts: 2,
      allowRetry: false,
      status: 502,
    }),
    false
  );
});
