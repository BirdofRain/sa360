import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  DELIVERY_SUCCESS_NOTIFICATION_STATUS,
  DELIVERY_SUCCESS_NOTIFY_STALE_CLAIM_MS,
  DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX,
  claimDeliverySuccessNotification,
  deliverySuccessNotificationIdempotencyKey,
  deliverySuccessResendIdempotencyKey,
  isSourceLeadEligibleForClientNotification,
  recordDeliverySuccessNotification,
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
  });

  after(async () => {
    if (clientIds.length > 0) {
      await dbA.deliverySuccessNotification
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await dbA.clientDeliveryNotificationPreference
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

  test("the idempotency key is one client and source lead", () => {
    assert.equal(
      deliverySuccessNotificationIdempotencyKey("alex_gross", "lead_1"),
      "client_lead:alex_gross:lead_1"
    );
    const longKey = `client_lead:${"a".repeat(300)}`;
    assert.equal(
      deliverySuccessResendIdempotencyKey(longKey).length,
      DELIVERY_SUCCESS_RESEND_IDEMPOTENCY_KEY_MAX
    );
    assert.throws(() => deliverySuccessNotificationIdempotencyKey("  ", "lead_1"), /required/);
    assert.throws(() => deliverySuccessNotificationIdempotencyKey("alex", "lead:1"), /:/);
  });

  test("eligibility follows the client enable clock", () => {
    const enabledAt = new Date("2026-11-06T21:00:00.000Z");
    assert.equal(
      isSourceLeadEligibleForClientNotification({
        enabled: false,
        enabledAt,
        completedAt: new Date(enabledAt.getTime() + 1),
      }),
      false
    );
    assert.equal(
      isSourceLeadEligibleForClientNotification({
        enabled: true,
        enabledAt: null,
        completedAt: enabledAt,
      }),
      false
    );
    assert.equal(
      isSourceLeadEligibleForClientNotification({
        enabled: true,
        enabledAt,
        completedAt: enabledAt,
      }),
      false
    );
    assert.equal(
      isSourceLeadEligibleForClientNotification({
        enabled: true,
        enabledAt,
        completedAt: new Date(enabledAt.getTime() + 1),
      }),
      true
    );
  });

  test("Sheets and GHL receipts for one lead share one notification row", async () => {
    const clientAccountId = await createClient("channels");
    const [sheets, ghl] = await Promise.all([
      recordDeliverySuccessNotification(dbA, {
        clientAccountId,
        sourceLeadEventId: "lead_both",
        sheetsJobId: "job_1",
      }),
      recordDeliverySuccessNotification(dbB, {
        clientAccountId,
        sourceLeadEventId: "lead_both",
        ghlLiveRunId: "run_1",
      }),
    ]);
    assert.equal(sheets.idempotencyKey, "client_lead:" + clientAccountId + ":lead_both");
    assert.equal(ghl.idempotencyKey, sheets.idempotencyKey);
    const rows = await dbA.deliverySuccessNotification.findMany({
      where: { clientAccountId, sourceLeadEventId: "lead_both" },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.sheetsJobId, "job_1");
    assert.equal(rows[0]?.ghlLiveRunId, "run_1");
    assert.equal(rows[0]?.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.pending);
    const inserted = [sheets, ghl].filter((row) => row.inserted);
    assert.equal(inserted.length, 1);
  });

  test("a second channel does not reopen a sent notification", async () => {
    const clientAccountId = await createClient("sent-evidence");
    const first = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_sent",
      sheetsJobId: "job_sent",
    });
    const sentAt = new Date("2026-11-06T21:10:00.000Z");
    await dbA.deliverySuccessNotification.update({
      where: { id: first.id },
      data: {
        status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent,
        sentAt,
        attemptCount: 1,
      },
    });
    const second = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_sent",
      ghlLiveRunId: "run_sent",
    });
    assert.equal(second.inserted, false);
    assert.equal(second.id, first.id);
    assert.equal(second.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
    const stored = await dbA.deliverySuccessNotification.findUniqueOrThrow({ where: { id: first.id } });
    assert.equal(stored.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sent);
    assert.equal(stored.sentAt?.toISOString(), sentAt.toISOString());
    assert.equal(stored.sheetsJobId, "job_sent");
    assert.equal(stored.ghlLiveRunId, "run_sent");
    assert.equal(stored.attemptCount, 1);
  });

  test("two concurrent claims produce one sending winner", async () => {
    const clientAccountId = await createClient("race");
    const inserted = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_race",
      ghlLiveRunId: "run_race",
    });
    const now = new Date("2026-11-06T21:20:00.000Z");
    const [left, right] = await Promise.all([
      claimDeliverySuccessNotification(dbA, { idempotencyKey: inserted.idempotencyKey, now }),
      claimDeliverySuccessNotification(dbB, { idempotencyKey: inserted.idempotencyKey, now }),
    ]);
    const winners = [left, right].filter((result) => result.claimed);
    assert.equal(winners.length, 1);
    assert.equal(winners[0]?.claimCount, 1);
    assert.equal(winners[0]?.attemptCount, 1);
    const stored = await dbA.deliverySuccessNotification.findUniqueOrThrow({
      where: { idempotencyKey: inserted.idempotencyKey },
    });
    assert.equal(stored.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending);
    assert.equal(stored.attemptCount, 1);
    assert.equal(stored.claimedAt?.toISOString(), now.toISOString());
  });

  test("sent is terminal and a later claim does not change the row", async () => {
    const clientAccountId = await createClient("sent");
    const inserted = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_terminal",
      customWebhookAttemptId: "attempt_1",
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

    const failed = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_failed",
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
    const failedRow = await dbA.deliverySuccessNotification.findUniqueOrThrow({ where: { id: failed.id } });
    assert.equal(failedRow.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.sending);
    assert.equal(failedRow.lastError, null);
    assert.equal(failedRow.attemptCount, 2);

    const fresh = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_fresh",
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

    const boundary = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_boundary",
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

    const stale = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_stale",
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

    const skipped = await recordDeliverySuccessNotification(dbA, {
      clientAccountId,
      sourceLeadEventId: "lead_skipped",
    });
    await dbA.deliverySuccessNotification.update({
      where: { id: skipped.id },
      data: {
        status: DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped,
        skipReason: "missing_verified_recipient",
      },
    });
    const skippedClaim = await claimDeliverySuccessNotification(dbA, {
      idempotencyKey: skipped.idempotencyKey,
      now,
    });
    assert.equal(skippedClaim.outcome, "skipped");
    const skippedRow = await dbA.deliverySuccessNotification.findUniqueOrThrow({
      where: { id: skipped.id },
    });
    assert.equal(skippedRow.status, DELIVERY_SUCCESS_NOTIFICATION_STATUS.skipped);
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
  });
});
