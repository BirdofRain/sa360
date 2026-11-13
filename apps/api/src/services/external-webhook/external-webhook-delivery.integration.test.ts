import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { prisma } from "../../lib/db.js";
import {
  EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV,
  sealExternalWebhookEndpoint,
} from "../../lib/external-webhook-credentials.js";
import type { PinnedHttpsRequest, PinnedHttpsResult } from "../../lib/external-webhook-http.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { ExternalWebhookResolver } from "../../lib/external-webhook-url-policy.js";
import { externalWebhookAcceptanceEvent } from "./external-webhook-acceptance.js";
import { recordExternalWebhookAttempt } from "./external-webhook-schedule.js";
import {
  deliverExternalWebhookAttempt,
  promoteStaleExternalWebhookSends,
} from "./external-webhook-send.js";

const KEY = "test-external-webhook-credential-key-not-real";
const PUBLIC: ExternalWebhookResolver = async () => [{ address: "8.8.8.8", family: 4 }];

function env(flag: string): NodeJS.ProcessEnv {
  return {
    [EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV]: KEY,
    SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: flag,
  };
}

test("intake schedules the webhook beside Sheets and GHL and enqueues after commit", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../source-intake/source-intake-routing-persist.ts"),
    "utf8"
  );
  const start = source.indexOf("await prisma.$transaction");
  const end = source.indexOf("if (scheduledWebhookAttemptId)");
  const transaction = source.slice(start, end);
  assert.match(transaction, /recordCompanySheetsCampaignIntent/);
  assert.match(transaction, /recordGhlAssociationDispatchOutbox/);
  assert.match(transaction, /recordExternalWebhookAttempt/);
  assert.ok(transaction.indexOf("recordCompanySheetsCampaignIntent") < transaction.indexOf("recordExternalWebhookAttempt"));
  assert.equal(transaction.includes("await enqueueExternalWebhookAttempt"), false);
  assert.match(source.slice(end), /await enqueueExternalWebhookAttempt/);
});

