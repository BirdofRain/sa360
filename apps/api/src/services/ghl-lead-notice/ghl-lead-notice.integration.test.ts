import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { recordNotificationPhone, recordSmsConsent, setSmsNotificationEnabled, smsConsentAllowsNotice, suppressSmsLocally, SMS_CONSENT_VERSION_V2 } from "../external-webhook-notification/sms-consent.js";
import { composeGhlLeadSmsConsentText, composeSmsConsentText } from "../external-webhook-notification/sms-disclosure.js";
import { EXTERNAL_WEBHOOK_SMS_TEMPLATES } from "../external-webhook-notification/notification-contract.js";
import { recordRecipientSmsConsent } from "../external-webhook-notification/sms-opt-in.js";
import { GHL_LEAD_RECEIVED_SMS_BODY } from "./contract.js";
import { discoverGhlLeadNotices } from "./discover.js";
import { dispatchGhlLeadNotice } from "./dispatch.js";

const databaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
const PRIVACY = "https://policies.lifeagentlaunch.invalid/privacy";
const TERMS = "https://policies.lifeagentlaunch.invalid/terms";
const LEGAL = { privacyPolicyUrl: PRIVACY, termsUrl: TERMS };
const GHL_TEXT = composeGhlLeadSmsConsentText(LEGAL);
const V2_TEXT = composeSmsConsentText(LEGAL);
const CONSENT_AT = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
const HISTORICAL_AT = new Date(Date.now() - 24 * 60 * 60 * 1000);

const twilioConfig = {
  ok: true as const,
  config: {
    accountSid: `AC${"a".repeat(32)}`,
    authToken: "d".repeat(32),
    messagingServiceSid: `MG${"b".repeat(32)}`,
    from: null,
  },
};

let db: PrismaClient;
const clientIds: string[] = [];
const eventIds: string[] = [];

function phone(n: number): string {
  return `+155555501${String(n).padStart(2, "0")}`;
}

