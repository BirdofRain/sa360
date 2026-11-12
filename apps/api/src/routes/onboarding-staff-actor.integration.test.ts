import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { signStaffAssertion, STAFF_ASSERTION_HEADER } from "@sa360/shared/staff-assertion";
import Fastify, { type FastifyInstance } from "fastify";

import { COMPANY_GOOGLE_CONNECTION_KEY } from "../lib/company-google-sheets-env.js";
import { prisma } from "../lib/db.js";
import { SHARED_ADMIN_ACTOR } from "../lib/onboarding-staff-actor.js";
import type { CompanyDriveFile } from "../services/company-google/company-google-drive-http.js";
import type { CompanySheetsDeps } from "../services/company-google/company-sheets-destination.service.js";
import type { GoogleSpreadsheetMetadata } from "../services/google-sheets/google-sheets-http-client.js";
import { adminClientsRoutes } from "./admin-clients.js";
import { adminCompanySheetsConfigRequestRoutes } from "./admin-company-sheets-config-request.js";
import { adminGhlDestinationConfigRequestRoutes } from "./admin-ghl-destination-config-request.js";
import { adminSourceCampaignRequestRoutes } from "./admin-source-campaign-request.js";

const ADMIN_KEY = "named-staff-onboarding-actor-key";
const SECRET = "named-staff-onboarding-actor-secret-32";
const APPROVED_DRIVE = "0ANamedStaffDrive00";
const APPROVED_PARENT = "1NamedStaffParentFolder";
const SHEETS_EMAIL = "sheets-actor@lifeagentlaunch.test";

const savedEnv = {
  admin: process.env.ADMIN_API_KEY,
  alias: process.env.SA360_ADMIN_KEY,
  assertion: process.env.SA360_STAFF_ASSERTION_SECRET,
  setup: process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED,
  source: process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED,
  ghl: process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED,
  sheets: process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED,
  drive: process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID,
  parent: process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID,
};

const clientIds: string[] = [];
const locationIds: string[] = [];
let app: FastifyInstance;
let companyConnectionId = "";
let seq = 0;

type StaffKind = {
  id: string;
  email: string;
};

