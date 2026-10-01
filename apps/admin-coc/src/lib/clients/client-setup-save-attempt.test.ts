import assert from "node:assert/strict";
import test from "node:test";

import { clientSetupSaveAttempt } from "./client-setup-save-attempt";

test("a timeout retry and repeated click reuse the request ID", () => {
  let sequence = 0;
  const nextId = () => `request-${++sequence}`;
  const first = clientSetupSaveAttempt(
    null,
    "save_draft",
    { geography: "North", setupOwner: "Sam" },
    3,
    nextId
  );
  const retry = clientSetupSaveAttempt(
    first,
    "save_draft",
    { setupOwner: "Sam", geography: "North" },
    3,
    nextId
  );
  assert.equal(retry.requestId, first.requestId);
  assert.equal(sequence, 1);
});

test("payload, intent, and loaded revision changes create a new request ID", () => {
  let sequence = 0;
  const nextId = () => `request-${++sequence}`;
  const first = clientSetupSaveAttempt(
    null,
    "save_draft",
    { geography: "North" },
    1,
    nextId
  );
  const changedPayload = clientSetupSaveAttempt(
    first,
    "save_draft",
    { geography: "South" },
    1,
    nextId
  );
  const changedIntent = clientSetupSaveAttempt(
    changedPayload,
    "submit",
    { geography: "South" },
    1,
    nextId
  );
  const changedRevision = clientSetupSaveAttempt(
    changedIntent,
    "submit",
    { geography: "South" },
    2,
    nextId
  );
  assert.notEqual(changedPayload.requestId, first.requestId);
  assert.notEqual(changedIntent.requestId, changedPayload.requestId);
  assert.notEqual(changedRevision.requestId, changedIntent.requestId);
  assert.equal(sequence, 4);
});