async function createClient(label: string): Promise<string> {
  const clientAccountId = `ghlnote${label}${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  await db.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "GHL notice test", status: "onboarding" },
  });
  clientIds.push(clientAccountId);
  await db.clientGhlDestination.create({
    data: { clientAccountId, destinationSubaccountIdGhl: `loc${label}` },
  });
  return clientAccountId;
}

async function grantGhlConsent(clientAccountId: string, recipient: string, suppressed = false): Promise<void> {
  await db.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId,
      recipientPhoneE164: recipient,
      recipientPhoneVerifiedAt: CONSENT_AT,
      smsEnabled: !suppressed,
      smsEnabledAt: suppressed ? null : CONSENT_AT,
      smsConsentVersion: "ghl-lead-sms-v1",
      smsConsentText: GHL_TEXT,
      smsConsentRecordedAt: CONSENT_AT,
      smsSuppressionState: suppressed ? "suppressed" : "clear",
      smsSuppressedAt: suppressed ? CONSENT_AT : null,
    },
  });
}

async function addLead(sourceType: "webhook" | "bulk_import" = "webhook"): Promise<string> {
  const event = await db.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType,
      rawPayloadJson: {},
      bulkImportId: sourceType === "bulk_import" ? "import1" : null,
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
  contactId?: string;
  mode?: string;
  status?: string;
  outboxStatus?: string;
  workflowFailed?: boolean;
  contactOutcome?: "completed" | "failed";
}): Promise<string> {
  const contactId = input.contactId ?? "contact1";
  const outcome = input.contactOutcome ?? "completed";
  const plan = await db.leadDeliveryPlan.create({
    data: {
      masterClientAccountId: input.clientAccountId,
      destinationClientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.locationId,
    },
  });
  const steps = [
    {
      stepOrder: 1,
      stepType: "create_or_update_contact",
      status: outcome === "completed" ? "succeeded" : "failed",
      externalId: outcome === "completed" ? contactId : null,
      responseRedactedJson:
        outcome === "completed"
          ? contactReceipt(contactId)
          : {
              externalCallExecuted: true,
              vetOperationReceipt: {
                operation: "contact",
                outcome: "failed",
                externalId: null,
                httpStatus: 500,
                idempotencyKey: `assoc_${contactId}_contact`,
              },
            },
    },
  ];
  if (input.workflowFailed) {
    steps.push({
      stepOrder: 2,
      stepType: "start_workflow",
      status: "failed",
      externalId: null,
      responseRedactedJson: {
        externalCallExecuted: true,
        vetOperationReceipt: {
          operation: "workflow",
          outcome: "ambiguous",
          externalId: null,
          httpStatus: 500,
          idempotencyKey: `assoc_${contactId}_workflow`,
        },
      },
    });
  }
  const run = await db.ghlLiveDeliveryRun.create({
    data: {
      leadDeliveryPlanId: plan.id,
      masterClientAccountId: input.clientAccountId,
      destinationClientAccountId: input.clientAccountId,
      destinationSubaccountIdGhl: input.locationId,
      mode: input.mode ?? "ongoing_association",
      status: input.status ?? "succeeded",
      idempotencyKey: `ghlrun_${input.sourceLeadEventId}_${input.completedAt.getTime()}`,
      completedAt: input.completedAt,
      stepRuns: { create: steps },
    },
  });
  await db.ghlAssociationDispatchOutbox.create({
    data: {
      idempotencyKey: `outbox_${run.id}`,
      status: input.outboxStatus ?? "settled",
      clientAccountId: input.clientAccountId,
      sourceLeadEventId: input.sourceLeadEventId,
      destinationLocationIdGhl: input.locationId,
      liveRunId: run.id,
      externalCallExecuted: true,
      lastError: input.workflowFailed ? "workflow" : null,
      availableAt: input.completedAt,
    },
  });
  return run.id;
}

before(async () => {
  assert.equal(GHL_TEXT.length >= 160 && GHL_TEXT.length <= 500, true);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await db.$queryRaw`SELECT 1`;
  await db.ghlLeadNoticeDiscoveryCursor.deleteMany({
    where: { id: { in: ["ghl_lead_received", "ghl_lead_received_cutoff", "ghl_lead_received_pending"] } },
  });
});

after(async () => {
  if (clientIds.length > 0) {
    await db.ghlLeadReceivedNotice.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.ghlAssociationDispatchOutbox.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.leadDeliveryPlan.deleteMany({ where: { destinationClientAccountId: { in: clientIds } } }).catch(() => undefined);
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  }
  if (eventIds.length > 0) {
    await db.sourceLeadEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
  }
  await db.ghlLeadNoticeDiscoveryCursor.deleteMany({
    where: { id: { in: ["ghl_lead_received", "ghl_lead_received_cutoff", "ghl_lead_received_pending"] } },
  }).catch(() => undefined);
  await db.$disconnect().catch(() => undefined);
});

test("one proven GHL contact sends one SMS and every exclusion sends none", async () => {
  const historicalClient = await createClient("hist");
  await grantGhlConsent(historicalClient, phone(1));
  const historicalLead = await addLead();
  await addRun({
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

  const successClient = await createClient("ok");
  const workflowClient = await createClient("wf");
  const failedClient = await createClient("bad");
  const bulkClient = await createClient("bulk");
  const canaryClient = await createClient("can");
  const stopClient = await createClient("stop");
  const v2Client = await createClient("v2");
  await grantGhlConsent(successClient, phone(2));
  await grantGhlConsent(workflowClient, phone(3));
  await grantGhlConsent(failedClient, phone(4));
  await grantGhlConsent(bulkClient, phone(5));
  await grantGhlConsent(canaryClient, phone(6));
  await grantGhlConsent(stopClient, phone(7));
  const v2Phone = await recordNotificationPhone(db, { clientAccountId: v2Client, phoneE164: phone(8) });
  assert.equal(v2Phone.ok, true);
  const v2Consent = await recordSmsConsent(db, { clientAccountId: v2Client, version: SMS_CONSENT_VERSION_V2, text: V2_TEXT });
  assert.equal(v2Consent.ok, true);
  const v2Enabled = await setSmsNotificationEnabled(db, { clientAccountId: v2Client, enabled: true });
  assert.equal(v2Enabled.ok, true);

  const base = Date.now() + 60_000;
  const successLead = await addLead();
  const workflowLead = await addLead();
  const failedLead = await addLead();
  const bulkLead = await addLead("bulk_import");
  const canaryLead = await addLead();
  const stopLead = await addLead();
  const v2Lead = await addLead();
  await addRun({
    clientAccountId: successClient,
    locationId: "locok",
    sourceLeadEventId: successLead,
    completedAt: new Date(base),
    contactId: "contactok",
  });
  await addRun({
    clientAccountId: workflowClient,
    locationId: "locwf",
    sourceLeadEventId: workflowLead,
    completedAt: new Date(base + 1_000),
    contactId: "contactwf",
    status: "failed",
    outboxStatus: "uncertain",
    workflowFailed: true,
  });
  await addRun({
    clientAccountId: failedClient,
    locationId: "locbad",
    sourceLeadEventId: failedLead,
    completedAt: new Date(base + 2_000),
    contactOutcome: "failed",
    status: "failed",
  });
  await addRun({
    clientAccountId: bulkClient,
    locationId: "locbulk",
    sourceLeadEventId: bulkLead,
    completedAt: new Date(base + 3_000),
    contactId: "contactbulk",
  });
  await addRun({
    clientAccountId: canaryClient,
    locationId: "loccan",
    sourceLeadEventId: canaryLead,
    completedAt: new Date(base + 4_000),
    contactId: "contactcan",
    mode: "live_canary",
  });
  await addRun({
    clientAccountId: stopClient,
    locationId: "locstop",
    sourceLeadEventId: stopLead,
    completedAt: new Date(base + 5_000),
    contactId: "contactstop",
  });
  await addRun({
    clientAccountId: v2Client,
    locationId: "locv2",
    sourceLeadEventId: v2Lead,
    completedAt: new Date(base + 6_000),
    contactId: "contactv2",
  });

  const queued: string[] = [];
  const discovered = await discoverGhlLeadNotices(db, {
    enqueue: async (receiptId) => {
      queued.push(receiptId);
    },
  });
  assert.equal(discovered.inserted, 3);
  assert.equal(discovered.enqueued, 3);
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: failedClient } }), 0);
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: bulkClient } }), 0);
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: canaryClient } }), 0);
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: v2Client } }), 0);
  assert.equal(await db.externalWebhookNotificationReceipt.count({ where: { clientAccountId: { in: clientIds } } }), 0);

  const workflowNotice = await db.ghlLeadReceivedNotice.findFirst({ where: { clientAccountId: workflowClient } });
  assert.equal(workflowNotice?.contactExternalId, "contactwf");
  assert.equal(workflowNotice?.event, "ghl_lead_received");
  const workflowRun = await db.ghlLiveDeliveryRun.findFirst({ where: { destinationClientAccountId: workflowClient } });
  assert.equal(workflowRun?.status, "failed");

  const stopped = await suppressSmsLocally(db, { clientAccountId: stopClient });
  assert.equal(stopped.ok, true);
  const stopNotice = await db.ghlLeadReceivedNotice.findFirst({ where: { clientAccountId: stopClient } });
  assert.equal(stopNotice?.status, "suppressed");

  const sends: Array<{ to: string; body: string }> = [];
  const sender = async (input: { to: string; body: string }) => {
    sends.push({ to: input.to, body: input.body });
    return {
      ok: true as const,
      provider: "twilio" as const,
      providerMessageId: `SM${"ab".repeat(16)}`,
      providerStatus: "queued" as const,
      statusClass: "pending" as const,
    };
  };
  const successNotice = await db.ghlLeadReceivedNotice.findFirstOrThrow({ where: { clientAccountId: successClient } });
  const held = await dispatchGhlLeadNotice(db, successNotice.id, {
    env: {},
    twilioConfig,
    sms: sender,
  });
  assert.equal(held.skipped, "sms_disabled");
  assert.equal(sends.length, 0);

  for (const receiptId of queued) {
    await dispatchGhlLeadNotice(db, receiptId, {
      env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
      twilioConfig,
      sms: sender,
    });
  }
  assert.equal(sends.length, 2);
  assert.deepEqual(
    sends.map((call) => call.to).sort(),
    [phone(2), phone(3)].sort()
  );
  for (const call of sends) {
    assert.equal(call.body, GHL_LEAD_RECEIVED_SMS_BODY);
    assert.equal(call.body.includes("contact"), false);
    assert.equal(call.body.includes("@"), false);
    assert.equal(call.body.includes(call.to), false);
  }
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: successClient, status: "provider_accepted" } }), 1);

  const duplicateLeadRun = await addRun({
    clientAccountId: successClient,
    locationId: "locok",
    sourceLeadEventId: successLead,
    completedAt: new Date(base + 120_000),
    contactId: "contactok",
  });
  assert.ok(duplicateLeadRun);
  const again = await discoverGhlLeadNotices(db, { enqueue: async () => undefined });
  assert.equal(again.inserted, 0);
  const second = await dispatchGhlLeadNotice(db, successNotice.id, {
    env: { SA360_SMS_NOTIFICATIONS_ENABLED: "true" },
    twilioConfig,
    sms: sender,
  });
  assert.equal(second.skipped, "provider_accepted");
  assert.equal(sends.length, 2);
  assert.equal(await db.ghlLeadReceivedNotice.count({ where: { clientAccountId: successClient } }), 1);

  const kept = await recordRecipientSmsConsent(db, {
    clientAccountId: v2Client,
    affirmDisclosure: true,
    version: "ghl-lead-sms-v1",
    env: {
      SA360_SMS_OPT_IN_CLIENT_ACCOUNT_ID: v2Client,
      SA360_SMS_PRIVACY_POLICY_URL: PRIVACY,
      SA360_SMS_TERMS_URL: TERMS,
    },
  });
  assert.equal(kept.ok, false);
  if (!kept.ok) assert.equal(kept.code, "prior_consent_retained");
  const stored = await db.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId: v2Client } });
  assert.equal(stored.smsConsentVersion, SMS_CONSENT_VERSION_V2);
  assert.equal(stored.smsConsentText, V2_TEXT);
  assert.equal(smsConsentAllowsNotice(stored), true);
  assert.equal(
    EXTERNAL_WEBHOOK_SMS_TEMPLATES.delivery_accepted,
    "Life Agent Launch: a delivery webhook was accepted. Reply STOP to opt out. Reply HELP for help. Msg & data rates may apply."
  );
});