describe("named staff onboarding attribution", { concurrency: 1 }, () => {
  let ada: StaffKind;
  let grace: StaffKind;
  let operations: StaffKind;
  let administrator: StaffKind;
  let unbound: StaffKind;
  let disabled: StaffKind;

  before(async () => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    delete process.env.SA360_ADMIN_KEY;
    process.env.SA360_STAFF_ASSERTION_SECRET = SECRET;
    process.env.SA360_NATIVE_CLIENT_SETUP_ENABLED = "true";
    process.env.SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED = "true";
    process.env.SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED = "true";
    process.env.SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED = "true";
    process.env.COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID = APPROVED_DRIVE;
    process.env.COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID = APPROVED_PARENT;
    delete process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED;
    delete process.env.SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED;
    delete process.env.SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED;

    ada = await provision("ada", ["team_workspace", "team_manager"]);
    grace = await provision("grace", ["team_workspace", "team_manager"]);
    operations = await provision("sam", ["team_workspace", "team_operations"]);
    administrator = await provision("alex", ["admin_coc"]);
    unbound = await provision("unbound", ["team_manager"], { subject: null });
    disabled = await provision("disabled", ["team_manager"], { active: false });

    await prisma.companyGoogleConnection.deleteMany({ where: { connectionKey: COMPANY_GOOGLE_CONNECTION_KEY } });
    const connection = await prisma.companyGoogleConnection.create({
      data: {
        connectionKey: COMPANY_GOOGLE_CONNECTION_KEY,
        googleUserId: `named-staff-${Date.now()}`,
        googleEmail: SHEETS_EMAIL,
        status: "connected",
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
        tokenVersion: 1,
      },
    });
    companyConnectionId = connection.id;

    app = Fastify({ logger: false });
    await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
    await app.register(adminSourceCampaignRequestRoutes, { prefix: "/admin/v1" });
    await app.register(adminGhlDestinationConfigRequestRoutes, { prefix: "/admin/v1" });
    await app.register(adminCompanySheetsConfigRequestRoutes, {
      prefix: "/admin/v1",
      deps: { sheets: sheetDeps() },
    });
  });

  after(async () => {
    await app.close();
    if (clientIds.length > 0) {
      await prisma.clientOnboardingSetupAuditEvent.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.sourceCampaignAssociationRequest.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.ghlDestinationConfigurationRequest.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.companySheetsDestinationConfigurationRequest.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
      await prisma.ghlLocationConfigSnapshot.deleteMany({ where: { locationId: { in: locationIds } } }).catch(() => undefined);
      await prisma.ghlLocationConnection.deleteMany({ where: { locationId: { in: locationIds } } }).catch(() => undefined);
      await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
    }
    if (companyConnectionId) {
      await prisma.companyGoogleConnection.deleteMany({ where: { id: companyConnectionId } }).catch(() => undefined);
    }
    restore("ADMIN_API_KEY", savedEnv.admin);
    restore("SA360_ADMIN_KEY", savedEnv.alias);
    restore("SA360_STAFF_ASSERTION_SECRET", savedEnv.assertion);
    restore("SA360_NATIVE_CLIENT_SETUP_ENABLED", savedEnv.setup);
    restore("SA360_SOURCE_CAMPAIGN_REQUEST_ENABLED", savedEnv.source);
    restore("SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED", savedEnv.ghl);
    restore("SA360_COMPANY_SHEETS_CONFIG_REQUEST_ENABLED", savedEnv.sheets);
    restore("COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID", savedEnv.drive);
    restore("COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID", savedEnv.parent);
  });

  test("two managers, an administrator, and shared admin are distinguishable on setup audits", async () => {
    const clientAccountId = await createClient();
    const before = await operational(clientAccountId);
    const firstId = randomUUID();
    const first = await patchSetup(clientAccountId, staffHeaders(ada.id), {
      requestId: firstId,
      expectedRevision: 0,
      data: { setupOwner: "Browser Ada", trafficSourceName: "Ada source" },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().replayed, false);

    const secondId = randomUUID();
    const second = await patchSetup(clientAccountId, staffHeaders(grace.id), {
      requestId: secondId,
      expectedRevision: 1,
      data: { setupOwner: "Browser Grace", trafficSourceName: "Grace source" },
    });
    assert.equal(second.statusCode, 200);

    const adminId = randomUUID();
    const namedAdmin = await patchSetup(clientAccountId, staffHeaders(administrator.id), {
      requestId: adminId,
      expectedRevision: 2,
      data: { trafficSourceName: "Admin source" },
    });
    assert.equal(namedAdmin.statusCode, 200);

    const sharedId = randomUUID();
    const shared = await patchSetup(clientAccountId, {
      ...adminHeaders(),
      "x-sa360-admin-actor": grace.email,
      "x-sa360-staff-principal": grace.id,
    }, {
      requestId: sharedId,
      expectedRevision: 3,
      data: { setupOwner: "Shared label", trafficSourceName: "Shared source" },
    });
    assert.equal(shared.statusCode, 200);

    const rows = await prisma.clientOnboardingSetupAuditEvent.findMany({
      where: { clientAccountId },
      orderBy: { createdAt: "asc" },
    });
    assert.deepEqual(rows.map((row) => row.actor), [ada.id, grace.id, administrator.id, SHARED_ADMIN_ACTOR]);
    assert.notEqual(ada.id, grace.id);
    assert.equal(rows.every((row) => row.actor !== "Browser Ada" && row.actor !== grace.email), true);

    const replay = await patchSetup(clientAccountId, staffHeaders(grace.id), {
      requestId: firstId,
      expectedRevision: 0,
      data: { setupOwner: "Browser Ada", trafficSourceName: "Ada source" },
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    const replayed = await prisma.clientOnboardingSetupAuditEvent.findUniqueOrThrow({ where: { requestId: firstId } });
    assert.equal(replayed.actor, ada.id);
    assert.equal(await prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId } }), 4);

    const conflict = await patchSetup(clientAccountId, staffHeaders(grace.id), {
      requestId: secondId,
      expectedRevision: 1,
      data: { trafficSourceName: "Different payload" },
    });
    assert.equal(conflict.statusCode, 409);
    const graceRow = await prisma.clientOnboardingSetupAuditEvent.findUniqueOrThrow({ where: { requestId: secondId } });
    assert.equal(graceRow.actor, grace.id);

    const staleId = randomUUID();
    const stale = await patchSetup(clientAccountId, staffHeaders(ada.id), {
      requestId: staleId,
      expectedRevision: 99,
      data: { trafficSourceName: "Stale" },
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(await prisma.clientOnboardingSetupAuditEvent.findUnique({ where: { requestId: staleId } }), null);

    const invalid = await patchSetup(clientAccountId, adminHeaders({ [STAFF_ASSERTION_HEADER]: "sa1.not-valid.sig" }), {
      requestId: randomUUID(),
      expectedRevision: 4,
      data: {},
    });
    assert.equal(invalid.statusCode, 401);
    assert.equal(invalid.json().error, "staff_unauthenticated");

    const fresh = await createClient();
    for (const person of [operations, unbound, disabled, { id: "c0missing0000000000000000" }]) {
      const denied = await patchSetup(fresh, staffHeaders(person.id), {
        requestId: randomUUID(),
        expectedRevision: 0,
        data: { trafficSourceName: "Should not store" },
      });
      assert.equal(denied.statusCode, 403);
      assert.equal(denied.json().error, "forbidden");
    }
    assert.equal(await prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId: fresh } }), 0);

    const failedSubmit = await patchSetup(fresh, staffHeaders(ada.id), {
      requestId: randomUUID(),
      expectedRevision: 0,
      intent: "submit",
      data: {},
    });
    assert.equal(failedSubmit.statusCode, 422);
    assert.equal(await prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId: fresh, actor: ada.id } }), 0);

    const badActor = await import("../services/client-onboarding-setup.service.js");
    const rejected = await badActor.saveClientOnboardingSetup(fresh, {
      requestId: randomUUID(),
      expectedRevision: 0,
      intent: "save_draft",
      data: { setupOwner: "Matt" },
    }, prisma, "Matt");
    assert.equal(rejected.ok, false);
    assert.equal(await prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId: fresh } }), 0);
    assert.deepEqual(await operational(clientAccountId), before);
    assert.deepEqual(await operational(fresh), before);
  });

  test("source and campaign requests keep the original named actor", async () => {
    const world = await createSourceWorld();
    const before = await operational(world.clientAccountId);
    const firstBody = sourceBody(world);
    const first = await postSource(world.clientAccountId, staffHeaders(ada.id), firstBody);
    assert.equal(first.statusCode, 200, first.body);
    const secondBody = sourceBody(world, { expectedRevision: 1 });
    const second = await postSource(world.clientAccountId, staffHeaders(grace.id), secondBody);
    assert.equal(second.statusCode, 200, second.body);
    const rows = await prisma.sourceCampaignAssociationRequest.findMany({
      where: { clientAccountId: world.clientAccountId },
      orderBy: { revision: "asc" },
    });
    assert.deepEqual(rows.map((row) => row.actor), [ada.id, grace.id]);

    const replay = await postSource(world.clientAccountId, staffHeaders(grace.id), firstBody);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().replayed, true);
    assert.equal(
      (await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({ where: { requestId: firstBody.requestId } })).actor,
      ada.id
    );

    const stale = await postSource(world.clientAccountId, staffHeaders(ada.id), sourceBody(world, { expectedRevision: 50 }));
    assert.equal(stale.statusCode, 409);
    assert.equal(await prisma.sourceCampaignAssociationRequest.count({ where: { clientAccountId: world.clientAccountId } }), 2);

    const shared = await createSourceWorld();
    const sharedBody = sourceBody(shared);
    const stored = await postSource(shared.clientAccountId, adminHeaders({ "x-sa360-admin-actor": "Matt" }), sharedBody);
    assert.equal(stored.statusCode, 200, stored.body);
    assert.equal(
      (await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({ where: { requestId: sharedBody.requestId } })).actor,
      SHARED_ADMIN_ACTOR
    );
    const sharedReplay = await postSource(shared.clientAccountId, staffHeaders(ada.id), sharedBody);
    assert.equal(sharedReplay.json().replayed, true);
    assert.equal(
      (await prisma.sourceCampaignAssociationRequest.findUniqueOrThrow({ where: { requestId: sharedBody.requestId } })).actor,
      SHARED_ADMIN_ACTOR
    );

    const blocked = await createSourceWorld();
    const denied = await postSource(blocked.clientAccountId, staffHeaders(operations.id), sourceBody(blocked));
    assert.equal(denied.statusCode, 403);
    assert.equal(await prisma.sourceCampaignAssociationRequest.count({ where: { clientAccountId: blocked.clientAccountId } }), 0);
    assert.deepEqual(await operational(world.clientAccountId), before);
  });

  test("GoHighLevel configuration requests record the verified principal", async () => {
    const adaWorld = await createGhlWorld();
    const graceWorld = await createGhlWorld();
    const beforeAda = await operational(adaWorld.clientAccountId);
    const adaBody = ghlBody(adaWorld);
    const graceBody = ghlBody(graceWorld);
    const adaSaved = await postGhl(adaWorld.clientAccountId, staffHeaders(ada.id), adaBody);
    const graceSaved = await postGhl(graceWorld.clientAccountId, staffHeaders(grace.id), graceBody);
    assert.equal(adaSaved.statusCode, 200, adaSaved.body);
    assert.equal(graceSaved.statusCode, 200, graceSaved.body);
    assert.equal(
      (await prisma.ghlDestinationConfigurationRequest.findUniqueOrThrow({ where: { requestId: String(adaBody.requestId) } })).actor,
      ada.id
    );
    assert.equal(
      (await prisma.ghlDestinationConfigurationRequest.findUniqueOrThrow({ where: { requestId: String(graceBody.requestId) } })).actor,
      grace.id
    );
    const replay = await postGhl(adaWorld.clientAccountId, staffHeaders(grace.id), adaBody);
    assert.equal(replay.json().replayed, true);
    assert.equal(
      (await prisma.ghlDestinationConfigurationRequest.findUniqueOrThrow({ where: { requestId: String(adaBody.requestId) } })).actor,
      ada.id
    );
    const stale = await postGhl(adaWorld.clientAccountId, staffHeaders(ada.id), ghlBody(adaWorld, { expectedRevision: 9 }));
    assert.equal(stale.statusCode, 409);
    assert.equal(await prisma.ghlDestinationConfigurationRequest.count({ where: { clientAccountId: adaWorld.clientAccountId } }), 1);
    const deniedWorld = await createGhlWorld();
    const denied = await postGhl(deniedWorld.clientAccountId, staffHeaders(operations.id), ghlBody(deniedWorld));
    assert.equal(denied.statusCode, 403);
    assert.equal(await prisma.ghlDestinationConfigurationRequest.count({ where: { clientAccountId: deniedWorld.clientAccountId } }), 0);
    assert.equal(await prisma.clientGhlDestination.count({ where: { clientAccountId: adaWorld.clientAccountId } }), 0);
    assert.deepEqual(await operational(adaWorld.clientAccountId), beforeAda);
  });

  test("one unexpired assertion can attribute a second distinct write", async () => {
    const token = signStaffAssertion({ staffPrincipalId: ada.id, secret: SECRET }).token;
    const headers = adminHeaders({ [STAFF_ASSERTION_HEADER]: token });
    const firstClient = await createClient();
    const secondClient = await createClient();
    const first = await patchSetup(firstClient, headers, {
      requestId: randomUUID(),
      expectedRevision: 0,
      data: { trafficSourceName: "First write" },
    });
    const second = await patchSetup(secondClient, headers, {
      requestId: randomUUID(),
      expectedRevision: 0,
      data: { trafficSourceName: "Second write" },
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(second.statusCode, 200, second.body);
    const actors = await prisma.clientOnboardingSetupAuditEvent.findMany({
      where: { clientAccountId: { in: [firstClient, secondClient] } },
      select: { actor: true },
    });
    assert.deepEqual(actors.map((row) => row.actor), [ada.id, ada.id]);
  });

  test("the widened actor check accepts old ADMIN rows and rejects a principal id under the old rule", async () => {
    const defs = await prisma.$queryRaw<Array<{ name: string; def: string }>>`
      SELECT conname AS name, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conname IN (
        'SourceCampaignAssociationRequest_actor_chk',
        'GhlDestinationConfigurationRequest_actor_chk',
        'CompanySheetsDestConfigRequest_actor_chk'
      )
    `;
    assert.equal(defs.length, 3);
    for (const row of defs) {
      assert.match(row.def, /'ADMIN'/);
      assert.match(row.def, /c\[a-z0-9\]\{24\}/);
    }
    const setupChecks = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conrelid = '"ClientOnboardingSetupAuditEvent"'::regclass
        AND pg_get_constraintdef(oid) ILIKE '%actor%'
    `;
    assert.deepEqual(setupChecks, []);
    const principalId = "c0123456789abcdefghijklmn";
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        CREATE TEMP TABLE old_actor_probe (
          actor text,
          CONSTRAINT old_actor_probe_chk CHECK (actor = 'ADMIN')
        ) ON COMMIT DROP
      `;
      await tx.$executeRaw`
        CREATE TEMP TABLE new_actor_probe (
          actor text,
          CONSTRAINT new_actor_probe_chk CHECK (actor = 'ADMIN' OR actor ~ '^c[a-z0-9]{24}$')
        ) ON COMMIT DROP
      `;
      await tx.$executeRaw`INSERT INTO old_actor_probe (actor) VALUES ('ADMIN')`;
      await tx.$executeRaw`INSERT INTO new_actor_probe (actor) VALUES ('ADMIN'), (${principalId})`;
      await assert.rejects(() => tx.$executeRaw`INSERT INTO old_actor_probe (actor) VALUES (${principalId})`);
      await assert.rejects(() => tx.$executeRaw`INSERT INTO new_actor_probe (actor) VALUES ('ada@lifeagentlaunch.com')`);
    });
  });

  test("Company Sheets configuration requests record the verified principal", async () => {
    const adaClient = await createClient();
    const graceClient = await createClient();
    const before = await operational(adaClient);
    const adaBody = sheetsBody(adaClient);
    const graceBody = sheetsBody(graceClient);
    const adaSaved = await postSheets(adaClient, staffHeaders(ada.id), adaBody);
    const graceSaved = await postSheets(graceClient, staffHeaders(grace.id), graceBody);
    assert.equal(adaSaved.statusCode, 200, adaSaved.body);
    assert.equal(graceSaved.statusCode, 200, graceSaved.body);
    assert.equal(
      (await prisma.companySheetsDestinationConfigurationRequest.findUniqueOrThrow({ where: { requestId: String(adaBody.requestId) } })).actor,
      ada.id
    );
    assert.equal(
      (await prisma.companySheetsDestinationConfigurationRequest.findUniqueOrThrow({ where: { requestId: String(graceBody.requestId) } })).actor,
      grace.id
    );
    const replay = await postSheets(adaClient, staffHeaders(grace.id), adaBody);
    assert.equal(replay.json().replayed, true);
    assert.equal(
      (await prisma.companySheetsDestinationConfigurationRequest.findUniqueOrThrow({ where: { requestId: String(adaBody.requestId) } })).actor,
      ada.id
    );
    const stale = await postSheets(adaClient, staffHeaders(ada.id), sheetsBody(adaClient, { expectedRevision: 8 }));
    assert.equal(stale.statusCode, 409);
    assert.equal(await prisma.companySheetsDestinationConfigurationRequest.count({ where: { clientAccountId: adaClient } }), 1);
    const deniedClient = await createClient();
    const denied = await postSheets(deniedClient, staffHeaders(operations.id), sheetsBody(deniedClient));
    assert.equal(denied.statusCode, 403);
    assert.equal(await prisma.companySheetsDestinationConfigurationRequest.count({ where: { clientAccountId: deniedClient } }), 0);
    assert.equal(await prisma.companySheetsDestination.count({ where: { clientAccountId: adaClient } }), 0);
    assert.deepEqual(await operational(adaClient), before);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function adminHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { "x-sa360-admin-key": ADMIN_KEY, ...extra };
}

function staffHeaders(staffPrincipalId: string): Record<string, string> {
  return adminHeaders({
    [STAFF_ASSERTION_HEADER]: signStaffAssertion({ staffPrincipalId, secret: SECRET }).token,
  });
}

async function provision(
  label: string,
  permissions: Array<"admin_coc" | "team_workspace" | "team_manager" | "team_operations">,
  options: { active?: boolean; subject?: string | null } = {}
): Promise<StaffKind> {
  const email = `${label}.${randomUUID().slice(0, 8)}@lifeagentlaunch.com`;
  const created = await prisma.staffPrincipal.create({
    data: { email, displayName: label, emailVerified: true },
  });
  const active = options.active !== false;
  const subject = options.subject === undefined ? `googlesub${label}${created.id.slice(-8)}` : options.subject;
  if (active || subject) {
    await prisma.staffPrincipal.update({
      where: { id: created.id },
      data: {
        status: active ? "active" : "disabled",
        disabledAt: active ? null : new Date(),
        providerSubject: subject,
      },
    });
  }
  for (const permission of permissions) {
    await prisma.staffPermission.create({
      data: { staffPrincipalId: created.id, permission, status: "granted" },
    });
  }
  return { id: created.id, email };
}

async function createClient(): Promise<string> {
  seq += 1;
  const clientAccountId = `namedstaff${seq}${Date.now().toString(36)}`;
  clientIds.push(clientAccountId);
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: clientAccountId,
      status: "onboarding",
      portalLoginEmail: `${clientAccountId}@portal.example`,
    },
  });
  return clientAccountId;
}

