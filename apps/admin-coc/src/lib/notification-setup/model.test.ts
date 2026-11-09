import assert from "node:assert/strict";
import test from "node:test";

import { notificationSaveAttempt, preferenceSaveKey, recipientSaveKey } from "./attempt.ts";
import {
  normalizeNotificationRecipient,
  parsePreferenceSnapshot,
  parsePreferenceWriteSnapshot,
  parseRecipientSnapshot,
  readNotificationErrorCode,
} from "./model.ts";

test("one mailbox is normalized and lists are rejected", () => {
  assert.equal(normalizeNotificationRecipient("  Owner@Example.com "), "owner@example.com");
  assert.equal(normalizeNotificationRecipient("owner@example.com"), "owner@example.com");
  assert.equal(normalizeNotificationRecipient(""), null);
  assert.equal(normalizeNotificationRecipient("owner@example.com, other@example.com"), null);
  assert.equal(normalizeNotificationRecipient("Alex <owner@example.com>"), null);
  assert.equal(normalizeNotificationRecipient("owner@example.com;other@example.com"), null);
  assert.equal(normalizeNotificationRecipient("not-an-email"), null);
});

test("a repeated save keeps its request id until the intent changes", () => {
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  let cursor = 0;
  const next = () => ids[cursor++] ?? "33333333-3333-4333-8333-333333333333";
  const key = preferenceSaveKey("alex_gross", 2, true);
  const first = notificationSaveAttempt(null, key, next);
  const retry = notificationSaveAttempt(first, key, next);
  assert.equal(retry.requestId, first.requestId);
  assert.equal(cursor, 1);
  const changed = notificationSaveAttempt(retry, preferenceSaveKey("alex_gross", 3, true), next);
  assert.notEqual(changed.requestId, first.requestId);
  const otherValue = notificationSaveAttempt(changed, recipientSaveKey("alex_gross", 3, "owner@example.com"), next);
  assert.notEqual(otherValue.requestId, changed.requestId);
});

test("preference and recipient snapshots drop a mailbox from the workspace shape", () => {
  assert.deepEqual(
    parsePreferenceSnapshot({
      enabled: false,
      canEnable: false,
      blockedReason: "recipient_not_verified",
      recipientVerified: false,
      revision: 0,
      recipientEmail: "owner@example.com",
    }),
    {
      enabled: false,
      canEnable: false,
      blockedReason: "recipient_not_verified",
      recipientVerified: false,
      revision: 0,
    }
  );
  assert.equal(
    parsePreferenceSnapshot({
      enabled: true,
      canEnable: true,
      blockedReason: null,
      recipientVerified: true,
      revision: 0,
    }),
    null
  );
  assert.deepEqual(parsePreferenceWriteSnapshot({
    ok: true,
    replayed: false,
    enabled: true,
    recipientVerified: true,
    revision: 2,
    channel: "email",
    recipientEmail: "owner@example.com",
  }), {
    replayed: false,
    snapshot: {
      enabled: true,
      canEnable: true,
      blockedReason: null,
      recipientVerified: true,
      revision: 2,
    },
  });
  assert.equal(JSON.stringify(parsePreferenceWriteSnapshot({
    ok: true,
    replayed: true,
    enabled: false,
    recipientVerified: true,
    revision: 4,
    channel: "email",
  })).includes("recipientEmail"), false);
});

test("the recipient snapshot keeps one normalized address and its revision", () => {
  assert.deepEqual(parseRecipientSnapshot({
    ok: true,
    clientAccountId: "alex_gross",
    recipientEmail: null,
    recipientVerified: false,
    recipientEmailVerifiedAt: null,
    enabled: false,
    revision: 0,
    channel: "email",
  }, "alex_gross"), {
    clientAccountId: "alex_gross",
    recipientEmail: null,
    recipientVerified: false,
    recipientEmailVerifiedAt: null,
    enabled: false,
    revision: 0,
  });
  assert.equal(parseRecipientSnapshot({
    ok: true,
    clientAccountId: "alex_gross",
    recipientEmail: "Owner@Example.com",
    recipientVerified: true,
    recipientEmailVerifiedAt: "2026-11-09T18:00:00.000Z",
    enabled: false,
    revision: 1,
    channel: "email",
  }, "alex_gross"), null);
  assert.equal(parseRecipientSnapshot({
    ok: true,
    clientAccountId: "other",
    recipientEmail: "owner@example.com",
    recipientVerified: true,
    recipientEmailVerifiedAt: "2026-11-09T18:00:00.000Z",
    enabled: false,
    revision: 1,
    channel: "email",
  }, "alex_gross"), null);
  assert.equal(readNotificationErrorCode(409, JSON.stringify({ error: "revision_conflict", replayed: false })), "revision_conflict");
  assert.equal(readNotificationErrorCode(500, "<html>secret</html>"), "request_failed");
});
