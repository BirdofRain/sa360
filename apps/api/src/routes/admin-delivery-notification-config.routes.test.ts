import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import { isTeamWorkspaceApiEnabled as teamWorkspaceFlag } from "../lib/team-workspace-env.js";
import { isTeamWorkspaceApiEnabled as teamWorkspaceReadFlag } from "../services/team-workspace/team-workspace-read.js";
import { isSourceLeadEligibleForClientNotification } from "../services/delivery-success-notification/notification-claim.js";
import { adminDeliveryNotificationConfigRoutes } from "./admin-delivery-notification-config.js";
import { adminTeamWorkspaceRoutes } from "./admin-team-workspace.js";

const ADMIN_KEY = "notification-config-test-key";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const clientIds: string[] = [];
let app: FastifyInstance;
let seq = 0;

describe("client notification configuration", { concurrency: 1 }, () => {

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  flag: process.env.SA360_TEAM_WORKSPACE_ENABLED,
};

before(async () => {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  delete process.env.SA360_ADMIN_KEY;
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
  app = Fastify({ logger: false });
  await app.register(adminTeamWorkspaceRoutes, { prefix: "/admin/v1" });
  await app.register(adminDeliveryNotificationConfigRoutes, { prefix: "/admin/v1" });
});

after(async () => {
  await app.close();
  if (clientIds.length > 0) {
    await prisma.clientDeliveryNotificationConfigRequest
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
    await prisma.deliverySuccessNotification
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
    await prisma.clientDeliveryNotificationPreference
      .deleteMany({ where: { clientAccountId: { in: clientIds } } })
      .catch(() => undefined);
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
  }
  restoreEnv("ADMIN_API_KEY", savedEnv.admin);
  restoreEnv("SA360_ADMIN_KEY", savedEnv.alias);
  restoreEnv("SA360_TEAM_WORKSPACE_ENABLED", savedEnv.flag);
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-sa360-admin-key": ADMIN_KEY, ...extra };
}

function recipientUrl(clientAccountId: string): string {
  return `/admin/v1/clients/${clientAccountId}/delivery-notification-recipient`;
}

function preferenceUrl(clientAccountId: string): string {
  return `/admin/v1/team-workspace/clients/${clientAccountId}/delivery-notification`;
}

function readUrl(clientAccountId: string): string {
  return `/admin/v1/team-workspace/clients/${clientAccountId}`;
}

async function createClient(label: string): Promise<{ clientAccountId: string; portalLoginEmail: string }> {
  seq += 1;
  const clientAccountId = `ntf${label}${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 120);
  const portalLoginEmail = `${clientAccountId}@portal.example`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Notification config",
      status: "onboarding",
      portalLoginEmail,
    },
  });
  clientIds.push(clientAccountId);
  return { clientAccountId, portalLoginEmail };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("notification configuration requires the admin key and rejects foreign credentials", async () => {
  const { clientAccountId } = await createClient("auth");
  const payload = {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    recipientEmail: "owner@example.com",
  };
  const missing = await app.inject({ method: "PUT", url: recipientUrl(clientAccountId), payload });
  assert.equal(missing.statusCode, 401);

  const wrong = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: { "x-sa360-admin-key": "wrong-key" },
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, enabled: true },
  });
  assert.equal(wrong.statusCode, 401);

  const previous = process.env.ADMIN_API_KEY;
  delete process.env.ADMIN_API_KEY;
  delete process.env.SA360_ADMIN_KEY;
  const disabled = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: { "x-sa360-admin-key": ADMIN_KEY },
    payload,
  });
  process.env.ADMIN_API_KEY = previous;
  assert.equal(disabled.statusCode, 503);

  for (const header of [
    "x-sa360-client-portal-key",
    "x-sa360-client-portal-assertion",
    "x-sa360-workspace-key",
  ]) {
    const forbidden = await app.inject({
      method: "PUT",
      url: recipientUrl(clientAccountId),
      headers: adminHeaders({ [header]: "foreign-credential" }),
      payload: { ...payload, requestId: crypto.randomUUID() },
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(forbidden.json().error, "forbidden");
  }

  const row = await prisma.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId } });
  assert.equal(row, null);
});

test("the team workspace gate is exact true for both writes", async () => {
  const { clientAccountId } = await createClient("gate");
  const payload = {
    requestId: crypto.randomUUID(),
    expectedRevision: 0,
    recipientEmail: "owner@example.com",
  };
  for (const flag of [undefined, "", "TRUE", "1", "yes", "on", " true "]) {
    if (flag === undefined) delete process.env.SA360_TEAM_WORKSPACE_ENABLED;
    else process.env.SA360_TEAM_WORKSPACE_ENABLED = flag;
    const res = await app.inject({
      method: "PUT",
      url: flag === " true " ? preferenceUrl(clientAccountId) : recipientUrl(clientAccountId),
      headers: adminHeaders(),
      payload: flag === " true " ? { requestId: crypto.randomUUID(), expectedRevision: 0, enabled: false } : payload,
    });
    if (flag === " true ") {
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().enabled, false);
    } else {
      assert.equal(res.statusCode, 404);
      assert.equal(res.json().error, "team_workspace_disabled");
    }
  }
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
  const unauthenticated = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    payload,
  });
  delete process.env.SA360_TEAM_WORKSPACE_ENABLED;
  assert.equal(unauthenticated.statusCode, 401);
  process.env.SA360_TEAM_WORKSPACE_ENABLED = "true";
  const preference = await prisma.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId } });
  assert.equal(preference, null);
});

test("invalid ids and bodies are rejected before a write", async () => {
  const { clientAccountId } = await createClient("body");
  const badId = await app.inject({
    method: "PUT",
    url: recipientUrl("bad.id"),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "owner@example.com" },
  });
  assert.equal(badId.statusCode, 404);
  assert.equal(badId.json().error, "client_not_found");

  const missingClient = await app.inject({
    method: "PUT",
    url: recipientUrl("missingclient"),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "owner@example.com" },
  });
  assert.equal(missingClient.statusCode, 404);
  assert.equal(missingClient.json().error, "client_not_found");

  const invalidBodies = [
    { url: recipientUrl(clientAccountId), payload: { expectedRevision: 0, recipientEmail: "owner@example.com" } },
    { url: recipientUrl(clientAccountId), payload: { requestId: "not-a-uuid", expectedRevision: 0, recipientEmail: "a@b.com" } },
    { url: recipientUrl(clientAccountId), payload: { requestId: crypto.randomUUID(), expectedRevision: -1, recipientEmail: "a@b.com" } },
    {
      url: recipientUrl(clientAccountId),
      payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "a@b.com", enabled: true },
    },
    {
      url: preferenceUrl(clientAccountId),
      payload: { requestId: crypto.randomUUID(), expectedRevision: 0, enabled: true, recipientEmail: "a@b.com" },
    },
    {
      url: preferenceUrl(clientAccountId),
      payload: { requestId: crypto.randomUUID(), expectedRevision: 0, enabled: "true" },
    },
    {
      url: preferenceUrl(clientAccountId),
      payload: { requestId: crypto.randomUUID(), expectedRevision: 0, enabled: true, enabledAt: "2000-01-01T00:00:00.000Z" },
    },
  ];
  for (const body of invalidBodies) {
    const res = await app.inject({ method: "PUT", url: body.url, headers: adminHeaders(), payload: body.payload });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error, "invalid_body");
  }

  const list = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "a@b.com, c@d.com" },
  });
  assert.equal(list.statusCode, 400);
  assert.equal(list.json().error, "invalid_recipient");
  const named = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "Alex <owner@example.com>" },
  });
  assert.equal(named.statusCode, 400);
  assert.equal(named.json().error, "invalid_recipient");
  assert.equal(await prisma.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId } }), null);
  assert.equal(
    await prisma.clientDeliveryNotificationConfigRequest.count({ where: { clientAccountId } }),
    0
  );
});

test("a recipient save verifies one lowercase mailbox and does not copy the portal login", async () => {
  const { clientAccountId, portalLoginEmail } = await createClient("mail");
  const requestId = crypto.randomUUID();
  const saved = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId, expectedRevision: 0, recipientEmail: "  Owner@Example.com " },
  });
  assert.equal(saved.statusCode, 200);
  const body = saved.json();
  assert.equal(body.ok, true);
  assert.equal(body.replayed, false);
  assert.equal(body.recipientEmail, "owner@example.com");
  assert.equal(body.recipientVerified, true);
  assert.equal(body.enabled, false);
  assert.equal(body.enabledAt, null);
  assert.equal(body.revision, 1);
  assert.equal(body.channel, "email");
  assert.equal(typeof body.recipientEmailVerifiedAt, "string");
  assert.notEqual(body.recipientEmail, portalLoginEmail);
  assert.equal("portalLoginEmail" in body, false);

  const row = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(row.recipientEmail, "owner@example.com");
  assert.ok(row.recipientEmailVerifiedAt);
  assert.equal(row.recipientEmailVerifiedAt.toISOString(), body.recipientEmailVerifiedAt);
  const account = await prisma.clientAccount.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(account.portalLoginEmail, portalLoginEmail);

  const replay = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId, expectedRevision: 0, recipientEmail: "owner@example.com" },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replayed, true);
  assert.equal(replay.json().revision, 1);
  assert.equal(replay.json().recipientEmailVerifiedAt, body.recipientEmailVerifiedAt);
  assert.equal(await prisma.clientDeliveryNotificationConfigRequest.count({ where: { requestId } }), 1);
});

test("revisions conflict until the caller retries, and a request id is not reused for a different write", async () => {
  const first = await createClient("rev");
  const second = await createClient("revb");
  const requestId = crypto.randomUUID();
  const created = await app.inject({
    method: "PUT",
    url: recipientUrl(first.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId, expectedRevision: 0, recipientEmail: "first@example.com" },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().revision, 1);

  const stale = await app.inject({
    method: "PUT",
    url: recipientUrl(first.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "second@example.com" },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, "revision_conflict");
  assert.equal(stale.json().replayed, false);

  const retryId = crypto.randomUUID();
  const conflict = await app.inject({
    method: "PUT",
    url: recipientUrl(first.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: retryId, expectedRevision: 0, recipientEmail: "second@example.com" },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "revision_conflict");
  const retried = await app.inject({
    method: "PUT",
    url: recipientUrl(first.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: retryId, expectedRevision: 1, recipientEmail: "second@example.com" },
  });
  assert.equal(retried.statusCode, 200);
  assert.equal(retried.json().replayed, false);
  assert.equal(retried.json().recipientEmail, "second@example.com");
  assert.equal(retried.json().enabled, false);
  assert.equal(retried.json().revision, 2);
  const replay = await app.inject({
    method: "PUT",
    url: recipientUrl(first.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: retryId, expectedRevision: 1, recipientEmail: "Second@Example.com" },
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().replayed, true);
  assert.equal(replay.json().revision, 2);

  const otherPayload = await app.inject({
    method: "PUT",
    url: recipientUrl(first.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: retryId, expectedRevision: 2, recipientEmail: "third@example.com" },
  });
  assert.equal(otherPayload.statusCode, 409);
  assert.equal(otherPayload.json().error, "request_id_conflict");
  const otherClient = await app.inject({
    method: "PUT",
    url: recipientUrl(second.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId, expectedRevision: 0, recipientEmail: "first@example.com" },
  });
  assert.equal(otherClient.statusCode, 409);
  assert.equal(otherClient.json().error, "request_id_conflict");
  const otherAction = await app.inject({
    method: "PUT",
    url: preferenceUrl(first.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: retryId, expectedRevision: 2, enabled: true },
  });
  assert.equal(otherAction.statusCode, 409);
  assert.equal(otherAction.json().error, "request_id_conflict");

  const row = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId: first.clientAccountId },
  });
  assert.equal(row.recipientEmail, "second@example.com");
  assert.equal(row.enabled, false);
  assert.equal(row.revision, 2);
  assert.equal(
    await prisma.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId: second.clientAccountId } }),
    null
  );
});

test("two creates with one revision let one writer win", async () => {
  const { clientAccountId } = await createClient("race");
  const emails = ["one@example.com", "two@example.com"];
  const responses = await Promise.all(
    emails.map((recipientEmail) =>
      app.inject({
        method: "PUT",
        url: recipientUrl(clientAccountId),
        headers: adminHeaders(),
        payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail },
      })
    )
  );
  const statuses = responses.map((res) => res.statusCode).sort();
  assert.deepEqual(statuses, [200, 409]);
  const winner = responses.find((res) => res.statusCode === 200);
  assert.ok(winner);
  assert.equal(winner.json().error, undefined);
  const row = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(row.revision, 1);
  assert.equal(row.recipientEmail, winner.json().recipientEmail);
  assert.equal(row.enabled, false);
});

test("a repeated request id applies the recipient once", async () => {
  const { clientAccountId } = await createClient("once");
  const payload = { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "once@example.com" };
  const responses = await Promise.all([
    app.inject({ method: "PUT", url: recipientUrl(clientAccountId), headers: adminHeaders(), payload }),
    app.inject({ method: "PUT", url: recipientUrl(clientAccountId), headers: adminHeaders(), payload }),
  ]);
  assert.deepEqual(responses.map((res) => res.statusCode).sort(), [200, 200]);
  const replays = responses.filter((res) => res.json().replayed === true);
  assert.equal(replays.length, 1);
  const row = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(row.revision, 1);
  assert.equal(row.recipientEmail, "once@example.com");
  assert.equal(await prisma.clientDeliveryNotificationConfigRequest.count({ where: { requestId: payload.requestId } }), 1);
});

test("enable without a verified recipient is rejected and the same request stays rejected", async () => {
  const missing = await createClient("unverified");
  const rejectedId = crypto.randomUUID();
  const missingEnable = await app.inject({
    method: "PUT",
    url: preferenceUrl(missing.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: rejectedId, expectedRevision: 0, enabled: true },
  });
  assert.equal(missingEnable.statusCode, 409);
  assert.equal(missingEnable.json().error, "recipient_not_verified");
  assert.equal(missingEnable.json().replayed, false);
  const replay = await app.inject({
    method: "PUT",
    url: preferenceUrl(missing.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: rejectedId, expectedRevision: 0, enabled: true },
  });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().error, "recipient_not_verified");
  assert.equal(replay.json().replayed, true);
  assert.equal(
    await prisma.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId: missing.clientAccountId } }),
    null
  );

  const unverified = await createClient("nullstamp");
  await prisma.clientDeliveryNotificationPreference.create({
    data: {
      clientAccountId: unverified.clientAccountId,
      recipientEmail: "owner@example.com",
      recipientEmailVerifiedAt: null,
      revision: 1,
    },
  });
  const stillOff = await app.inject({
    method: "PUT",
    url: preferenceUrl(unverified.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 1, enabled: true },
  });
  assert.equal(stillOff.statusCode, 409);
  assert.equal(stillOff.json().error, "recipient_not_verified");
  const row = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({
    where: { clientAccountId: unverified.clientAccountId },
  });
  assert.equal(row.enabled, false);
  assert.equal(row.enabledAt, null);

  const off = await app.inject({
    method: "PUT",
    url: preferenceUrl(missing.clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, enabled: false },
  });
  assert.equal(off.statusCode, 200);
  assert.equal(off.json().enabled, false);
  assert.equal(off.json().revision, 0);
  assert.equal(off.json().recipientVerified, false);
  assert.equal("recipientEmail" in off.json(), false);
  assert.equal(
    await prisma.clientDeliveryNotificationPreference.findUnique({ where: { clientAccountId: missing.clientAccountId } }),
    null
  );
});

test("enable, disable, and re-enable move the eligibility clock and keep historical notifications", async () => {
  const { clientAccountId, portalLoginEmail } = await createClient("clock");
  const saved = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "owner@example.com" },
  });
  assert.equal(saved.statusCode, 200);

  const enabled = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 1, enabled: true },
  });
  assert.equal(enabled.statusCode, 200);
  const first = enabled.json();
  assert.equal(first.enabled, true);
  assert.equal(first.recipientVerified, true);
  assert.equal(first.revision, 2);
  assert.equal("recipientEmail" in first, false);
  assert.equal(typeof first.enabledAt, "string");
  const firstEnabledAt = new Date(first.enabledAt);
  const stored = await prisma.clientDeliveryNotificationPreference.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(stored.enabledAt?.toISOString(), first.enabledAt);

  const repeat = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 2, enabled: true },
  });
  assert.equal(repeat.statusCode, 200);
  assert.equal(repeat.json().replayed, false);
  assert.equal(repeat.json().enabledAt, first.enabledAt);
  assert.equal(repeat.json().revision, 2);

  await sleep(30);
  const disabled = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 2, enabled: false },
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().enabled, false);
  assert.equal(disabled.json().enabledAt, first.enabledAt);
  assert.equal(typeof disabled.json().disabledAt, "string");
  assert.equal(disabled.json().revision, 3);

  const historical = await prisma.deliverySuccessNotification.create({
    data: {
      idempotencyKey: `client_lead:${clientAccountId}:historical_lead`,
      clientAccountId,
      sourceLeadEventId: "historical_lead",
      status: "sent",
      sentAt: firstEnabledAt,
    },
  });
  assert.equal(
    isSourceLeadEligibleForClientNotification({
      enabled: false,
      enabledAt: firstEnabledAt,
      completedAt: new Date(firstEnabledAt.getTime() + 1_000),
    }),
    false
  );

  await sleep(30);
  const reenabled = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 3, enabled: true },
  });
  assert.equal(reenabled.statusCode, 200);
  const secondEnabledAt = new Date(reenabled.json().enabledAt);
  assert.ok(secondEnabledAt.getTime() > firstEnabledAt.getTime());
  assert.equal(reenabled.json().revision, 4);
  assert.equal(
    isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: secondEnabledAt,
      completedAt: firstEnabledAt,
    }),
    false
  );
  assert.equal(
    isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: secondEnabledAt,
      completedAt: secondEnabledAt,
    }),
    false
  );
  assert.equal(
    isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: secondEnabledAt,
      completedAt: new Date(secondEnabledAt.getTime() + 1),
    }),
    true
  );

  await sleep(30);
  const changed = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 4, recipientEmail: "Next@Example.com" },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().recipientEmail, "next@example.com");
  assert.equal(changed.json().enabled, false);
  assert.equal(changed.json().enabledAt, reenabled.json().enabledAt);
  assert.equal(changed.json().recipientVerified, true);
  assert.notEqual(changed.json().recipientEmailVerifiedAt, saved.json().recipientEmailVerifiedAt);
  assert.equal(changed.json().revision, 5);
  assert.equal(
    isSourceLeadEligibleForClientNotification({
      enabled: false,
      enabledAt: secondEnabledAt,
      completedAt: new Date(secondEnabledAt.getTime() + 1),
    }),
    false
  );

  await sleep(30);
  const enabledAgain = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 5, enabled: true },
  });
  assert.equal(enabledAgain.statusCode, 200);
  const thirdEnabledAt = new Date(enabledAgain.json().enabledAt);
  assert.ok(thirdEnabledAt.getTime() > secondEnabledAt.getTime());
  assert.equal(
    isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt: thirdEnabledAt,
      completedAt: secondEnabledAt,
    }),
    false
  );

  const sameAddress = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 6, recipientEmail: "  NEXT@example.com " },
  });
  assert.equal(sameAddress.statusCode, 200);
  assert.equal(sameAddress.json().enabled, true);
  assert.equal(sameAddress.json().enabledAt, enabledAgain.json().enabledAt);
  assert.equal(sameAddress.json().recipientEmail, "next@example.com");
  assert.equal(sameAddress.json().revision, 7);

  const kept = await prisma.deliverySuccessNotification.findUniqueOrThrow({ where: { id: historical.id } });
  assert.equal(kept.status, "sent");
  assert.equal(kept.sentAt?.toISOString(), historical.sentAt?.toISOString());
  assert.equal(await prisma.deliverySuccessNotification.count({ where: { clientAccountId } }), 1);
  assert.equal(await prisma.clientGhlDestination.count({ where: { clientAccountId } }), 0);
  assert.equal(await prisma.companySheetsDestination.count({ where: { clientAccountId } }), 0);
  assert.equal(await prisma.deliveryTarget.count({ where: { clientAccountId } }), 0);
  assert.equal(await prisma.campaignRoutingRule.count({ where: { clientAccountId } }), 0);
  assert.equal(await prisma.sourceLeadEvent.count({ where: { clientAccountIdResolved: clientAccountId } }), 0);
  assert.equal(await prisma.clientCustomWebhookDestination.count({ where: { clientAccountId } }), 0);
  const account = await prisma.clientAccount.findUniqueOrThrow({ where: { clientAccountId } });
  assert.equal(account.portalLoginEmail, portalLoginEmail);
});

test("the team workspace read follows recipient and enable writes without returning the mailbox", async () => {
  const { clientAccountId } = await createClient("read");
  const email = "read-owner@example.com";
  const nextEmail = "next-read@example.com";

  const initial = await app.inject({ method: "GET", url: readUrl(clientAccountId), headers: adminHeaders() });
  assert.equal(initial.statusCode, 200);
  assert.deepEqual(initial.json().clientNotification, {
    enabled: false,
    canEnable: false,
    blockedReason: "recipient_not_verified",
    recipientVerified: false,
  });

  const saved = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 0, recipientEmail: "  READ-OWNER@example.com " },
  });
  assert.equal(saved.statusCode, 200);
  const verified = await app.inject({ method: "GET", url: readUrl(clientAccountId), headers: adminHeaders() });
  assert.deepEqual(verified.json().clientNotification, {
    enabled: false,
    canEnable: true,
    blockedReason: null,
    recipientVerified: true,
  });
  assert.equal(verified.body.includes(email), false);

  const enabled = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 1, enabled: true },
  });
  assert.equal(enabled.statusCode, 200);
  const on = await app.inject({ method: "GET", url: readUrl(clientAccountId), headers: adminHeaders() });
  assert.equal(on.json().clientNotification.enabled, true);
  assert.equal(on.json().clientNotification.canEnable, true);
  assert.equal(on.json().clientNotification.recipientVerified, true);
  assert.equal(on.json().clientNotification.blockedReason, null);
  assert.equal(on.body.includes(email), false);

  await sleep(30);
  const disabled = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 2, enabled: false },
  });
  assert.equal(disabled.statusCode, 200);
  const off = await app.inject({ method: "GET", url: readUrl(clientAccountId), headers: adminHeaders() });
  assert.deepEqual(off.json().clientNotification, {
    enabled: false,
    canEnable: true,
    blockedReason: null,
    recipientVerified: true,
  });

  const changed = await app.inject({
    method: "PUT",
    url: recipientUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 3, recipientEmail: nextEmail },
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().enabled, false);
  const afterChange = await app.inject({ method: "GET", url: readUrl(clientAccountId), headers: adminHeaders() });
  assert.deepEqual(afterChange.json().clientNotification, {
    enabled: false,
    canEnable: true,
    blockedReason: null,
    recipientVerified: true,
  });
  assert.equal(afterChange.body.includes(nextEmail), false);

  await sleep(30);
  const reenabled = await app.inject({
    method: "PUT",
    url: preferenceUrl(clientAccountId),
    headers: adminHeaders(),
    payload: { requestId: crypto.randomUUID(), expectedRevision: 4, enabled: true },
  });
  assert.equal(reenabled.statusCode, 200);
  assert.ok(new Date(reenabled.json().enabledAt).getTime() > new Date(enabled.json().enabledAt).getTime());
  const again = await app.inject({ method: "GET", url: readUrl(clientAccountId), headers: adminHeaders() });
  assert.equal(again.json().clientNotification.enabled, true);
  assert.equal(again.json().clientNotification.canEnable, true);
  assert.equal(again.body.includes(email), false);
  assert.equal(again.body.includes(nextEmail), false);
});

test("configuration stays off the observer allowlist and does not own a sender", () => {
  const observer = readFileSync(
    path.join(repoRoot, "apps/admin-coc/src/lib/admin-coc-observer-access.ts"),
    "utf8"
  );
  assert.equal(observer.includes("delivery-notification"), false);
  assert.equal(observer.includes("team-workspace"), false);

  const appSource = readFileSync(path.join(repoRoot, "apps/api/src/app.ts"), "utf8");
  assert.match(appSource, /adminDeliveryNotificationConfigRoutes/);
  assert.match(appSource, /adminTeamWorkspaceRoutes/);
  assert.equal(teamWorkspaceFlag, teamWorkspaceReadFlag);

  const routeSource = readFileSync(
    path.join(repoRoot, "apps/api/src/routes/admin-delivery-notification-config.ts"),
    "utf8"
  );
  const serviceSource = readFileSync(
    path.join(repoRoot, "apps/api/src/services/delivery-success-notification/delivery-notification-config.ts"),
    "utf8"
  );
  for (const source of [routeSource, serviceSource]) {
    assert.equal(source.includes("portalLoginEmail"), false);
    assert.equal(source.includes("sendTransactionalEmail"), false);
    assert.equal(source.includes("scanCanonicalDeliveryNotifications"), false);
    assert.equal(source.includes("SA360_DELIVERY_SUCCESS_NOTIFY_ENABLED"), false);
    assert.equal(source.includes("SA360_GHL_ONGOING_DELIVERY_ENABLED"), false);
    assert.equal(source.includes("SA360_CUSTOM_WEBHOOK_DELIVERY_ENABLED"), false);
  }

  const migration = readFileSync(
    path.join(
      repoRoot,
      "prisma/migrations/20261107040000_client_delivery_notification_config_request/migration.sql"
    ),
    "utf8"
  );
  const statements = migration
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));
  assert.equal(statements[0], "BEGIN;");
  assert.equal(statements.at(-1), "COMMIT;");
  assert.match(migration, /SET LOCAL lock_timeout = '3s'/);
  assert.equal(migration.includes("DeliverySuccessNotification"), false);
  assert.equal(migration.includes('INSERT INTO "ClientDeliveryNotificationPreference"'), false);
});
});