test("external webhook delivery freezes the target, pins a public address, and does not invent other receipts", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const saved = process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
  const savedFlag = process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED;
  process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = KEY;
  process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED = "true";
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const clientAccountId = `ext_send_${stamp}`;
  const sourceLeadEventId = `evt_${stamp}`;
  const sealed = await sealExternalWebhookEndpoint("https://hooks.example.com/hook/path-token", PUBLIC);
  assert.equal(sealed.ok, true);
  if (!sealed.ok) return;
  const posts: PinnedHttpsRequest[] = [];
  const acceptedPost = async (input: PinnedHttpsRequest): Promise<PinnedHttpsResult> => {
    posts.push(input);
    return { httpStatus: 204, timedOut: false, requestLeftSa360: true, refusedRedirect: false };
  };

  try {
    await prisma.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "External webhook sender" },
    });
    await prisma.clientGhlDestination.create({
      data: {
        clientAccountId,
        destinationSubaccountIdGhl: `loc_${stamp}`,
        deliveryMode: "shadow",
        deliveryEnabled: false,
      },
    });
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
    await prisma.companySheetsDispatchIntent.create({
      data: {
        idempotencyKey: `campaign:${clientAccountId}:${sourceLeadEventId}`,
        kind: "campaign_lead",
        status: "pending",
        clientAccountId,
        sourceLeadEventId,
      },
    });

    const skipped = await recordExternalWebhookAttempt(scheduleInput(clientAccountId, sourceLeadEventId), prisma, env("TRUE"));
    assert.equal(skipped, null);
    const scheduled = await recordExternalWebhookAttempt(scheduleInput(clientAccountId, sourceLeadEventId), prisma, env("true"));
    assert.ok(scheduled);
    const again = await recordExternalWebhookAttempt(scheduleInput(clientAccountId, sourceLeadEventId), prisma, env("true"));
    assert.equal(again?.attemptId, scheduled?.attemptId);
    assert.equal(await prisma.externalWebhookDeliveryAttempt.count({ where: { clientAccountId } }), 1);
    const stored = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: scheduled.attemptId } });
    assert.equal(stored.state, "recorded");
    assert.equal(stored.destinationRevision, destination.revision);
    assert.match(stored.payloadCanonicalJson, /"destinationRevision":1/);
    const frozen = stored.payloadCanonicalJson;

    let lookups = 0;
    const flagOff = await deliverExternalWebhookAttempt(stored.id, {
      env: env("false"),
      resolve: async () => {
        lookups += 1;
        return [{ address: "8.8.8.8", family: 4 }];
      },
      post: acceptedPost,
    });
    assert.equal(flagOff.skipped, "flag_off");
    assert.equal(lookups, 0);
    assert.equal(posts.length, 0);

    await prisma.clientExternalWebhookDestination.update({
      where: { id: destination.id },
      data: {
        endpointHost: "other.example.com",
        endpointUrlFingerprint: "fedcba9876543210",
        revision: destination.revision + 1,
      },
    });
    const refused = await deliverExternalWebhookAttempt(stored.id, {
      env: env("true"),
      resolve: PUBLIC,
      post: acceptedPost,
    });
    assert.equal(refused.outcome, "failed");
    assert.equal(posts.length, 0);
    const refusedRow = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: stored.id } });
    assert.equal(refusedRow.payloadCanonicalJson, frozen);
    assert.equal(refusedRow.requestLeftSa360, false);
    assert.equal((await prisma.companySheetsDispatchIntent.findUniqueOrThrow({
      where: { idempotencyKey: `campaign:${clientAccountId}:${sourceLeadEventId}` },
    })).status, "pending");
    assert.equal(await prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } }), 0);

    const secondEvent = `evt_ok_${stamp}`;
    await prisma.clientExternalWebhookDestination.update({
      where: { id: destination.id },
      data: {
        endpointHost: sealed.endpoint.hostname,
        endpointUrlFingerprint: sealed.endpoint.fingerprint,
        revision: destination.revision + 2,
      },
    });
    const live = await recordExternalWebhookAttempt(scheduleInput(clientAccountId, secondEvent), prisma, env("true"));
    assert.ok(live);
    const [first, second] = await Promise.all([
      deliverExternalWebhookAttempt(live.attemptId, { env: env("true"), resolve: PUBLIC, post: acceptedPost }),
      deliverExternalWebhookAttempt(live.attemptId, { env: env("true"), resolve: PUBLIC, post: acceptedPost }),
    ]);
    const outcomes = [first.outcome, first.skipped, second.outcome, second.skipped];
    assert.equal(outcomes.includes("http_accepted"), true);
    assert.equal(outcomes.includes("not_recorded"), true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.pinnedAddress, "8.8.8.8");
    assert.equal(posts[0]?.hostname, "hooks.example.com");
    assert.equal(posts[0]?.pathAndQuery, "/hook/path-token");
    const accepted = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: live.attemptId } });
    const event = externalWebhookAcceptanceEvent(accepted);
    assert.ok(event);
    assert.equal(event?.acceptanceId, accepted.id);
    assert.equal(event?.attemptId, accepted.id);
    assert.equal(event?.httpStatus, 204);
    assert.equal(event?.acceptedAt, accepted.updatedAt.toISOString());
    assert.notEqual(event?.acceptedAt, "2020-01-01T00:00:00.000Z");
    assert.deepEqual(accepted.proves, ["http_2xx"]);

    const privateEvent = `evt_private_${stamp}`;
    const privateAttempt = await recordExternalWebhookAttempt(
      scheduleInput(clientAccountId, privateEvent),
      prisma,
      env("true")
    );
    assert.ok(privateAttempt);
    const beforePrivatePosts = posts.length;
    const blocked = await deliverExternalWebhookAttempt(privateAttempt.attemptId, {
      env: env("true"),
      resolve: async () => [
        { address: "8.8.8.8", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ],
      post: acceptedPost,
    });
    assert.equal(blocked.outcome, "failed");
    assert.equal(posts.length, beforePrivatePosts);

    const timeoutEvent = `evt_timeout_${stamp}`;
    const timeoutAttempt = await recordExternalWebhookAttempt(
      scheduleInput(clientAccountId, timeoutEvent),
      prisma,
      env("true")
    );
    assert.ok(timeoutAttempt);
    const timed = await deliverExternalWebhookAttempt(timeoutAttempt.attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async () => ({ httpStatus: null, timedOut: true, requestLeftSa360: true, refusedRedirect: false }),
    });
    assert.equal(timed.outcome, "uncertain");

    const redirectEvent = `evt_redirect_${stamp}`;
    const redirectAttempt = await recordExternalWebhookAttempt(
      scheduleInput(clientAccountId, redirectEvent),
      prisma,
      env("true")
    );
    assert.ok(redirectAttempt);
    const redirected = await deliverExternalWebhookAttempt(redirectAttempt.attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async () => ({ httpStatus: 302, timedOut: false, requestLeftSa360: true, refusedRedirect: true }),
    });
    assert.equal(redirected.outcome, "uncertain");
    const redirectRow = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({
      where: { id: redirectAttempt.attemptId },
    });
    assert.equal(redirectRow.requestLeftSa360, true);

    const crashEvent = `evt_crash_${stamp}`;
    const crashAttempt = await recordExternalWebhookAttempt(scheduleInput(clientAccountId, crashEvent), prisma, env("true"));
    assert.ok(crashAttempt);
    await prisma.$executeRaw`
      UPDATE "ExternalWebhookDeliveryAttempt"
      SET "state" = 'sending', "updatedAt" = '2020-01-01T00:00:00.000Z'
      WHERE "id" = ${crashAttempt.attemptId}
    `;
    const promoted = await promoteStaleExternalWebhookSends(new Date("2026-11-13T18:00:00.000Z"));
    assert.equal(promoted.promoted >= 1, true);
    const crashed = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: crashAttempt.attemptId } });
    assert.equal(crashed.outcome, "uncertain");
    assert.equal(crashed.requestLeftSa360, true);
    const replay = await deliverExternalWebhookAttempt(crashAttempt.attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: acceptedPost,
    });
    assert.equal(replay.skipped, "not_recorded");
  } finally {
    await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId } });
    await prisma.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId } });
    await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId } });
    await prisma.clientGhlDestination.deleteMany({ where: { clientAccountId } });
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
    if (saved === undefined) delete process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV];
    else process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = saved;
    if (savedFlag === undefined) delete process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED;
    else process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED = savedFlag;
  }
});

function scheduleInput(clientAccountId: string, sourceLeadEventId: string) {
  return {
    sourceLeadEventId,
    status: "routing_matched",
    clientAccountId,
    sourceLeadId: "provider-lead",
    receivedAt: "2026-11-13T16:00:00.000Z",
    normalizedPayload: {
      contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.test", state: "NY" },
      phone: "5550100123",
      lead_details: { date_of_birth: "1979-04-12", consumer_age: "47" },
    },
    sourceFunnelId: null,
    resolvedAt: new Date("2026-11-13T16:00:00.000Z"),
  };
}
