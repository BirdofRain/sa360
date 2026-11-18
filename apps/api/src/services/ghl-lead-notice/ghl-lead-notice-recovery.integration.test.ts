import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";

import { PrismaClient, type ExternalWebhookNoticeStatus } from "@prisma/client";
import Fastify from "fastify";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { externalWebhookNoticeCallbackRoutes } from "../../routes/external-webhook-notice-callbacks.js";
import {
  SMS_CONSENT_VERSION_V2,
  recordNotificationPhone,
  recordSmsConsent,
  setSmsNotificationEnabled,
  smsConsentAllowsGhlLeadNotice,
  smsConsentAllowsNotice,
  suppressSmsLocally,
} from "../external-webhook-notification/sms-consent.js";
import { composeGhlLeadSmsConsentText, composeSmsConsentText } from "../external-webhook-notification/sms-disclosure.js";
import { twilioRequestSignature } from "../external-webhook-notification/twilio-signature.js";
import { discoverGhlLeadNotices } from "./discover.js";
import { dispatchGhlLeadNotice } from "./dispatch.js";
import { recoverPendingGhlLeadNotices } from "./recovery.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
const PRIVACY = "https://policies.lifeagentlaunch.invalid/privacy";
const TERMS = "https://policies.lifeagentlaunch.invalid/terms";
const LEGAL = { privacyPolicyUrl: PRIVACY, termsUrl: TERMS };
const GHL_TEXT = composeGhlLeadSmsConsentText(LEGAL);
const V2_TEXT = composeSmsConsentText(LEGAL);
const CONSENT_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const HISTORICAL_AT = new Date(Date.now() - 24 * 60 * 60 * 1000);
const STATUS_URL = "https://hooks.example.test/integrations/twilio/external-webhook-notice/status";
const TOKEN = "d".repeat(32);
const CURSORS = ["ghl_lead_received", "ghl_lead_received_cutoff", "ghl_lead_received_pending"];

const twilioConfig = {
  ok: true as const,
  config: {
    accountSid: `AC${"a".repeat(32)}`,
    authToken: TOKEN,
    messagingServiceSid: `MG${"b".repeat(32)}`,
    from: null,
  },
};

let db: PrismaClient;
const clientIds: string[] = [];
const eventIds: string[] = [];
let sendSerial = 0;

function phone(n: number): string {
  return `+15555550${String(n).padStart(3, "0")}`;
}

function messageSid(digit: string): string {
  return `SM${digit.repeat(32)}`;
}

function epoch(seconds: number): Date {
  return new Date(Date.UTC(2020, 0, 1, 0, 0, seconds));
}

async function clearCursors(): Promise<void> {
  await db.ghlLeadNoticeDiscoveryCursor.deleteMany({ where: { id: { in: CURSORS } } });
}