async function operational(clientAccountId: string) {
  const [rules, funnels, targets, ghl, runs, sheets, jobs] = await Promise.all([
    prisma.campaignRoutingRule.count({ where: { clientAccountId } }),
    prisma.sourceFunnel.count({
      where: { OR: [{ originClientAccountId: clientAccountId }, { suggestedClientAccountId: clientAccountId }] },
    }),
    prisma.deliveryTarget.count({ where: { clientAccountId } }),
    prisma.clientGhlDestination.count({ where: { clientAccountId } }),
    prisma.ghlLiveDeliveryRun.count({ where: { destinationClientAccountId: clientAccountId } }),
    prisma.companySheetsDestination.count({ where: { clientAccountId } }),
    prisma.companySheetsDeliveryJob.count({ where: { clientAccountId } }),
  ]);
  return { rules, funnels, targets, ghl, runs, sheets, jobs };
}

function patchSetup(
  clientAccountId: string,
  headers: Record<string, string>,
  body: { requestId: string; expectedRevision: number; intent?: string; data: Record<string, unknown> }
) {
  return app.inject({
    method: "PATCH",
    url: `/admin/v1/clients/${clientAccountId}/setup`,
    headers,
    payload: { intent: "save_draft", ...body },
  });
}

async function createSourceWorld() {
  const clientAccountId = await createClient();
  seq += 1;
  const world = {
    clientAccountId,
    funnelId: `form-${seq}`,
    parentUrlKey: `my.leadcapture.io/p/${seq}`,
    campaignId: `camp-${seq}`,
  };
  await prisma.clientOnboardingSetup.create({
    data: {
      clientAccountId,
      status: "draft",
      revision: 1,
      setupDataJson: {
        providerFunnelId: world.funnelId,
        nextgenFunnelUrl: `https://${world.parentUrlKey}`,
        providerCampaignId: world.campaignId,
        trafficSourceName: "Veteran",
      },
    },
  });
  return world;
}

