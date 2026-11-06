import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV } from "../../lib/delivery-success-notification-env.js";
import {
  DELIVERY_SUCCESS_CHANNEL,
  DELIVERY_SUCCESS_NOTIFICATION_STATUS,
  DELIVERY_SUCCESS_NOTIFY_STALE_CLAIM_MS,
  DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX,
  armDeliverySuccessNotificationCursor,
  claimDeliverySuccessNotification,
  deliverySuccessNotificationIdempotencyKey,
  deliverySuccessResendIdempotencyKey,
  insertPendingDeliverySuccessNotification,
  isCanonicalReceiptEligibleForNotification,
} from "./notification-claim.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);

function newClient(): PrismaClient {
  const sep = databaseUrl.includes("?") ? "&" : "?";
  return new PrismaClient({
    datasources: { db: { url: `${databaseUrl}${sep}connection_limit=2` } },
  });
}

let dbA: PrismaClient;
let dbB: PrismaClient;
const clientIds: string[] = [];

describe("delivery success notification claim", { concurrency: false }, () => {
before(async () => {
  dbA = newClient();
  dbB = newClient();
  await dbA.$queryRaw`SELECT 1`;
  await disarm();
});

after(async () => {
  await disarm().catch(() => undefined);
  if (clientIds.length > 0) {
    await dbA.deliverySuccessNotification
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
    await dbA.clientCustomWebhookDestination
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
    await dbA.deliveryTarget
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
    await dbA.clientAccount
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
  }
  await dbA.$disconnect().catch(() => undefined);
  await dbB.$disconnect().catch(() => undefined);
});

async function disarm(): Promise<void> {
  await dbA.deliverySuccessNotificationCursor.update({
    where: { singleton: true },
    data: { armedAt: null },
  });
}

async function createClient(label: string): Promise<string> {
  const clientAccountId = `dsn_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await dbA.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Delivery notification test",
      status: "onboarding",
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

test("idempotency keys name the receipt and resend truncation does not send", () => {
  assert.equal(
    deliverySuccessNotificationIdempotencyKey(DELIVERY_SUCCESS_CHANNEL.company_sheets, "job_1"),
    "company_sheets:job_1"
  );
  assert.equal(
    deliverySuccessNotificationIdempotencyKey(DELIVERY_SUCCESS_CHANNEL.ghl_location_api, "run_1"),
    "ghl_location_api:run_1"
  );
  assert.equal(
    deliverySuccessNotificationIdempotencyKey(DELIVERY_SUCCESS_CHANNEL.custom_webhook, "attempt_1"),
    "custom_webhook:attempt_1"
  );
  const longKey = `company_sheets:${"a".repeat(300)}`;
  assert.equal(deliverySuccessResendIdempotencyKey(longKey).length, DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX);
  assert.throws(() => deliverySuccessNotificationIdempotencyKey(DELIVERY_SUCCESS_CHANNEL.company_sheets, "  "), /required/);
});

test("eligibility requires a completion strictly after armedAt", () => {
  const armedAt = new Date("2026-11-06T21:00:00.000Z");
  assert.equal(
    isCanonicalReceiptEligibleForNotification({ armedAt: null, completedAt: armedAt }),
    false
  );
  assert.equal(
    isCanonicalReceiptEligibleForNotification({
      armedAt,
      completedAt: new Date(armedAt.getTime() - 1),
    }),
    false
  );
  assert.equal(
    isCanonicalReceiptEligibleForNotification({ armedAt, completedAt: armedAt }),
    false
  );
  assert.equal(
    isCanonicalReceiptEligibleForNotification({
      armedAt,
      completedAt: new Date(armedAt.getTime() + 1),
    }),
    true
  );
});

test("arming is refused before a query unless the notify flag is exact true", async () => {
  const db = new Proxy(
    {},
    {
      get() {
        throw new Error("cursor query while notification flag is off");
      },
    }
  ) as PrismaClient;
  for (const value of [undefined, "TRUE", "1", "yes", "on"]) {
    const result = await armDeliverySuccessNotificationCursor(db, {
      env: { [DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV]: value },
    });
    assert.deepEqual(result, { ok: true, armed: false, reason: "notify_disabled" });
  }
});

test("the first enabled arm sets armedAt once and does not move it earlier or insert notifications", async () => {
  await disarm();
  const beforeCount = await dbA.deliverySuccessNotification.count();
  const later = new Date("2026-11-06T21:30:00.000Z");
  const earlier = new Date("2026-11-06T20:00:00.000Z");
  const enabled = { [DELIVERY_SUCCESS_NOTIFY_ENABLED_ENV]: "true" };
  const first = await armDeliverySuccessNotificationCursor(dbA, { now: later, env: enabled });
  assert.equal(first.armed, true);
  if (!first.armed) return;
  assert.equal(first.newlyArmed, true);
  assert.equal(first.armedAt.toISOString(), later.toISOString());

  const second = await armDeliverySuccessNotificationCursor(dbA, { now: earlier, env: enabled });
  assert.equal(second.armed, true);
  if (!second.armed) return;
  assert.equal(second.newlyArmed, false);
  assert.equal(second.armedAt.toISOString(), later.toISOString());

  const stored = await dbA.deliverySuccessNotificationCursor.findUniqueOrThrow({
    where: { singleton: true },
  });
  assert.equal(stored.armedAt?.toISOString(), later.toISOString());
  assert.equal(await dbA.deliverySuccessNotification.count(), beforeCount);
  await disarm();
});

test("a second insert for the same key is a no-op and does not reopen sent", async () => {
  const clientAccountId = await createClient("insert");
  const first = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.company_sheets,
    receiptId: "job_insert",
    sourceLeadEventId: "lead_1",
  });
  assert.equal(first.inserted, true);
  assert.equal(first.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending);
  assert.equal(first.idempotencyKey, "company_sheets:job_insert");

  const sentAt = new Date("2026-11-06T21:10:00.000Z");
  await dbA.deliverySuccessNotification.update({
    where: { id: first.id },
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent,
      sentAt,
      attemptCount: 1,
    },
  });
  const second = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.company_sheets,
    receiptId: "job_insert",
  });
  assert.equal(second.inserted, false);
  assert.equal(second.id, first.id);
  assert.equal(second.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
  const stored = await dbA.deliverySuccessNotification.findUniqueOrThrow({ where: { id: first.id } });
  assert.equal(stored.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
  assert.equal(stored.sentAt?.toISOString(), sentAt.toISOString());
  assert.equal(stored.attemptCount, 1);
});

test("two concurrent claims produce one sending winner", async () => {
  const clientAccountId = await createClient("race");
  const inserted = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.ghl_location_api,
    receiptId: "run_race",
  });
  const now = new Date("2026-11-06T21:20:00.000Z");
  const [left, right] = await Promise.all([
    claimDeliverySuccessNotification(dbA, { idempotencyKey: inserted.idempotencyKey, now }),
    claimDeliverySuccessNotification(dbB, { idempotencyKey: inserted.idempotencyKey, now }),
  ]);
  const winners = [left, right].filter((result) => result.claimed);
  assert.equal(winners.length, 1);
  assert.equal(winners[0]?.claimCount, 1);
  assert.equal(winners[0]?.outcome, "claimed");
  assert.equal(winners[0]?.attemptCount, 1);
  const losers = [left, right].filter((result) => !result.claimed);
  assert.equal(losers.length, 1);
  assert.equal(losers[0]?.claimCount, 0);
  const stored = await dbA.deliverySuccessNotification.findUniqueOrThrow({
    where: { idempotencyKey: inserted.idempotencyKey },
  });
  assert.equal(stored.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending);
  assert.equal(stored.attemptCount, 1);
  assert.equal(stored.claimedAt?.toISOString(), now.toISOString());
});

test("sent is terminal and a later claim does not send or change the row", async () => {
  const clientAccountId = await createClient("sent");
  const inserted = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.custom_webhook,
    receiptId: "attempt_sent",
  });
  const sentAt = new Date("2026-11-06T21:40:00.000Z");
  await dbA.deliverySuccessNotification.update({
    where: { id: inserted.id },
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent,
      sentAt,
      attemptCount: 1,
      providerMessageId: "email_1",
    },
  });
  const first = await claimDeliverySuccessNotification(dbA, {
    idempotencyKey: inserted.idempotencyKey,
    now: new Date("2026-11-06T22:00:00.000Z"),
  });
  const second = await claimDeliverySuccessNotification(dbB, {
    idempotencyKey: inserted.idempotencyKey,
    now: new Date("2026-11-06T23:00:00.000Z"),
  });
  assert.equal(first.outcome, "already_sent");
  assert.equal(first.claimCount, 0);
  assert.equal(second.outcome, "already_sent");
  assert.equal(second.claimCount, 0);
  const stored = await dbA.deliverySuccessNotification.findUniqueOrThrow({ where: { id: inserted.id } });
  assert.equal(stored.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
  assert.equal(stored.sentAt?.toISOString(), sentAt.toISOString());
  assert.equal(stored.attemptCount, 1);
  assert.equal(stored.providerMessageId, "email_1");
  assert.equal(stored.claimedAt, null);
});

test("failed and stale sending can be reclaimed; fresh sending and skipped cannot", async () => {
  const clientAccountId = await createClient("states");
  const now = new Date("2026-11-06T22:10:00.000Z");

  const failed = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.company_sheets,
    receiptId: "job_failed",
  });
  await dbA.deliverySuccessNotification.update({
    where: { id: failed.id },
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.failed,
      lastError: "smtp down",
      attemptCount: 1,
    },
  });
  const reclaimed = await claimDeliverySuccessNotification(dbA, {
    idempotencyKey: failed.idempotencyKey,
    now,
  });
  assert.equal(reclaimed.outcome, "claimed");
  assert.equal(reclaimed.claimCount, 1);
  const failedRow = await dbA.deliverySuccessNotification.findUniqueOrThrow({ where: { id: failed.id } });
  assert.equal(failedRow.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending);
  assert.equal(failedRow.lastError, null);
  assert.equal(failedRow.attemptCount, 2);

  const fresh = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.company_sheets,
    receiptId: "job_fresh",
  });
  await dbA.deliverySuccessNotification.update({
    where: { id: fresh.id },
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending,
      claimedAt: now,
      attemptCount: 1,
    },
  });
  const freshClaim = await claimDeliverySuccessNotification(dbA, {
    idempotencyKey: fresh.idempotencyKey,
    now,
  });
  assert.equal(freshClaim.outcome, "in_progress");
  assert.equal(freshClaim.claimCount, 0);

  const boundary = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.company_sheets,
    receiptId: "job_boundary",
  });
  const boundaryClaimedAt = new Date(now.getTime() - DELIVERY_SUCCESS_NOTIFY_STALE_CLAIM_MS);
  await dbA.deliverySuccessNotification.update({
    where: { id: boundary.id },
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending,
      claimedAt: boundaryClaimedAt,
      attemptCount: 1,
    },
  });
  const boundaryClaim = await claimDeliverySuccessNotification(dbA, {
    idempotencyKey: boundary.idempotencyKey,
    now,
  });
  assert.equal(boundaryClaim.outcome, "in_progress");

  const stale = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.company_sheets,
    receiptId: "job_stale",
  });
  await dbA.deliverySuccessNotification.update({
    where: { id: stale.id },
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending,
      claimedAt: new Date(boundaryClaimedAt.getTime() - 1),
      attemptCount: 1,
    },
  });
  const staleClaim = await claimDeliverySuccessNotification(dbA, {
    idempotencyKey: stale.idempotencyKey,
    now,
  });
  assert.equal(staleClaim.outcome, "claimed");
  if (staleClaim.claimed) assert.equal(staleClaim.attemptCount, 2);

  const skipped = await insertPendingDeliverySuccessNotification(dbA, {
    clientAccountId,
    channel: DELIVERY_SUCCESS_CHANNEL.company_sheets,
    receiptId: "job_skipped",
  });
  await dbA.deliverySuccessNotification.update({
    where: { id: skipped.id },
    data: {
      status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped,
      skipReason: "missing_notify_to",
    },
  });
  const skippedClaim = await claimDeliverySuccessNotification(dbA, {
    idempotencyKey: skipped.idempotencyKey,
    now,
  });
  assert.equal(skippedClaim.outcome, "skipped");
  assert.equal(skippedClaim.claimCount, 0);
  const skippedRow = await dbA.deliverySuccessNotification.findUniqueOrThrow({ where: { id: skipped.id } });
  assert.equal(skippedRow.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped);

  const missing = await claimDeliverySuccessNotification(dbA, { idempotencyKey: "company_sheets:missing" });
  assert.deepEqual(missing, { ok: false, claimed: false, outcome: "not_found", claimCount: 0 });
});

test("webhook destination defaults to disabled and does not store the secret on the target", async () => {
  const clientAccountId = await createClient("dest");
  const target = await dbA.deliveryTarget.create({
    data: {
      clientAccountId,
      displayName: "Custom webhook",
      adapterKey: "webhook.generic.v1",
      enabled: false,
      configMetadataJson: { endpointHost: "hooks.example.com" },
    },
  });
  const destination = await dbA.clientCustomWebhookDestination.create({
    data: {
      clientAccountId,
      deliveryTargetId: target.id,
      endpointUrl: "https://hooks.example.com/lead",
      signingSecretCiphertext: "iv.tag.cipher",
      signingSecretFingerprint: "abc123fingerprint",
    },
  });
  assert.equal(destination.enabled, false);
  assert.equal(destination.revision, 1);
  const storedTarget = await dbA.deliveryTarget.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(storedTarget.enabled, false);
  assert.equal(JSON.stringify(storedTarget.configMetadataJson).includes("iv.tag.cipher"), false);
  const cursor = await dbA.deliverySuccessNotificationCursor.findUniqueOrThrow({
    where: { singleton: true },
  });
  assert.equal(cursor.singleton, true);
});
});
