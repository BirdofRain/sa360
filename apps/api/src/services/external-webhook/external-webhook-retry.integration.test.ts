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
import type { PinnedHttpsResult } from "../../lib/external-webhook-http.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import type { ExternalWebhookResolver } from "../../lib/external-webhook-url-policy.js";
import { recoverExternalWebhookDeliveries } from "./external-webhook-queue.js";
import { recordExternalWebhookAttempt } from "./external-webhook-schedule.js";
import {
  EXTERNAL_WEBHOOK_MAX_SENDS,
  EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS,
  EXTERNAL_WEBHOOK_STALE_SEND_LEASE_MS,
  deliverExternalWebhookAttempt,
  listRecordedExternalWebhookAttemptIds,
  listRecoverableExternalWebhookAttemptIds,
  promoteStaleExternalWebhookSends,
} from "./external-webhook-send.js";

const KEY = "test-external-webhook-credential-key-not-real";
const PUBLIC: ExternalWebhookResolver = async () => [{ address: "8.8.8.8", family: 4 }];
const REFUSED: PinnedHttpsResult = {
  httpStatus: null,
  timedOut: false,
  requestLeftSa360: false,
  refusedRedirect: false,
};
const ACCEPTED: PinnedHttpsResult = {
  httpStatus: 204,
  timedOut: false,
  requestLeftSa360: true,
  refusedRedirect: false,
};

function env(flag: string): NodeJS.ProcessEnv {
  return {
    [EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV]: KEY,
    SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: flag,
  };
}

function later(from: Date, ms: number): Date {
  return new Date(from.getTime() + ms);
}

test("a never-left refusal is retryable and is absent from the recorded-only recovery list", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const world = await openWorld("gap");
  try {
    const attemptId = await schedule(world, "evt_gap");
    let posts = 0;
    const first = await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async () => {
        posts += 1;
        return REFUSED;
      },
    });
    assert.equal(first.outcome, "retryable");
    assert.equal(posts, 1);
    const row = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    assert.equal(row.state, "attempted");
    assert.equal(row.requestLeftSa360, false);
    assert.equal(row.sendCount, 1);
    const recordedOnly = await listRecordedExternalWebhookAttemptIds();
    assert.equal(recordedOnly.includes(attemptId), false);
    const tooSoon = await listRecoverableExternalWebhookAttemptIds(25, prisma, row.updatedAt);
    assert.equal(tooSoon.includes(attemptId), false);
    const ready = await listRecoverableExternalWebhookAttemptIds(
      25,
      prisma,
      later(row.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS)
    );
    assert.equal(ready.includes(attemptId), true);
    assert.equal(await prisma.deliverySuccessNotification.count({ where: { clientAccountId: world.clientAccountId } }), 0);
    const sender = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "external-webhook-send.ts"), "utf8");
    assert.equal(sender.includes("twilio"), false);
    assert.equal(sender.includes("DeliverySuccessNotification"), false);
  } finally {
    await closeWorld(world.clientAccountId);
  }
});

test("a refused connection retries the frozen bytes, then stops, and a later success is one more POST", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const world = await openWorld("retry");
  try {
    const attemptId = await schedule(world, "evt_retry");
    const frozen = (await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } }))
      .payloadCanonicalJson;
    let posts = 0;
    const refuse = async () => {
      posts += 1;
      return REFUSED;
    };
    const first = await deliverExternalWebhookAttempt(attemptId, { env: env("true"), resolve: PUBLIC, post: refuse });
    assert.equal(first.outcome, "retryable");
    const afterFirst = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const immediate = await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: refuse,
      now: afterFirst.updatedAt,
    });
    assert.equal(immediate.skipped, "not_claimable");
    assert.equal(posts, 1);
    assert.equal(afterFirst.payloadCanonicalJson, frozen);

    const second = await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async (input) => {
        posts += 1;
        assert.equal(input.body, frozen);
        assert.equal(input.pinnedAddress, "8.8.8.8");
        return ACCEPTED;
      },
      now: later(afterFirst.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS),
    });
    assert.equal(second.outcome, "http_accepted");
    assert.equal(posts, 2);
    const done = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    assert.equal(done.payloadCanonicalJson, frozen);
    assert.equal(done.sendCount, 2);
    const replay = await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: refuse,
      now: later(done.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS),
    });
    assert.equal(replay.skipped, "not_claimable");
    assert.equal(posts, 2);
  } finally {
    await closeWorld(world.clientAccountId);
  }
});