function sourceBody(
  world: { funnelId: string; parentUrlKey: string; campaignId: string },
  overrides: Record<string, unknown> = {}
) {
  return {
    requestId: randomUUID(),
    expectedRevision: 0,
    setupRevision: 1,
    intent: "request",
    providerFunnelId: world.funnelId,
    parentUrlKey: world.parentUrlKey,
    providerCampaignId: world.campaignId,
    ...overrides,
  };
}

function postSource(clientAccountId: string, headers: Record<string, string>, payload: object) {
  return app.inject({
    method: "POST",
    url: `/admin/v1/clients/${clientAccountId}/source-campaign-requests`,
    headers,
    payload,
  });
}

async function createGhlWorld() {
  const clientAccountId = await createClient();
  seq += 1;
  const locationId = `loc${seq}${Date.now().toString(36)}`;
  locationIds.push(locationId);
  await prisma.ghlLocationConnection.create({
    data: {
      clientAccountId,
      locationId,
      locationName: "Configured location",
      accessTokenEncrypted: "test-access",
      refreshTokenEncrypted: "test-refresh",
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      connectionStatus: "connected",
    },
  });
  await prisma.ghlLocationConfigSnapshot.create({
    data: {
      locationId,
      clientAccountId,
      fetchedAt: new Date(),
      workflowsJson: [{ id: "wf_exact", name: "Published workflow", status: "published" }],
      customFieldsJson: [
        { id: "field_coverage", name: "Desired Coverage", fieldKey: "contact.desired_coverage" },
        { id: "field_branch", name: "Branch of Service", fieldKey: "contact.branch_of_service" },
        { id: "field_reason", name: "Primary Reason", fieldKey: "contact.primary_reason" },
      ],
    },
  });
  return { clientAccountId, locationId };
}

