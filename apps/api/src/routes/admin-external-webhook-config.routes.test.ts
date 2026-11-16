import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import {
  decryptExternalWebhookUrl,
  EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV,
} from "../lib/external-webhook-credentials.js";
import type { ExternalWebhookResolver } from "../lib/external-webhook-url-policy.js";
import { adminExternalWebhookConfigRoutes } from "./admin-external-webhook-config.js";
import {
  buildExternalWebhookAttemptRecord,
  projectExternalWebhookPayload,
} from "../services/external-webhook/external-webhook-payload.js";

const ADMIN_KEY = "external-webhook-config-test-key";
const KEY = "test-external-webhook-credential-key-not-real";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const clientIds: string[] = [];
let app: FastifyInstance;
let seq = 0;
const publicResolver: ExternalWebhookResolver = async () => [{ address: "8.8.8.8", family: 4 }];
const privateResolver: ExternalWebhookResolver = async () => [{ address: "10.1.2.3", family: 4 }];

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  key: process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV],
  flag: process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED,
};

describe("external webhook configuration", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    process.env[EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV] = KEY;
    process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED = "false";
    app = Fastify({ logger: false });
    await app.register(adminExternalWebhookConfigRoutes, {
      prefix: "/admin/v1",
      db: prisma,
      resolve: publicResolver,
    });
  });

  after(async () => {
    await app.close();
    if (clientIds.length > 0) {
      await prisma.externalWebhookDeliveryAttempt
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    restore("ADMIN_API_KEY", savedEnv.admin);
    restore("SA360_ADMIN_KEY", savedEnv.alias);
    restore(EXTERNAL_WEBHOOK_CREDENTIAL_KEY_ENV, savedEnv.key);
    restore("SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED", savedEnv.flag);
  });

  test("configuration source does not POST or enable the delivery flag", () => {
    const config = readFileSync(
      path.join(repoRoot, "apps/api/src/services/external-webhook/external-webhook-config.ts"),
      "utf8"
    );
    const route = readFileSync(
      path.join(repoRoot, "apps/api/src/routes/admin-external-webhook-config.ts"),
      "utf8"
    );
    const observer = readFileSync(
      path.join(repoRoot, "apps/admin-coc/src/lib/admin-coc-observer-access.ts"),
      "utf8"
    );
    for (const source of [config, route]) {
      assert.equal(source.includes("postPinnedHttps"), false);
      assert.equal(source.includes("https.request"), false);
      assert.equal(/SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED\s*=/.test(source), false);
      assert.equal(source.includes("company-sheets-delivery"), false);
    }
    assert.equal(observer.includes("external-webhook"), false);
  });

  test("admin key is required and portal, workspace, and observer credentials are denied", async () => {
    const clientAccountId = await createClient("auth");
    const url = base(clientAccountId);
    const denied = [
      { "x-sa360-client-portal-key": "portal", "x-sa360-admin-key": ADMIN_KEY },
      { "x-sa360-client-portal-assertion": "assertion", "x-sa360-admin-key": ADMIN_KEY },
      { "x-sa360-workspace-key": "workspace", "x-sa360-admin-key": ADMIN_KEY },
      { "x-sa360-admin-role": "SA360_OBSERVER", "x-sa360-admin-key": ADMIN_KEY },
    ];
    for (const headers of denied) {
      const response = await app.inject({ method: "PUT", url, headers, payload: saveBody(0) });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error, "forbidden");
    }
    const missing = await app.inject({ method: "PUT", url, payload: saveBody(0) });
    assert.equal(missing.statusCode, 401);
    const wrong = await app.inject({
      method: "GET",
      url,
      headers: { "x-sa360-admin-key": "not-the-admin-key" },
    });
    assert.equal(wrong.statusCode, 401);
    assert.equal(await prisma.clientExternalWebhookDestination.count({ where: { clientAccountId } }), 0);
  });

  test("save stays disabled, encrypts the URL, and replays the same request id", async () => {
    const clientAccountId = await createClient("save");
    const sheetsBefore = await prisma.companySheetsDestination.count();
    const token = `path-token-${clientAccountId}`;
    const secret = `hmac-secret-${clientAccountId}`;
    const requestId = crypto.randomUUID();
    const created = await put(clientAccountId, {
      ...saveBody(0, `https://hooks.example.com/${token}`),
      requestId,
      kind: "external_https",
      authMode: "hmac_sha256",
      signingSecret: secret,
    });
    assert.equal(created.statusCode, 200);
    const body = created.json();
    const serialized = JSON.stringify(body);
    assert.equal(body.enabled, false);
    assert.equal(body.revision, 1);
    assert.equal(body.hostname, "hooks.example.com");
    assert.equal(body.kind, "external_https");
    assert.equal(body.authMode, "hmac_sha256");
    assert.equal(body.replayed, false);
    assert.equal(serialized.includes(token), false);
    assert.equal(serialized.includes(secret), false);
    assert.equal(process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED, "false");
    assert.equal(await prisma.companySheetsDestination.count(), sheetsBefore);

    const row = await prisma.clientExternalWebhookDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(row.enabled, false);
    assert.equal(row.endpointUrlCiphertext.includes(token), false);
    assert.equal(row.signingSecretCiphertext?.includes(secret), false);
    assert.equal(decryptExternalWebhookUrl(row.endpointUrlCiphertext).includes(token), true);
    const stored = await prisma.externalWebhookDestinationConfigRequest.findUniqueOrThrow({ where: { requestId } });
    assert.equal(JSON.stringify(stored.resultJson).includes(token), false);
    assert.equal(JSON.stringify(stored.resultJson).includes(secret), false);

    const replay = await put(clientAccountId, {
      ...saveBody(0, `https://hooks.example.com/${token}`),
      requestId,
      kind: "external_https",
      authMode: "hmac_sha256",
      signingSecret: secret,
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(replay.json().revision, 1);

    const conflict = await put(clientAccountId, {
      ...saveBody(0, "https://other.example.com/hook"),
      requestId,
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, "request_id_conflict");
    assert.equal(
      (await prisma.clientExternalWebhookDestination.findUniqueOrThrow({ where: { clientAccountId } })).revision,
      1
    );
  });

  test("a stale revision is not consumed and a URL change advances revision, host, and fingerprint", async () => {
    const clientAccountId = await createClient("rev");
    const firstToken = `first-${clientAccountId}`;
    const created = await put(clientAccountId, saveBody(0, `https://one.example.com/${firstToken}`));
    assert.equal(created.statusCode, 200);
    const staleId = crypto.randomUUID();
    const stale = await put(clientAccountId, { ...saveBody(0, "https://two.example.com/hook"), requestId: staleId });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error, "revision_conflict");
    assert.equal(await prisma.externalWebhookDestinationConfigRequest.count({ where: { requestId: staleId } }), 0);

    const before = await prisma.clientExternalWebhookDestination.findUniqueOrThrow({ where: { clientAccountId } });
    const nextToken = `second-${clientAccountId}`;
    const changed = await put(clientAccountId, saveBody(1, `https://two.example.net/${nextToken}`));
    assert.equal(changed.statusCode, 200);
    assert.equal(changed.json().hostname, "two.example.net");
    assert.equal(changed.json().revision, 2);
    assert.equal(changed.json().enabled, false);
    const after = await prisma.clientExternalWebhookDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.notEqual(after.endpointUrlFingerprint, before.endpointUrlFingerprint);
    assert.equal(decryptExternalWebhookUrl(after.endpointUrlCiphertext).includes(nextToken), true);
    assert.equal(decryptExternalWebhookUrl(after.endpointUrlCiphertext).includes(firstToken), false);
  });

  test("SSRF failures and GHL inbound auth rules do not save a destination", async () => {
    const clientAccountId = await createClient("ssrf");
    const http = await put(clientAccountId, saveBody(0, "http://hooks.example.com/hook"));
    assert.equal(http.statusCode, 409);
    assert.equal(http.json().code, "not_https");
    const local = await put(clientAccountId, saveBody(0, "https://127.0.0.1/hook"));
    assert.equal(local.statusCode, 409);
    assert.equal(local.json().code, "private_address");
    const metadata = await put(clientAccountId, saveBody(0, "https://metadata.google.internal/hook"));
    assert.equal(metadata.statusCode, 409);
    assert.equal(metadata.json().code, "internal_hostname");

    const privateApp = Fastify({ logger: false });
    await privateApp.register(adminExternalWebhookConfigRoutes, {
      prefix: "/admin/v1",
      db: prisma,
      resolve: privateResolver,
    });
    const dns = await privateApp.inject({
      method: "PUT",
      url: base(clientAccountId),
      headers: admin(),
      payload: saveBody(0, "https://hooks.example.com/hook"),
    });
    assert.equal(dns.statusCode, 409);
    assert.equal(dns.json().code, "dns_private");
    await privateApp.close();

    const ghlAuth = await put(clientAccountId, {
      ...saveBody(0),
      kind: "ghl_inbound",
      authMode: "hmac_sha256",
      signingSecret: "not-allowed",
    });
    assert.equal(ghlAuth.statusCode, 400);
    assert.equal(ghlAuth.json().error, "auth_mode_rejected");
    const secretOnNone = await put(clientAccountId, { ...saveBody(0), signingSecret: "extra" });
    assert.equal(secretOnNone.statusCode, 400);
    assert.equal(secretOnNone.json().error, "signing_secret_rejected");
    assert.equal(await prisma.clientExternalWebhookDestination.count({ where: { clientAccountId } }), 0);
  });

  test("enabling is explicit, rejects a live GHL destination, and leaves Sheets alone", async () => {
    const clientAccountId = await createClient("arm");
    const sheetsBefore = await prisma.companySheetsDestination.count();
    await prisma.clientGhlDestination.create({
      data: {
        clientAccountId,
        destinationSubaccountIdGhl: `loc_${clientAccountId}`,
        deliveryMode: "live",
        deliveryEnabled: true,
        clientCutoverApproved: true,
        internalApprovalStatus: "approved",
      },
    });
    const saved = await put(clientAccountId, saveBody(0, "https://inbound.example.com/hook-token"));
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().enabled, false);
    assert.equal(saved.json().primaryCrmConflict, true);
    const requestId = crypto.randomUUID();
    const blocked = await activate(clientAccountId, { requestId, expectedRevision: 1, enabled: true });
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.json().error, "primary_crm_conflict");
    const still = await prisma.clientExternalWebhookDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(still.enabled, false);
    const ghl = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(ghl.deliveryEnabled, true);
    assert.equal(ghl.deliveryMode, "live");
    assert.equal(await prisma.companySheetsDestination.count(), sheetsBefore);
    assert.equal(await prisma.externalWebhookDestinationConfigRequest.count({ where: { requestId } }), 0);

    await prisma.clientGhlDestination.update({
      where: { clientAccountId },
      data: { deliveryMode: "shadow", deliveryEnabled: false, clientCutoverApproved: false },
    });
    const enabled = await activate(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      enabled: true,
    });
    assert.equal(enabled.statusCode, 200);
    assert.equal(enabled.json().enabled, true);
    assert.equal(enabled.json().revision, 2);
    assert.equal(enabled.json().primaryCrmConflict, false);
    const ghlAfter = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(ghlAfter.deliveryEnabled, false);
    assert.equal(ghlAfter.deliveryMode, "shadow");
    assert.equal(process.env.SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED, "false");

    const disabled = await activate(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 2,
      enabled: false,
    });
    assert.equal(disabled.statusCode, 200);
    assert.equal(disabled.json().enabled, false);
    assert.equal(disabled.json().revision, 3);
  });

  test("preflight does not write and status separates HTTP acceptance from CRM creation", async () => {
    const clientAccountId = await createClient("read");
    const missing = await app.inject({ method: "GET", url: base(clientAccountId), headers: admin() });
    assert.equal(missing.statusCode, 200);
    assert.equal(missing.json().present, false);
    assert.equal(missing.json().revision, 0);
    assert.equal(missing.json().latestAttempt, null);

    const preflight = await app.inject({
      method: "POST",
      url: `${base(clientAccountId)}/preflight`,
      headers: admin(),
      payload: {
        expectedRevision: 0,
        kind: "ghl_inbound",
        authMode: "none",
        endpointUrl: "https://hooks.example.com/preflight-token",
      },
    });
    assert.equal(preflight.statusCode, 200);
    const report = preflight.json();
    assert.equal(report.postsLead, false);
    assert.equal(report.endpointValid, true);
    assert.equal(report.hostname, "hooks.example.com");
    assert.equal(report.credentialsReady, true);
    assert.equal(report.revisionMatches, true);
    assert.equal(report.canary.implemented, false);
    assert.equal(report.canary.consumerLeadData, false);
    assert.equal(report.canary.sandboxEndpointOnly, true);
    assert.equal(JSON.stringify(report).includes("preflight-token"), false);
    assert.equal(await prisma.clientExternalWebhookDestination.count({ where: { clientAccountId } }), 0);

    const saved = await put(clientAccountId, saveBody(0, "https://hooks.example.com/status-token"));
    assert.equal(saved.statusCode, 200);
    const destination = await prisma.clientExternalWebhookDestination.findUniqueOrThrow({
      where: { clientAccountId },
    });
    const projected = projectExternalWebhookPayload({
      destinationKind: "ghl_inbound",
      destinationRevision: destination.revision,
      lead: {
        stableRowId: `row_${clientAccountId}`,
        clientAccountId,
        sourceLeadEventId: `evt_${clientAccountId}`,
        receivedAt: "2026-11-16T16:00:00.000Z",
        sourceLeadId: null,
        normalizedPayload: {
          contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.test" },
          phone: "5550100123",
          lead_details: { date_of_birth: "1979-04-12" },
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
    await prisma.externalWebhookDeliveryAttempt.create({ data: built.record });
    await prisma.externalWebhookDeliveryAttempt.update({
      where: { idempotencyKey: built.record.idempotencyKey },
      data: { state: "attempted", outcome: "http_accepted", httpStatus: 204, requestLeftSa360: true, proves: ["http_2xx"] },
    });
    const status = await app.inject({ method: "GET", url: base(clientAccountId), headers: admin() });
    const view = status.json();
    assert.equal(view.latestAttempt.httpAccepted, true);
    assert.equal(view.latestAttempt.provesCrmCreation, false);
    assert.equal(view.latestAttempt.outcome, "http_accepted");
    assert.equal(view.enabled, false);
    assert.equal(JSON.stringify(view).includes("Ada"), false);
    assert.equal(JSON.stringify(view).includes("status-token"), false);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function admin(): Record<string, string> {
  return { "x-sa360-admin-key": ADMIN_KEY };
}

function base(clientAccountId: string): string {
  return `/admin/v1/clients/${clientAccountId}/external-webhook`;
}

function saveBody(expectedRevision: number, endpointUrl = "https://hooks.example.com/hook") {
  return {
    requestId: crypto.randomUUID(),
    expectedRevision,
    kind: "ghl_inbound" as const,
    authMode: "none" as const,
    endpointUrl,
  };
}

async function createClient(label: string): Promise<string> {
  seq += 1;
  const clientAccountId = `ewc${label}${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "External webhook config" },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

function put(clientAccountId: string, payload: Record<string, unknown>) {
  return app.inject({ method: "PUT", url: base(clientAccountId), headers: admin(), payload });
}

function activate(clientAccountId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "PUT",
    url: `${base(clientAccountId)}/activation`,
    headers: admin(),
    payload,
  });
}