test("three never-left refusals become terminal failed and are not posted again", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const world = await openWorld("exhaust");
  try {
    const attemptId = await schedule(world, "evt_exhaust");
    let posts = 0;
    let cursor = new Date();
    for (let attempt = 1; attempt <= EXTERNAL_WEBHOOK_MAX_SENDS; attempt += 1) {
      const result = await deliverExternalWebhookAttempt(attemptId, {
        env: env("true"),
        resolve: PUBLIC,
        now: cursor,
        post: async () => {
          posts += 1;
          return REFUSED;
        },
      });
      assert.equal(result.outcome, attempt === EXTERNAL_WEBHOOK_MAX_SENDS ? "failed" : "retryable");
      const row = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      cursor = later(row.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS);
    }
    assert.equal(posts, EXTERNAL_WEBHOOK_MAX_SENDS);
    const row = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    assert.equal(row.outcome, "failed");
    assert.equal(row.requestLeftSa360, false);
    assert.equal(row.sendCount, EXTERNAL_WEBHOOK_MAX_SENDS);
    const again = await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      now: later(cursor, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS),
      post: async () => {
        posts += 1;
        return ACCEPTED;
      },
    });
    assert.equal(again.skipped, "not_claimable");
    assert.equal(posts, EXTERNAL_WEBHOOK_MAX_SENDS);
    assert.equal(
      (await listRecoverableExternalWebhookAttemptIds(25, prisma, later(cursor, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS))).includes(
        attemptId
      ),
      false
    );
  } finally {
    await closeWorld(world.clientAccountId);
  }
});

test("timeout, redirect, and an unknown completion are not retried", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const world = await openWorld("uncertain");
  try {
    for (const [name, result] of [
      ["timeout", { httpStatus: null, timedOut: true, requestLeftSa360: true, refusedRedirect: false }],
      ["redirect", { httpStatus: 302, timedOut: false, requestLeftSa360: true, refusedRedirect: true }],
      ["reset", { httpStatus: null, timedOut: false, requestLeftSa360: true, refusedRedirect: false }],
    ] as const) {
      const attemptId = await schedule(world, `evt_${name}`);
      let posts = 0;
      const first = await deliverExternalWebhookAttempt(attemptId, {
        env: env("true"),
        resolve: PUBLIC,
        post: async () => {
          posts += 1;
          return result;
        },
      });
      assert.equal(first.outcome, "uncertain");
      const row = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
      const second = await deliverExternalWebhookAttempt(attemptId, {
        env: env("true"),
        resolve: PUBLIC,
        now: later(row.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS * 4),
        post: async () => {
          posts += 1;
          return ACCEPTED;
        },
      });
      assert.equal(second.skipped, "not_claimable");
      assert.equal(posts, 1);
      assert.equal(
        (await listRecoverableExternalWebhookAttemptIds(25, prisma, later(row.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS * 4))).includes(
          attemptId
        ),
        false
      );
    }
  } finally {
    await closeWorld(world.clientAccountId);
  }
});

