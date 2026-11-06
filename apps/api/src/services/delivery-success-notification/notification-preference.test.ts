import assert from "node:assert/strict";
import { after, test } from "node:test";

import { Prisma, PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  normalizeRecipientEmail,
  saveDeliveryNotificationRecipient,
  setDeliveryNotificationEnabled,
} from "./notification-preference.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
const db = new PrismaClient({
  datasources: {
    db: { url: `${databaseUrl}${databaseUrl.includes("?") ? "&" : "?"}connection_limit=2` },
  },
});
const clientIds: string[] = [];

after(async () => {
  if (clientIds.length > 0) {
    await db.clientDeliveryNotificationPreference
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  }
  await db.$disconnect().catch(() => undefined);
});

async function createClient(label: string, portalLoginEmail?: string): Promise<string> {
  const clientAccountId = `pref_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await db.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Preference test",
      status: "onboarding",
      portalLoginEmail,
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("a recipient is one lowercase mailbox", () => {
  assert.equal(normalizeRecipientEmail("  Owner@Example.com "), "owner@example.com");
  assert.equal(normalizeRecipientEmail("a@b.com, c@d.com"), null);
  assert.equal(normalizeRecipientEmail("Alex <owner@example.com>"), null);
  assert.equal(normalizeRecipientEmail("not-an-email"), null);
});

test("notifications default disabled and cannot enable without a verified recipient", async () => {
  const clientAccountId = await createClient("default", "portal-owner@example.com");
  const created = await db.clientDeliveryNotificationPreference.create({
    data: { clientAccountId },
  });
  assert.equal(created.enabled, false);
  assert.equal(created.channel, "email");
  assert.equal(created.recipientEmail, null);
  assert.equal(created.recipientEmailVerifiedAt, null);
  assert.equal(created.enabledAt, null);

  const missing = await setDeliveryNotificationEnabled(db, { clientAccountId, enabled: true });
  assert.deepEqual(missing, { ok: false, code: "recipient_not_verified" });
  const stillOff = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId },
  });
  assert.equal(stillOff.enabled, false);

  await db.clientDeliveryNotificationPreference.update({
    where: { clientAccountId },
    data: { recipientEmail: "owner@example.com", recipientEmailVerifiedAt: null },
  });
  const unverified = await setDeliveryNotificationEnabled(db, { clientAccountId, enabled: true });
  assert.deepEqual(unverified, { ok: false, code: "recipient_not_verified" });
  const afterUnverified = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId },
  });
  assert.equal(afterUnverified.enabled, false);
  assert.equal(afterUnverified.enabledAt, null);
});

test("disabling and re-enabling advances enabledAt and an address change forces off", async () => {
  const clientAccountId = await createClient("clock", "portal-other@example.com");
  const saved = await saveDeliveryNotificationRecipient(db, {
    clientAccountId,
    recipientEmail: "  Owner@Example.com ",
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.preference.enabled, false);
  assert.equal(saved.preference.recipientEmail, "owner@example.com");
  assert.ok(saved.preference.recipientEmailVerifiedAt);
  assert.equal(saved.preference.enabledAt, null);
  assert.notEqual(saved.preference.recipientEmail, "portal-other@example.com");

  const enabled = await setDeliveryNotificationEnabled(db, { clientAccountId, enabled: true });
  assert.equal(enabled.ok, true);
  if (!enabled.ok) return;
  assert.equal(enabled.preference.enabled, true);
  const firstEnabledAt = enabled.preference.enabledAt;
  assert.ok(firstEnabledAt);

  const repeat = await setDeliveryNotificationEnabled(db, { clientAccountId, enabled: true });
  assert.equal(repeat.ok, true);
  if (!repeat.ok) return;
  assert.equal(repeat.preference.enabledAt?.toISOString(), firstEnabledAt.toISOString());

  await sleep(20);
  const disabled = await setDeliveryNotificationEnabled(db, { clientAccountId, enabled: false });
  assert.equal(disabled.ok, true);
  if (!disabled.ok) return;
  assert.equal(disabled.preference.enabled, false);
  assert.equal(disabled.preference.enabledAt?.toISOString(), firstEnabledAt.toISOString());
  assert.ok(disabled.preference.disabledAt);

  await sleep(20);
  const reenabled = await setDeliveryNotificationEnabled(db, { clientAccountId, enabled: true });
  assert.equal(reenabled.ok, true);
  if (!reenabled.ok) return;
  assert.ok(reenabled.preference.enabledAt);
  assert.ok(reenabled.preference.enabledAt.getTime() > firstEnabledAt.getTime());

  const previousEnabledAt = reenabled.preference.enabledAt;
  await sleep(20);
  const changed = await saveDeliveryNotificationRecipient(db, {
    clientAccountId,
    recipientEmail: "Next@Example.com",
  });
  assert.equal(changed.ok, true);
  if (!changed.ok) return;
  assert.equal(changed.preference.recipientEmail, "next@example.com");
  assert.equal(changed.preference.enabled, false);
  assert.equal(changed.preference.enabledAt?.toISOString(), previousEnabledAt.toISOString());
  assert.ok(changed.preference.recipientEmailVerifiedAt);

  await sleep(20);
  const afterChange = await setDeliveryNotificationEnabled(db, { clientAccountId, enabled: true });
  assert.equal(afterChange.ok, true);
  if (!afterChange.ok) return;
  assert.ok(afterChange.preference.enabledAt);
  assert.ok(afterChange.preference.enabledAt.getTime() > previousEnabledAt.getTime());
});

test("the enable check rejects a raw enabled row with a null recipient", async () => {
  const clientAccountId = await createClient("check");
  await assert.rejects(
    () =>
      db.$executeRaw`
        INSERT INTO "ClientDeliveryNotificationPreference" (
          "id",
          "clientAccountId",
          "enabled",
          "channel",
          "recipientEmail",
          "recipientEmailVerifiedAt",
          "enabledAt",
          "revision",
          "createdAt",
          "updatedAt"
        ) VALUES (
          ${"pref_bad_" + clientAccountId},
          ${clientAccountId},
          true,
          'email'::"ClientDeliveryNotificationChannel",
          NULL,
          NULL,
          NULL,
          1,
          transaction_timestamp(),
          transaction_timestamp()
        )
      `,
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
      return code === "P2010" || /23514|ClientDeliveryNotifyPref_enabled_verified_chk/i.test(message);
    }
  );
  const row = await db.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId } });
  assert.equal(row, null);
});