async function createClient(label: string): Promise<string> {
  const clientAccountId = `ghlrecv${label}${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  await db.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "GHL recovery test", status: "onboarding" },
  });
  clientIds.push(clientAccountId);
  await db.clientGhlDestination.create({
    data: { clientAccountId, destinationSubaccountIdGhl: `loc${label}` },
  });
  return clientAccountId;
}

async function grantGhlConsent(clientAccountId: string, recipient: string): Promise<void> {
  await db.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      recipientPhoneE164: recipient,
      recipientPhoneVerifiedAt: CONSENT_AT,
      smsEnabled: true,
      smsEnabledAt: CONSENT_AT,
      smsConsentVersion: "ghl-lead-sms-v1",
      smsConsentText: GHL_TEXT,
      smsConsentRecordedAt: CONSENT_AT,
      smsSuppressionState: "clear",
    },
  });
}

async function grantV2Consent(clientAccountId: string, recipient: string): Promise<void> {
  const recordedPhone = await recordNotificationPhone(db, { clientAccountId, phoneE164: recipient });
  assert.equal(recordedPhone.ok, true);
  const consent = await recordSmsConsent(db, {
    clientAccountId,
    version: SMS_CONSENT_VERSION_V2,
    text: V2_TEXT,
  });
  assert.equal(consent.ok, true);
  const enabled = await setSmsNotificationEnabled(db, { clientAccountId, enabled: true });
  assert.equal(enabled.ok, true);
}

async function addLead(): Promise<string> {
  const event = await db.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      rawPayloadJson: {},
    },
  });
  eventIds.push(event.id);
  return event.id;
}

function contactReceipt(contactId: string) {
  return {
    externalCallExecuted: true,
    vetOperationReceipt: {
      operation: "contact",
      outcome: "completed",
      externalId: contactId,
      httpStatus: 200,
      idempotencyKey: `assoc_${contactId}_contact`,
    },
  };
}

async function addRun(input: {
  clientAccountId: string;
  locationId: string;
  sourceLeadEventId: string;
  completedAt: Date;
  contactId: string;
}): Promise<string> {
  const plan = await db.leadDeliveryPlan.create({
    data: {
      masterClientAccountId: input.clientAccountId,
      destinationClientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.locationId,
    },
  });
  const run = await db.ghlLiveDeliveryRun.create({
    data: {
      leadDeliveryPlanId: plan.id,
      masterClientAccountId: input.clientAccountId,
      destinationClientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.locationId,
      mode: "ongoing_association",
      status: "succeeded",
      idempotencyKey: `ghlrecv_${input.sourceLeadEventId}_${input.completedAt.getTime()}`,
      completedAt: input.completedAt,
      stepRuns: {
        create: [
          {
            stepOrder: 1,
            stepType: "create_or_update_contact",
            status: "succeeded",
            externalId: input.contactId,
            responseRedactedJson: contactReceipt(input.contactId),
          },
        ],
      },
    },
  });
  await db.ghlAssociationDispatchOutbox.create({
    data: {
      idempotencyKey: `outbox_${run.id}`,
      status: "settled",
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      destinationLocationIdGhl: input.locationId,
      liveRunId: run.id,
      externalCallExecuted: true,
      availableAt: input.completedAt,
    },
  });
  return run.id;
}

async function insertNotice(input: {
  clientAccountId: string;
  sourceLeadEventId: string;
  locationId: string;
  recipient: string;
  status: ExternalWebhookNoticeStatus;
  completedAt: Date;
  createdAt: Date;
  consentVersion?: string;
  providerMessageId?: string;
  liveRunId: string;
}): Promise<string> {
  const row = await db.ghlLeadReceivedNotice.create({
    data: {
      idempotencyKey: `ghl_lead_received:${input.clientAccountId}:${input.sourceLeadEventId}:${input.locationId}`,
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      destinationLocationIdGhl: input.locationId,
      liveRunId: input.liveRunId,
      contactExternalId: "contactmanual",
      recipient: input.recipient,
      status: input.status,
      consentVersion: input.consentVersion ?? "ghl-lead-sms-v1",
      completedAt: input.completedAt,
      createdAt: input.createdAt,
      provider: input.providerMessageId ? "twilio" : null,
      providerMessageId: input.providerMessageId ?? null,
    },
  });
  return row.id;
}

async function acceptWebhook(clientAccountId: string, leadId: string): Promise<string> {
  const destination = await db.clientExternalWebhookDestination.upsert({
    where: { clientAccountId },
    update: {},
    create: {
      clientAccountId,
      kind: "ghl_inbound",
      endpointUrlCiphertext: "aaa.bbb.ccc",
      endpointUrlFingerprint: "0123456789abcdef",
      endpointHost: "hooks.example.com",
    },
  });
  const payload = JSON.stringify({ source: "recovery-test" });
  const attempt = await db.externalWebhookDeliveryAttempt.create({
    data: {
      idempotencyKey: `external-webhook:${clientAccountId}:${leadId}`,
      clientAccountId,
      destinationId: destination.id,
      sourceLeadEventId: leadId,
      kind: "ghl_inbound",
      destinationRevision: 1,
      endpointHost: "hooks.example.com",
      endpointUrlFingerprint: "0123456789abcdef",
      mappingMode: "v3_canonical",
      payloadCanonicalJson: payload,
      payloadSha256: createHash("sha256").update(payload).digest("hex"),
    },
  });
  await db.externalWebhookDeliveryAttempt.update({
    where: { id: attempt.id },
    data: {
      state: "attempted",
      outcome: "http_accepted",
      httpStatus: 200,
      requestLeftSa360: true,
      proves: ["http_2xx"],
    },
  });
  return attempt.id;
}

async function insertWebhookReceipt(attemptId: string, recipient: string) {
  const attempt = await db.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
  assert.ok(attempt.httpAcceptedAt);
  return db.externalWebhookNotificationReceipt.create({
    data: {
      idempotencyKey: `external_webhook:${attempt.id}:sms:${recipient}`,
      acceptanceId: attempt.id,
      attemptId: attempt.id,
      clientAccountId: attempt.clientAccountId,
      sourceLeadEventId: attempt.sourceLeadEventId,
      destinationId: attempt.destinationId,
      channel: "sms",
      recipient,
      status: "pending",
      acceptedAt: attempt.httpAcceptedAt,
      templateId: "delivery_accepted",
    },
  });
}

function sender(sends: string[]) {
  return async (input: { to: string; body: string }) => {
    sends.push(input.to);
    sendSerial += 1;
    return {
      ok: true as const,
      provider: "twilio" as const,
      providerMessageId: messageSid((sendSerial % 10).toString()),
      providerStatus: "queued" as const,
      statusClass: "pending" as const,
    };
  };
}

before(async () => {
  assert.equal(GHL_TEXT.length >= 160 && GHL_TEXT.length <= 500, true);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await db.$queryRaw`SELECT 1`;
  await clearCursors();
});

after(async () => {
  if (clientIds.length > 0) {
    await db.ghlLeadReceivedNotice.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.externalWebhookNotificationReceipt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.ghlAssociationDispatchOutbox.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.leadDeliveryPlan.deleteMany({ where: { destinationClientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  }
  if (eventIds.length > 0) {
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
  }
  await clearCursors().catch(() => undefined);
  await db.$disconnect().catch(() => undefined);
});

test("pending recovery requeues one eligible row and leaves every other status alone", async () => {
  await clearCursors();
  const absent = await recoverPendingGhlLeadNotices(db, { enqueue: async () => undefined });
  assert.deepEqual(absent, { scanned: 0, enqueued: 0, suppressed: 0 });

  const historicalClient = await createClient("hist");
  await grantGhlConsent(historicalClient, phone(300));
  const historicalLead = await addLead();
  const historicalRun = await addRun({
    clientAccountId: historicalClient,
    locationId: "lochist",
    sourceLeadEventId: historicalLead,
    completedAt: HISTORICAL_AT,
    contactId: "contacthist",
  });
  const cutoff = await discoverGhlLeadNotices(db, { enqueue: async () => undefined });
  assert.equal(cutoff.establishedCutoff, true);
  assert.equal(cutoff.scanned, 0);
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: historicalClient } }), 0);

  const historicalNotice = await insertNotice({
    clientAccountId: historicalClient,
    sourceLeadEventId: historicalLead,
    locationId: "lochist",
    recipient: phone(300),
    status: "pending",
    completedAt: HISTORICAL_AT,
    createdAt: epoch(0),
    liveRunId: historicalRun,
  });
  const beforeCutoff = await recoverPendingGhlLeadNotices(db, { enqueue: async () => undefined });
  assert.equal(beforeCutoff.enqueued, 0);
  assert.equal(
    (await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: historicalNotice } })).status,
    "pending"
  );

  const ok1 = await createClient("ok1");
  const ok2 = await createClient("ok2");
  const race = await createClient("race");
  const v2Client = await createClient("v2");
  await grantGhlConsent(ok1, phone(301));
  await grantGhlConsent(ok2, phone(302));
  await grantGhlConsent(race, phone(303));
  await grantV2Consent(v2Client, phone(304));
  const v2Preference = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId: v2Client },
  });
  assert.equal(smsConsentAllowsNotice(v2Preference), true);
  assert.equal(smsConsentAllowsGhlLeadNotice(v2Preference), false);
  assert.equal(v2Preference.smsConsentVersion, SMS_CONSENT_VERSION_V2);

  const future = Date.now() + 60_000;
  const lead1 = await addLead();
  const lead2 = await addLead();
  const leadRace = await addLead();
  await addRun({
    clientAccountId: ok1,
    locationId: "locok1",
    sourceLeadEventId: lead1,
    completedAt: new Date(future),
    contactId: "contactok1",
  });
  await addRun({
    clientAccountId: ok2,
    locationId: "locok2",
    sourceLeadEventId: lead2,
    completedAt: new Date(future + 1_000),
    contactId: "contactok2",
  });
  await addRun({
    clientAccountId: race,
    locationId: "locrace",
    sourceLeadEventId: leadRace,
    completedAt: new Date(future + 2_000),
    contactId: "contactrace",
  });

  const lostEnqueue = await discoverGhlLeadNotices(db, {
    enqueue: async () => {
      throw new Error("bullmq unavailable");
    },
  });
  assert.equal(lostEnqueue.enqueued, 0);
  assert.equal(lostEnqueue.inserted, 3);
  const scanCursor = await db.ghlLeadNoticeDiscoveryCursor.findUniqueOrThrow({ where: { id: "ghl_lead_received" } });
  assert.notEqual(scanCursor.lastRunId, "");
  const stranded = await db.ghlLeadReceivedNotice.findMany({
    where: { clientAccountId: { in: [ok1, ok2, race] } },
    orderBy: { completedAt: "asc" },
  });
  assert.equal(stranded.length, 3);
  assert.deepEqual(
    stranded.map((row) => row.status),
    ["pending", "pending", "pending"]
  );
  assert.deepEqual(
    stranded.map((row) => row.consentVersion),
    ["ghl-lead-sms-v1", "ghl-lead-sms-v1", "ghl-lead-sms-v1"]
  );
  await db.ghlLeadReceivedNotice.update({ where: { id: stranded[0]!.id }, data: { createdAt: epoch(1) } });
  await db.ghlLeadReceivedNotice.update({ where: { id: stranded[1]!.id }, data: { createdAt: epoch(2) } });
  await db.ghlLeadReceivedNotice.update({ where: { id: stranded[2]!.id }, data: { createdAt: epoch(4) } });

  const v2Lead = await addLead();
  const v2Notice = await insertNotice({
    clientAccountId: v2Client,
    sourceLeadEventId: v2Lead,
    locationId: "locv2",
    recipient: phone(304),
    status: "pending",
    consentVersion: "ghl-lead-sms-v1",
    completedAt: new Date(future + 3_000),
    createdAt: epoch(3),
    liveRunId: "run_v2_manual",
  });
  const terminalLead = await addLead();
  const terminalRun = stranded[0]!.liveRunId;
  const terminalIds: string[] = [];
  const terminalStatuses = ["failed", "uncertain", "suppressed", "sent", "provider_accepted"] as const;
  for (const [index, status] of terminalStatuses.entries()) {
    terminalIds.push(
      await insertNotice({
        clientAccountId: ok1,
        sourceLeadEventId: `${terminalLead}_${status}`,
        locationId: `locterm${index}`,
        recipient: phone(301),
        status,
        completedAt: new Date(future + 4_000),
        createdAt: epoch(10 + index),
        liveRunId: terminalRun,
      })
    );
  }

  const queued: string[] = [];
  const enqueue = async (receiptId: string) => {
    queued.push(receiptId);
  };
  const first = await recoverPendingGhlLeadNotices(db, { limit: 1, enqueue });
  const second = await recoverPendingGhlLeadNotices(db, { limit: 1, enqueue });
  assert.equal(first.enqueued, 1);
  assert.equal(second.enqueued, 1);
  assert.deepEqual(queued, [stranded[0]!.id, stranded[1]!.id]);

  const rejected = await recoverPendingGhlLeadNotices(db, { limit: 1, enqueue });
  assert.equal(rejected.enqueued, 0);
  assert.equal(rejected.suppressed, 1);
  assert.equal((await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: v2Notice } })).status, "suppressed");
  const v2Kept = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: v2Client } });
  assert.equal(v2Kept.smsConsentVersion, SMS_CONSENT_VERSION_V2);
  assert.equal(v2Kept.smsConsentText, V2_TEXT);
  assert.equal(smsConsentAllowsNotice(v2Kept), true);
  assert.equal(smsConsentAllowsGhlLeadNotice(v2Kept), false);

  const third = await recoverPendingGhlLeadNotices(db, { limit: 1, enqueue });
  assert.equal(third.enqueued, 1);
  assert.equal(queued[2], stranded[2]!.id);
  const capped = await recoverPendingGhlLeadNotices(db, { limit: 1000, enqueue });
  assert.ok(capped.scanned <= 20);
  assert.equal(queued.includes(historicalNotice), false);
  for (const id of terminalIds) assert.equal(queued.includes(id), false);
  assert.equal(queued.includes(v2Notice), false);

  const sends: string[] = [];
  const held = await dispatchGhlLeadNotice(db, stranded[0]!.id, { env: {}, twilioConfig, sms: sender(sends) });
  assert.equal(held.skipped, "sms_disabled");
  assert.equal(sends.length, 0);
  assert.equal((await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: stranded[0]!.id } })).status, "pending");

  const retried: string[] = [];
  const recovered = await recoverPendingGhlLeadNotices(db, {
    limit: 20,
    enqueue: async (receiptId) => {
      retried.push(receiptId);
    },
  });
  assert.ok(recovered.scanned <= 20);
  assert.equal(retried.includes(stranded[0]!.id), true);
  assert.equal(retried.includes(historicalNotice), false);
  assert.equal(retried.includes(v2Notice), false);
  for (const id of terminalIds) assert.equal(retried.includes(id), false);

  const sent = await dispatchGhlLeadNotice(db, stranded[0]!.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig,
    sms: sender(sends),
  });
  assert.equal(sent.status, "provider_accepted");
  assert.deepEqual(sends, [phone(301)]);
  const replay = await dispatchGhlLeadNotice(db, stranded[0]!.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig,
    sms: sender(sends),
  });
  assert.equal(replay.skipped, "provider_accepted");
  assert.deepEqual(sends, [phone(301)]);

  const afterSend: string[] = [];
  await recoverPendingGhlLeadNotices(db, {
    limit: 20,
    enqueue: async (receiptId) => {
      afterSend.push(receiptId);
    },
  });
  assert.equal(afterSend.includes(stranded[0]!.id), false);
  for (const status of terminalStatuses) {
    const row = await db.ghlLeadReceivedNotice.findFirstOrThrow({
      where: { clientAccountId: ok1, status },
    });
    assert.equal(afterSend.includes(row.id), false);
  }

  let raceCalls = 0;
  const stopped = await dispatchGhlLeadNotice(db, stranded[2]!.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig,
    afterClaim: async () => {
      await suppressSmsLocally(db, { clientAccountId: race });
    },
    sms: async () => {
      raceCalls += 1;
      throw new Error("twilio called after STOP");
    },
  });
  assert.equal(stopped.status, "suppressed");
  assert.equal(stopped.skipped, "stop_suppressed");
  assert.equal(raceCalls, 0);
  assert.equal(
    (await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: race } })).smsSuppressionState,
    "suppressed"
  );

  const secondSend = await dispatchGhlLeadNotice(db, stranded[1]!.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig,
    sms: sender(sends),
  });
  assert.equal(secondSend.status, "provider_accepted");
  assert.deepEqual(sends, [phone(301), phone(302)]);
  await addRun({
    clientAccountId: ok2,
    locationId: "locok2",
    sourceLeadEventId: lead2,
    completedAt: new Date(future + 120_000),
    contactId: "contactok2b",
  });
  const duplicate = await discoverGhlLeadNotices(db, { enqueue: async () => undefined });
  assert.equal(duplicate.inserted, 0);
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: ok2 } }), 1);
});

test("Twilio 21610 suppresses the phone for GHL and webhook notices", async () => {
  const primary = await createClient("cb");
  const sibling = await createClient("sib");
  const sentClient = await createClient("sent");
  const webhookSent = await createClient("whs");
  const shared = phone(310);
  await grantGhlConsent(primary, shared);
  await grantGhlConsent(sibling, shared);
  await grantGhlConsent(sentClient, phone(311));
  await grantGhlConsent(webhookSent, phone(320));

  const primaryLead = await addLead();
  const siblingLead = await addLead();
  const sentLead = await addLead();
  const webhookLead = await addLead();
  const webhookSentLead = await addLead();
  const ghlSid = messageSid("a");
  const sentSid = messageSid("b");
  const webhookSid = messageSid("c");
  const primaryNotice = await insertNotice({
    clientAccountId: primary,
    sourceLeadEventId: primaryLead,
    locationId: "loccb",
    recipient: shared,
    status: "provider_accepted",
    completedAt: new Date(),
    createdAt: new Date(),
    providerMessageId: ghlSid,
    liveRunId: "run_cb",
  });
  const siblingNotice = await insertNotice({
    clientAccountId: sibling,
    sourceLeadEventId: siblingLead,
    locationId: "locsib",
    recipient: shared,
    status: "pending",
    completedAt: new Date(),
    createdAt: new Date(),
    liveRunId: "run_sib",
  });
  const sentNotice = await insertNotice({
    clientAccountId: sentClient,
    sourceLeadEventId: sentLead,
    locationId: "locsent",
    recipient: phone(311),
    status: "sent",
    completedAt: new Date(),
    createdAt: new Date(),
    providerMessageId: sentSid,
    liveRunId: "run_sent",
  });
  await db.ghlLeadReceivedNotice.update({
    where: { id: sentNotice },
    data: { deliveryEvidence: true, providerStatus: "delivered" },
  });
  const pendingOnWebhookClient = await insertNotice({
    clientAccountId: webhookSent,
    sourceLeadEventId: webhookSentLead,
    locationId: "locwhs",
    recipient: phone(320),
    status: "pending",
    completedAt: new Date(),
    createdAt: new Date(),
    liveRunId: "run_whs",
  });

  const attemptId = await acceptWebhook(primary, webhookLead);
  const webhookReceipt = await insertWebhookReceipt(attemptId, shared);
  const sentAttempt = await acceptWebhook(webhookSent, webhookSentLead);
  const sentWebhook = await insertWebhookReceipt(sentAttempt, phone(320));
  await db.externalWebhookNotificationReceipt.update({
    where: { id: sentWebhook.id },
    data: { status: "sending" },
  });
  await db.externalWebhookNotificationReceipt.update({
    where: { id: sentWebhook.id },
    data: {
      status: "provider_accepted",
      provider: "twilio",
      providerMessageId: webhookSid,
      providerStatus: "queued",
      deliveryEvidence: false,
    },
  });
  await db.externalWebhookNotificationReceipt.update({
    where: { id: sentWebhook.id },
    data: { status: "sent", providerStatus: "delivered", deliveryEvidence: true },
  });

  const callbacks = Fastify();
  await callbacks.register(externalWebhookNoticeCallbackRoutes, {
    statusUrl: STATUS_URL,
    authToken: TOKEN,
  });
  const failParams = { MessageSid: ghlSid, MessageStatus: "failed", ErrorCode: "21610" };
  const unsigned = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams(failParams).toString(),
  });
  assert.equal(unsigned.statusCode, 403);
  assert.equal(
    (await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: primary } })).smsSuppressionState,
    "clear"
  );
  assert.equal((await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: siblingNotice } })).status, "pending");
  assert.equal((await db.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: webhookReceipt.id } })).status, "pending");

  const signed = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, failParams, TOKEN),
    },
    payload: new URLSearchParams(failParams).toString(),
  });
  assert.equal(signed.statusCode, 200);
  assert.match(signed.body, /updated/);
  assert.equal(
    (await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: primary } })).smsSuppressionState,
    "suppressed"
  );
  assert.equal(
    (await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: sibling } })).smsSuppressionState,
    "suppressed"
  );
  assert.equal((await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: primaryNotice } })).status, "suppressed");
  assert.equal((await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: siblingNotice } })).status, "suppressed");
  assert.equal(
    (await db.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: webhookReceipt.id } })).status,
    "suppressed"
  );

  const duplicate = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, failParams, TOKEN),
    },
    payload: new URLSearchParams(failParams).toString(),
  });
  assert.match(duplicate.body, /duplicate/);

  const deliveredParams = { MessageSid: ghlSid, MessageStatus: "delivered" };
  const delivered = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, deliveredParams, TOKEN),
    },
    payload: new URLSearchParams(deliveredParams).toString(),
  });
  assert.match(delivered.body, /duplicate/);
  const closed = await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: primaryNotice } });
  assert.equal(closed.status, "suppressed");
  assert.equal(closed.deliveryEvidence, false);
  assert.equal(
    (await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: primary } })).smsSuppressionState,
    "suppressed"
  );

  const lateStop = { MessageSid: sentSid, MessageStatus: "undelivered", ErrorCode: "21610" };
  const late = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, lateStop, TOKEN),
    },
    payload: new URLSearchParams(lateStop).toString(),
  });
  assert.match(late.body, /updated/);
  const sentRow = await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: sentNotice } });
  assert.equal(sentRow.status, "sent");
  assert.equal(sentRow.deliveryEvidence, true);
  assert.equal(
    (await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: sentClient } })).smsSuppressionState,
    "suppressed"
  );
  const lateAgain = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, lateStop, TOKEN),
    },
    payload: new URLSearchParams(lateStop).toString(),
  });
  assert.match(lateAgain.body, /duplicate/);

  const webhookStop = { MessageSid: webhookSid, MessageStatus: "failed", ErrorCode: "21610" };
  const webhookCallback = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, webhookStop, TOKEN),
    },
    payload: new URLSearchParams(webhookStop).toString(),
  });
  assert.match(webhookCallback.body, /updated/);
  assert.equal((await db.externalWebhookNotificationReceipt.findUniqueOrThrow({ where: { id: sentWebhook.id } })).status, "sent");
  assert.equal((await db.ghlLeadReceivedNotice.findUniqueOrThrow({ where: { id: pendingOnWebhookClient } })).status, "suppressed");
  assert.equal(
    (await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: webhookSent } })).smsSuppressionState,
    "suppressed"
  );
  const webhookAgain = await callbacks.inject({
    method: "POST",
    url: "/integrations/twilio/external-webhook-notice/status",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": twilioRequestSignature(STATUS_URL, webhookStop, TOKEN),
    },
    payload: new URLSearchParams(webhookStop).toString(),
  });
  assert.match(webhookAgain.body, /duplicate/);
  await callbacks.close();
});