test("a URL revision during backoff refuses the retry without posting", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const world = await openWorld("retarget");
  try {
    const attemptId = await schedule(world, "evt_retarget");
    await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async () => REFUSED,
    });
    const before = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    await prisma.clientExternalWebhookDestination.update({
      where: { id: world.destinationId },
      data: {
        endpointHost: "other.example.com",
        endpointUrlFingerprint: "fedcba9876543210",
        revision: { increment: 1 },
      },
    });
    let posts = 0;
    const refused = await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      now: later(before.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS),
      post: async () => {
        posts += 1;
        return ACCEPTED;
      },
    });
    assert.equal(refused.outcome, "failed");
    assert.equal(posts, 0);
    const after = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    assert.equal(after.payloadCanonicalJson, before.payloadCanonicalJson);
    assert.equal(after.destinationRevision, before.destinationRevision);
  } finally {
    await closeWorld(world.clientAccountId);
  }
});

test("two retry workers post once, and a young sending claim is not promoted", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const world = await openWorld("race");
  try {
    const attemptId = await schedule(world, "evt_race");
    await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async () => REFUSED,
    });
    const readyAt = later(
      (await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } })).updatedAt,
      EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS
    );
    let posts = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const post = async () => {
      posts += 1;
      await gate;
      return ACCEPTED;
    };
    const first = deliverExternalWebhookAttempt(attemptId, { env: env("true"), resolve: PUBLIC, now: readyAt, post });
    const second = deliverExternalWebhookAttempt(attemptId, { env: env("true"), resolve: PUBLIC, now: readyAt, post });
    const started = Date.now();
    while (posts < 1 && Date.now() - started < 5_000) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(posts, 1);
    await promoteStaleExternalWebhookSends(new Date());
    const during = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    assert.equal(during.state, "sending");
    release();
    const results = await Promise.all([first, second]);
    assert.equal(posts, 1);
    assert.equal(results.some((result) => result.outcome === "http_accepted"), true);
    assert.equal(results.some((result) => result.skipped === "not_claimable"), true);

    const staleId = await schedule(world, "evt_stale");
    await prisma.$executeRaw`
      UPDATE "ExternalWebhookDeliveryAttempt"
      SET "state" = 'sending', "sendCount" = 1, "updatedAt" = ${later(readyAt, -10_000)}
      WHERE "id" = ${staleId}
    `;
    await promoteStaleExternalWebhookSends(readyAt);
    assert.equal((await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: staleId } })).state, "sending");
    await prisma.$executeRaw`
      UPDATE "ExternalWebhookDeliveryAttempt"
      SET "updatedAt" = ${later(readyAt, -(EXTERNAL_WEBHOOK_STALE_SEND_LEASE_MS + 1_000))}
      WHERE "id" = ${staleId}
    `;
    let stalePosts = 0;
    await promoteStaleExternalWebhookSends(readyAt);
    const replay = await deliverExternalWebhookAttempt(staleId, {
      env: env("true"),
      resolve: PUBLIC,
      now: later(readyAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS),
      post: async () => {
        stalePosts += 1;
        return ACCEPTED;
      },
    });
    assert.equal(replay.skipped, "not_claimable");
    assert.equal(stalePosts, 0);
    assert.equal(
      (await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: staleId } })).outcome,
      "uncertain"
    );
  } finally {
    await closeWorld(world.clientAccountId);
  }
});