function ghlBody(world: { locationId: string }, overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    expectedRevision: 0,
    expectedDestinationUpdatedAt: null,
    locationId: world.locationId,
    workflowId: "wf_exact",
    fieldMappings: [
      { key: "branch_of_service", fieldId: "field_branch" },
      { key: "desired_coverage", fieldId: "field_coverage" },
      { key: "primary_reason", fieldId: "field_reason" },
    ],
    ...overrides,
  };
}

function postGhl(clientAccountId: string, headers: Record<string, string>, payload: object) {
  return app.inject({
    method: "POST",
    url: `/admin/v1/clients/${clientAccountId}/ghl-destination-configuration`,
    headers,
    payload,
  });
}

function sheetsBody(clientAccountId: string, overrides: Record<string, unknown> = {}) {
  return {
    requestId: randomUUID(),
    expectedRevision: 0,
    expectedDestinationRevision: null,
    spreadsheetId: `1sheet${clientAccountId}`.slice(0, 40),
    worksheetId: 7,
    ...overrides,
  };
}

function postSheets(clientAccountId: string, headers: Record<string, string>, payload: object) {
  return app.inject({
    method: "POST",
    url: `/admin/v1/clients/${clientAccountId}/company-sheets-destination-configuration`,
    headers,
    payload,
  });
}

