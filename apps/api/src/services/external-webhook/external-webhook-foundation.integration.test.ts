import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { prisma } from "../../lib/db.js";
import { sealExternalWebhookEndpoint } from "../../lib/external-webhook-credentials.js";
import { EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV } from "../../lib/external-webhook-credentials.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import {
  buildExternalWebhookAttemptRecord,
  projectExternalWebhookPayload,
} from "./external-webhook-payload.js";

const KEY = "test-external-webhook-credential-key-not-real";

async function expectMessage(run: () => Promise<unknown>, needle: string): Promise<void> {
  try {
    await run();
  } catch (error) {
    assert.match(String(error), new RegExp(needle));
    return;
  }
  assert.fail(`expected a database error containing ${needle}`);
}

test("external webhook rows stay independent of GHL, Sheets, and the legacy webhook", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const savedKey = process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
  process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = KEY;
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const clientAccountId = `ext_wh_${stamp}`;
  const otherClientId = `ext_wh_other_${stamp}`;
  const sealed = await sealExternalWebhookEndpoint(
    "https://hooks.example.com/hook/path-token",
    async () => [{ address: "8.8.8.8", family: 4 }]
  );
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;

  try {
    await prisma.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "External webhook foundation" },
    });
    await prisma.clientAccount.create({
      data: { clientAccountId: otherClientId, clientDisplayName: "External webhook other" },
    });

    const preference = await prisma.clientDeliveryNotificationPreference.create({
      data: {
        clientAccountId,
        enabled: true,
        channel: "email",
        recipientEmail: "ops@example.com",
        recipientEmailVerifiedAt: new Date("2026-11-13T16:00:00.000Z"),
        enabledAt: new Date("2026-11-13T16:00:00.000Z"),
      },
    });
    assert.equal(preference.channel, "email");
    assert.equal(preference.smsEnabled, false);
    assert.equal(preference.recipientPhoneE164, null);

    await expectMessage(
      () =>
        prisma.clientDeliveryNotificationPreference.update({
          where: { clientAccountId },
          data: { smsEnabled: true },
        }),
      "ClientDeliveryNotifyPref_sms_verified_chk"
    );
    await expectMessage(
      () =>
        prisma.clientDeliveryNotificationPreference.update({
          where: { clientAccountId },
          data: { recipientPhoneE164: "5551234567" },
        }),
      "ClientDeliveryNotifyPref_phone_e164_chk"
    );
    const sms = await prisma.clientDeliveryNotificationPreference.update({
      where: { clientAccountId },
      data: {
        recipientPhoneE164: "+15551234567",
        recipientPhoneVerifiedAt: new Date("2026-11-13T16:05:00.000Z"),
        smsEnabled: true,
      },
    });
    assert.equal(sms.channel, "email");
    assert.equal(sms.enabled, true);
    assert.equal(sms.smsEnabled, true);
    await expectMessage(
      () => prisma.$executeRaw`UPDATE "ClientDeliveryNotificationPreference" SET "channel" = 'sms' WHERE "clientAccountId" = ${clientAccountId}`,
      "invalid input value for enum"
    );
    await expectMessage(
      () =>
        prisma.clientDeliveryNotificationPreference.create({
          data: { clientAccountId: otherClientId, enabled: true, channel: "email" },
        }),
      "ClientDeliveryNotifyPref_enabled_verified_chk"
    );

    const destination = await prisma.clientExternalWebhookDestination.create({
      data: {
        clientAccountId,
        kind: "ghl_inbound",
        endpointUrlCiphertext: sealed.endpoint.ciphertext,
        endpointUrlFingerprint: sealed.endpoint.fingerprint,
        endpointHost: sealed.endpoint.hostname,
        enabled: true,
      },
    });
    assert.equal(destination.crmRole, "primary_crm");
    assert.equal(destination.authMode, "none");
    assert.equal(destination.enabled, true);

    const legacy = await prisma.clientCustomWebhookDestination.create({
      data: {
        clientAccountId,
        endpointUrl: "https://legacy.example.com/hook",
        signingSecretCiphertext: "legacy-ciphertext",
        signingSecretFingerprint: "legacy-fingerprint",
        enabled: true,
      },
    });
    assert.equal(legacy.enabled, true);

    await prisma.clientGhlDestination.create({
      data: {
        clientAccountId,
        destinationSubaccountIdGhl: `loc_${stamp}`,
        deliveryMode: "shadow",
        deliveryEnabled: true,
      },
    });
    await expectMessage(
      () =>
        prisma.clientGhlDestination.update({
          where: { clientAccountId },
          data: {
            deliveryMode: "live",
            clientCutoverApproved: true,
            internalApprovalStatus: "approved",
          },
        }),
      "duplicate_primary_crm"
    );
    await prisma.clientExternalWebhookDestination.update({
      where: { clientAccountId },
      data: { enabled: false },
    });
    const armed = await prisma.clientGhlDestination.update({
      where: { clientAccountId },
      data: {
        deliveryMode: "live",
        clientCutoverApproved: true,
        internalApprovalStatus: "approved",
      },
    });
    assert.equal(armed.deliveryEnabled, true);
    assert.equal(armed.deliveryMode, "live");
    await expectMessage(
      () =>
        prisma.clientExternalWebhookDestination.update({
          where: { clientAccountId },
          data: { enabled: true },
        }),
      "duplicate_primary_crm"
    );
    await prisma.clientGhlDestination.update({
      where: { clientAccountId },
      data: { deliveryMode: "shadow", deliveryEnabled: false },
    });
    await prisma.clientExternalWebhookDestination.update({
      where: { clientAccountId },
      data: { enabled: true },
    });

    const projected = projectExternalWebhookPayload({
      destinationKind: "ghl_inbound",
      destinationRevision: destination.revision,
      lead: {
        stableRowId: `row_${stamp}`,
        clientAccountId,
        sourceLeadEventId: `evt_${stamp}`,
        receivedAt: "2026-11-13T16:00:00.000Z",
        sourceLeadId: null,
        normalizedPayload: {
          contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.test" },
          phone: "5550100123",
          lead_details: { date_of_birth: "1979-04-12", consumer_age: "47" },
        },
      },
    });
    assert.equal(projected.ok, true);
    if (!projected.ok) return;
    const built = buildExternalWebhookAttemptRecord({
      destinationId: destination.id,
      endpointHost: destination.endpointHost,
      endpointUrlFingerprint: destination.endpointUrlFingerprint,
      projection: projected.projection,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const attempt = await prisma.externalWebhookDeliveryAttempt.create({ data: built.record });
    assert.equal(attempt.state, "recorded");
    assert.equal(attempt.payloadSha256, projected.projection.payloadSha256);
    await expectMessage(
      () =>
        prisma.externalWebhookDeliveryAttempt.create({
          data: { ...built.record, id: `second_${stamp}` },
        }),
      "Unique constraint"
    );
    await expectMessage(
      () =>
        prisma.externalWebhookDeliveryAttempt.update({
          where: { id: attempt.id },
          data: { payloadCanonicalJson: "{}" },
        }),
      "external_webhook_attempt_frozen"
    );
    const accepted = await prisma.externalWebhookDeliveryAttempt.update({
      where: { id: attempt.id },
      data: {
        state: "attempted",
        outcome: "http_accepted",
        httpStatus: 204,
        requestLeftSa360: true,
        proves: ["http_2xx"],
      },
    });
    assert.deepEqual(accepted.proves, ["http_2xx"]);
    assert.equal(accepted.payloadCanonicalJson, projected.projection.canonicalJson);
    await expectMessage(
      () =>
        prisma.externalWebhookDeliveryAttempt.update({
          where: { id: attempt.id },
          data: { outcome: "failed", httpStatus: 400, proves: [] },
        }),
      "external_webhook_receipt_terminal"
    );
    await expectMessage(() => prisma.clientAccount.delete({ where: { clientAccountId } }), "restrict|Foreign key");

    const sheets = await prisma.companySheetsDestination.findFirst({ where: { clientAccountId } });
    assert.equal(sheets, null);
    const definition = await prisma.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_functiondef('external_webhook_primary_crm_conflict()'::regprocedure) AS def
    `;
    assert.equal(definition[0]?.def.includes("CompanySheetsDestination"), false);
    assert.equal(definition[0]?.def.includes("ClientCustomWebhookDestination"), false);
    assert.equal(definition[0]?.def.includes("DeliverySuccessNotification"), false);

    await prisma.externalWebhookDeliveryAttempt.delete({ where: { id: attempt.id } });
    await prisma.clientAccount.delete({ where: { clientAccountId } });
    await prisma.clientAccount.delete({ where: { clientAccountId: otherClientId } });
  } finally {
    await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId } });
    await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId } });
    await prisma.clientCustomWebhookDestination.deleteMany({ where: { clientAccountId } });
    await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId } });
    await prisma.clientDeliveryNotificationPreference.deleteMany({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    if (savedKey === undefined) delete process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
    else process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = savedKey;
  }
});