test("recovery honors the flag and a disabled destination, and survives an enqueue outage", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const world = await openWorld("recover");
  try {
    const attemptId = await schedule(world, "evt_recover");
    await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async () => REFUSED,
    });
    const row = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const ready = later(row.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS);
    let calls = 0;
    const held = await recoverExternalWebhookDeliveries(env("false"), {
      now: ready,
      enqueue: async () => {
        calls += 1;
      },
    });
    assert.equal(held.enqueued, 0);
    assert.equal(calls, 0);
    assert.equal(
      (await prisma.clientExternalWebhookDestination.findUniqueOrThrow({ where: { id: world.destinationId } })).enabled,
      true
    );

    await prisma.clientExternalWebhookDestination.update({
      where: { id: world.destinationId },
      data: { enabled: false },
    });
    const disabled = await recoverExternalWebhookDeliveries(env("true"), {
      now: ready,
      enqueue: async () => {
        calls += 1;
      },
    });
    assert.equal(disabled.enqueued, 0);
    assert.equal(calls, 0);
    assert.equal(
      (await prisma.clientExternalWebhookDestination.findUniqueOrThrow({ where: { id: world.destinationId } })).enabled,
      false
    );
    const blocked = await deliverExternalWebhookAttempt(attemptId, {
      env: env("true"),
      resolve: PUBLIC,
      now: ready,
      post: async () => ACCEPTED,
    });
    assert.equal(blocked.outcome, "failed");
    assert.equal(
      (await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: attemptId } })).requestLeftSa360,
      false
    );

    await prisma.clientExternalWebhookDestination.update({
      where: { id: world.destinationId },
      data: { enabled: true },
    });
    const freshId = await schedule(world, "evt_redis");
    await deliverExternalWebhookAttempt(freshId, {
      env: env("true"),
      resolve: PUBLIC,
      post: async () => REFUSED,
    });
    const fresh = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: freshId } });
    const frozen = fresh.payloadCanonicalJson;
    await assert.rejects(
      () =>
        recoverExternalWebhookDeliveries(env("true"), {
          now: later(fresh.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS),
          enqueue: async () => {
            throw new Error("redis_down");
          },
        }),
      /redis_down/
    );
    const waiting = await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: freshId } });
    assert.equal(waiting.outcome, "retryable");
    assert.equal(waiting.payloadCanonicalJson, frozen);
    const queued: string[] = [];
    const recovered = await recoverExternalWebhookDeliveries(env("true"), {
      now: later(fresh.updatedAt, EXTERNAL_WEBHOOK_RETRY_BACKOFF_MS),
      enqueue: async (id) => {
        queued.push(id);
      },
    });
    assert.equal(recovered.enqueued >= 1, true);
    assert.equal(queued.includes(freshId), true);
    assert.equal(
      (await prisma.externalWebhookDeliveryAttempt.findUniqueOrThrow({ where: { id: freshId } })).payloadCanonicalJson,
      frozen
    );
  } finally {
    await closeWorld(world.clientAccountId);
  }
});

async function openWorld(label: string): Promise<{ clientAccountId: string; destinationId: string }> {
  process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = KEY;
  process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED = "true";
  const stamp = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const clientAccountId = `ext_${label}_${stamp}`;
  const sealed = await sealExternalWebhookEndpoint("https://hooks.example.com/hook/path-token", PUBLIC);
  if (!sealed.ok) throw new Error("seal_failed");
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: `External webhook ${label}` },
  });
  const destination = await prisma.clientExternalWebhookDestination.create({
    data: {
      clientAccountId,
      kind: "external_https",
      endpointUrlCiphertext: sealed.endpoint.ciphertext,
      endpointUrlFingerprint: sealed.endpoint.fingerprint,
      endpointHost: sealed.endpoint.hostname,
      enabled: true,
    },
  });
  return { clientAccountId, destinationId: destination.id };
}

async function schedule(world: { clientAccountId: string }, sourceLeadEventId: string): Promise<string> {
  const scheduled = await recordExternalWebhookAttempt(
    {
      sourceLeadEventId,
      status: "routing_matched",
      clientAccountId: world.clientAccountId,
      sourceLeadId: "provider-lead",
      receivedAt: "2026-11-16T15:00:00.000Z",
      normalizedPayload: {
        contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.test" },
        phone: "5550100123",
      },
      sourceFunnelId: null,
      resolvedAt: new Date("2026-11-16T15:00:00.000Z"),
    },
    prisma,
    env("true")
  );
  if (!scheduled) throw new Error("schedule_failed");
  return scheduled.attemptId;
}

async function closeWorld(clientAccountId: string): Promise<void> {
  await prisma.externalWebhookDeliveryAttempt.deleteMany({ where: { clientAccountId } });
  await prisma.clientExternalWebhookDestination.deleteMany({ where: { clientAccountId } });
  await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  delete process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED;
}