function sheetDeps(): CompanySheetsDeps {
  return {
    env: process.env,
    db: prisma,
    fetchImpl: async () => {
      throw new Error("configuration request must not call fetch");
    },
    getAccessToken: async () => ({
      ok: true,
      accessToken: "ya29.named-staff",
      connectionId: companyConnectionId,
      tokenVersion: 1,
      googleEmail: SHEETS_EMAIL,
    }),
    getMetadata: async ({ spreadsheetId }) => ({ ok: true, metadata: metadata(spreadsheetId) }),
    getDriveFile: async ({ fileId }) => {
      if (fileId === APPROVED_PARENT) return { ok: true, file: folderFile(APPROVED_PARENT) };
      return { ok: true, file: sheetFile(fileId) };
    },
  };
}

function metadata(id: string): GoogleSpreadsheetMetadata {
  return {
    spreadsheetId: id,
    title: "Acme Leads",
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}`,
    worksheets: [{ sheetId: 7, title: "Campaign", index: 0, hidden: false, sheetType: "GRID" }],
  };
}

function sheetFile(id: string): CompanyDriveFile {
  return {
    id,
    name: "Acme Leads",
    mimeType: "application/vnd.google-apps.spreadsheet",
    ownedByMe: true,
    ownerEmails: [SHEETS_EMAIL],
    driveId: APPROVED_DRIVE,
    parents: [APPROVED_PARENT],
    capabilities: { canEdit: true, canAddChildren: null },
    trashed: false,
    shortcutTargetId: null,
  };
}

function folderFile(id: string): CompanyDriveFile {
  return {
    id,
    name: "Approved parent",
    mimeType: "application/vnd.google-apps.folder",
    ownedByMe: true,
    ownerEmails: [SHEETS_EMAIL],
    driveId: APPROVED_DRIVE,
    parents: [],
    capabilities: { canEdit: true, canAddChildren: true },
    trashed: false,
    shortcutTargetId: null,
  };
}
