import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import Fastify, { type FastifyInstance } from "fastify";

import { prisma } from "../lib/db.js";
import { adminOnboardingAttributionRoutes } from "./admin-onboarding-attribution.js";

const ADMIN_KEY = "onboarding-attribution-test-key";
const NAMED_ACTOR = "c0123456789abcdefghijklmn";
const PAYLOAD_HASH = "a".repeat(64);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

const clientIds: string[] = [];
let app: FastifyInstance;
let seq = 0;

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  setup: process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED,
  source: process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED,
  ghl: process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED,
  sheets: process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED,
};

test("attribution readback stays off the observer list and does not write", () => {
  const route = readFileSync(new URL("./admin-onboarding-attribution.ts", import.meta.url), "utf8");
  const service = readFileSync(new URL("../services/onboarding-attribution-read.ts", import.meta.url), "utf8");
  const observer = readFileSync(
    path.join(repoRoot, "apps/admin-coc/src/lib/admin-coc-observer-access.ts"),
    "utf8"
  );
  assert.equal(observer.includes("onboarding-attribution"), false);
  for (const source of [route, service]) {
    for (const forbidden of [
      "create(",
      "update(",
      "delete(",
      "getSpreadsheetMetadata",
      "ClientGhlDestination",
      "CompanySheetsDestination",
      "createRoutingRule",
      "delivery",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  }
  assert.match(route, /app\.get\(/);
  assert.equal(route.includes("app.post"), false);
  assert.equal(route.includes("SA360_NATIVE_CLIENT_SETUP_ENABLED"), false);
});

describe("onboarding attribution readback", { concurrency: 1 }, () => {
  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    delete process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED;
    delete process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED;
    delete process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED;
    delete process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED;
    app = Fastify({ logger: false });
    await app.register(adminOnboardingAttributionRoutes, { prefix: "/admin/v1" });
  });

  after(async () => {
    await app.close();
    if (clientIds.length > 0) {
      await prisma.clientOnboardingSetupAuditEvent
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.sourceCampaignAssociationRequest
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.ghlDestinationConfigurationRequest
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.companySheetsDestinationConfigurationRequest
        .deleteMany({ where: { clientAccountId: { in: clientIds } } })
        .catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    restore("ADMIN_API_KEY", savedEnv.admin);
    restore("SA360_ADMIN_KEY", savedEnv.alias);
    restore("SA360_NATIVE_CLIENT_SETUP_ENABLED", savedEnv.setup);
    restore("SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED", savedEnv.source);
    restore("SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED", savedEnv.ghl);
    restore("SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED", savedEnv.sheets);
  });

  test("portal, workspace, and missing admin credentials are refused and write nothing", async () => {
    const clientAccountId = await createClient();
    const before = await counts(clientAccountId);
    const requestId = randomUUID();
    const url = attributionUrl(clientAccountId, requestId);

    const missing = await app.inject({ method: "GET", url });
    assert.equal(missing.statusCode, 401);

    const portal = await app.inject({
      method: "GET",
      url,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "x-sa360-client-portal-key": "portal-key" },
    });
    assert.equal(portal.statusCode, 403);

    const assertion = await app.inject({
      method: "GET",
      url,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "x-sa360-client-portal-assertion": "assertion" },
    });
    assert.equal(assertion.statusCode, 403);

    const workspace = await app.inject({
      method: "GET",
      url,
      headers: { "x-sa360-admin-key": ADMIN_KEY, "x-sa360-workspace-key": "workspace-key" },
    });
    assert.equal(workspace.statusCode, 403);

    const wrong = await app.inject({
      method: "GET",
      url,
      headers: { "x-sa360-admin-key": "wrong-key" },
    });
    assert.equal(wrong.statusCode, 401);
    assert.deepEqual(await counts(clientAccountId), before);
  });

  test("a repeated read returns the stored actor and ids without changing the row", async () => {
    const clientAccountId = await createClient();
    const legacyId = randomUUID();
    const namedId = randomUUID();
    const legacy = await prisma.clientOnboardingSetupAuditEvent.create({
      data: {
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        requestId: legacyId,
        action: "save_draft",
        actor: "ADMIN",
      },
    });
    const named = await prisma.sourceCampaignAssociationRequest.create({
      data: {
        requestId: namedId,
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        expectedRevision: 0,
        revision: 1,
        setupRevision: 1,
        providerFunnelId: "form-acceptance",
        providerCampaignId: "acceptance-campaign",
        status: "requested",
        payloadHash: PAYLOAD_HASH,
        recordResultJson: { version: 1 },
        actor: NAMED_ACTOR,
      },
    });
    const before = named.updatedAt.toISOString();

    const first = await read(clientAccountId, namedId);
    const second = await read(clientAccountId, namedId);
    assert.equal(first.statusCode, 200);
    assert.deepEqual(second.json(), first.json());
    assert.deepEqual(first.json(), {
      ok: true,
      clientAccountId,
      recordType: "source_campaign_request",
      recordId: named.id,
      requestId: namedId,
      actor: NAMED_ACTOR,
    });

    const legacyRead = await read(clientAccountId, legacyId);
    assert.equal(legacyRead.statusCode, 200);
    assert.deepEqual(legacyRead.json(), {
      ok: true,
      clientAccountId,
      recordType: "setup_audit",
      recordId: legacy.id,
      requestId: legacyId,
      actor: "ADMIN",
    });

    const stored = await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({ where: { id: named.id } });
    assert.equal(stored.updatedAt.toISOString(), before);
    assert.equal(stored.actor, NAMED_ACTOR);
    assert.equal(await prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId } }), 1);
    assert.equal(await prisma.sourceCampaignAssociationRequest.count({ where: { clientAccountId } }), 1);
  });

  test("configuration-request rows read back and an id shared by two records is refused", async () => {
    const clientAccountId = await createClient();
    const ghlId = randomUUID();
    const sheetsId = randomUUID();
    const sharedId = randomUUID();
    const ghl = await prisma.ghlDestinationConfigurationRequest.create({
      data: {
        requestId: ghlId,
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        expectedRevision: 0,
        revision: 1,
        locationId: "location-acceptance",
        workflowId: "workflow-acceptance",
        fieldMappingsJson: [],
        snapshotId: "snapshot-acceptance",
        snapshotFetchedAt: new Date("2026-11-12T12:00:00.000Z"),
        status: "stored",
        payloadHash: PAYLOAD_HASH,
        recordResultJson: { version: 1 },
        actor: NAMED_ACTOR,
      },
    });
    const sheets = await prisma.companySheetsDestinationConfigurationRequest.create({
      data: {
        requestId: sheetsId,
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        expectedRevision: 0,
        revision: 1,
        spreadsheetId: "sheet-acceptance",
        worksheetId: 1,
        spreadsheetTitle: "Acceptance",
        worksheetTitle: "Grid",
        controlBasis: "drive_owner_verified",
        companyConnectionId: "connection-acceptance",
        controlCheckedAt: new Date("2026-11-12T12:00:00.000Z"),
        status: "stored",
        payloadHash: PAYLOAD_HASH,
        recordResultJson: { version: 1 },
        actor: "ADMIN",
      },
    });

    const ghlRead = await read(clientAccountId, ghlId);
    assert.equal(ghlRead.json().recordType, "ghl_destination_configuration_request");
    assert.equal(ghlRead.json().recordId, ghl.id);
    assert.equal(ghlRead.json().actor, NAMED_ACTOR);
    const sheetsRead = await read(clientAccountId, sheetsId);
    assert.equal(sheetsRead.json().recordType, "company_sheets_destination_configuration_request");
    assert.equal(sheetsRead.json().recordId, sheets.id);
    assert.equal(sheetsRead.json().actor, "ADMIN");

    await prisma.clientOnboardingSetupAuditEvent.create({
      data: {
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        requestId: sharedId,
        action: "save_draft",
        actor: "ADMIN",
      },
    });
    await prisma.sourceCampaignAssociationRequest.create({
      data: {
        requestId: sharedId,
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        expectedRevision: 0,
        revision: 2,
        setupRevision: 1,
        providerFunnelId: "form-acceptance",
        providerCampaignId: "acceptance-campaign",
        status: "requested",
        payloadHash: PAYLOAD_HASH,
        recordResultJson: { version: 1 },
        actor: NAMED_ACTOR,
      },
    });
    const ambiguous = await read(clientAccountId, sharedId);
    assert.equal(ambiguous.statusCode, 409);
    assert.deepEqual(ambiguous.json(), { ok: false, error: "attribution_ambiguous" });
    assert.equal(ambiguous.json().actor, undefined);

    const missing = await read(clientAccountId, randomUUID());
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "attribution_not_found");
    const invalid = await read(clientAccountId, "not-a-request-id");
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "invalid_request_id");
  });
});

function attributionUrl(clientAccountId: string, requestId: string): string {
  return `/admin/v1/clients/${clientAccountId}/onboarding-attribution/${requestId}`;
}

function read(clientAccountId: string, requestId: string) {
  return app.inject({
    method: "GET",
    url: attributionUrl(clientAccountId, requestId),
    headers: { "x-sa360-admin-key": ADMIN_KEY },
  });
}

async function createClient(): Promise<string> {
  seq += 1;
  const clientAccountId = `attr${seq}${Date.now().toString(36)}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Attribution readback",
      status: "onboarding",
      portalLoginEmail: `${clientAccountId}@portal.example`,
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

async function counts(clientAccountId: string) {
  const [setup, source, ghl, sheets] = await Promise.all([
    prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId } }),
    prisma.sourceCampaignAssociationRequest.count({ where: { clientAccountId } }),
    prisma.ghlDestinationConfigurationRequest.count({ where: { clientAccountId } }),
    prisma.companySheetsDestinationConfigurationRequest.count({ where: { clientAccountId } }),
  ]);
  return { setup, source, ghl, sheets };
}

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
