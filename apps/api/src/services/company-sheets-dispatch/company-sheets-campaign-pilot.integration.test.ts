/**
 * Local sa360_test coverage for the internal campaign pilot. No live Google calls.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import Fastify from "fastify";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_LEAD_HEADER,
} from "../../lib/company-google-sheets-env.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { adminCompanySheetsDeliveryRoutes } from "../../routes/company-sheets-delivery.js";
import type { CompanySheetsDeliveryDeps } from "../company-sheets-delivery/company-sheets-delivery.service.js";
import {
  COMPANY_SHEETS_PILOT_EMAIL,
  COMPANY_SHEETS_PILOT_PHONE,
  COMPANY_SHEETS_PILOT_ROUTE_KEY,
  submitCompanySheetsCampaignPilot,
  type CompanySheetsPilotConfirmation,
} from "./company-sheets-campaign-pilot.js";
import { processDueCompanySheetsDispatches } from "./company-sheets-dispatch.service.js";
import { companySheetsInternalPilotLeadExclusion } from "./company-sheets-pilot-isolation.js";
import { trackCampaignInventoryFromSourceEvent } from "../lead-inventory/campaign-inventory-tracking.service.js";
import { approveSourceLeadDelivery } from "../source-intake/source-lead-delivery.service.js";
import { generateLeadDeliveryPlanForDecision } from "../lead-delivery-plan.service.js";
import { SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION } from "../source-intake/source-intake.types.js";
import { listLiveLeadPool } from "../live-lead-pool/live-lead-pool.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const EMAIL = "pilot@lifeagentlaunch.test";
const HEADER = "x-sa360-admin-key";

class MemorySheet {
  rows: string[][] = [];
  appends: string[][][] = [];
  calls = 0;

  async fetch(url: string, init?: RequestInit): Promise<Response> {
    this.calls += 1;
    if (url.includes("USER_ENTERED") || url.includes("/permissions") || url.includes("type=anyone")) {
      throw new Error(`refused Google call ${url}`);
    }
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : null;
    if (method === "PUT") {
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      this.rows[0] = parsed.values?.[0] ?? [];
      return json(200, {});
    }
    if (method === "POST") {
      const parsed = JSON.parse(body ?? "{}") as { values?: string[][] };
      const values = parsed.values ?? [];
      this.appends.push(values);
      for (const row of values) this.rows.push(row);
      return json(200, {});
    }
    const decoded = decodeURIComponent(url);
    if (decoded.includes("A1:ZZ2")) return json(200, { values: this.rows.slice(0, 2) });
    if (decoded.includes("!A1:A")) return json(200, { values: this.rows.map((row) => [row[0] ?? ""]) });
    return json(200, { values: [] });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("company sheets internal campaign pilot (local sa360_test)", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const suffix = `${Date.now()}`;
  const client = {
    pilot: `cspilot_${suffix}`,
    other: `cspilot_other_${suffix}`,
  };
  const spreadsheetId = `sheetPilot${suffix}`;
  const sheet = new MemorySheet();
  const ruleIds: string[] = [];
  let connectionId = "";

  function envFor(dispatch: boolean, execution = false): NodeJS.ProcessEnv {
    return {
      ...process.env,
      SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
      SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED: dispatch ? "true" : "false",
      SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED: execution ? "true" : "false",
    };
  }

  function pilotDeps(
    dispatch: boolean,
    execution = false,
    confirmRoute?: () => Promise<CompanySheetsPilotConfirmation>
  ) {
    return {
      db,
      env: envFor(dispatch, execution),
      now: () => new Date("2099-01-01T00:00:00.000Z"),
      allowTestClient: true as const,
      clientAccountId: client.pilot,
      ...(confirmRoute ? { confirmRoute } : {}),
    };
  }

  function deliveryDeps(execution: boolean): CompanySheetsDeliveryDeps {
    return {
      env: envFor(true, execution),
      db,
      now: () => new Date("2099-01-01T00:00:00.000Z"),
      fetchImpl: async (input, init) => sheet.fetch(String(input), init),
      getAccessToken: async () => ({
        ok: true,
        accessToken: "ya29.pilot-test",
        connectionId,
        tokenVersion: 1,
        googleEmail: EMAIL,
      }),
      getMetadata: async () => ({
        ok: true as const,
        metadata: {
          spreadsheetId,
          title: "Pilot",
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
          worksheets: [{ sheetId: 7, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" }],
        },
      }),
      getDriveFile: async (input: { fileId: string }) => ({
        ok: true as const,
        file: {
          id: input.fileId,
          name: "Pilot",
          mimeType: "application/vnd.google-apps.spreadsheet",
          ownedByMe: true,
          ownerEmails: [EMAIL],
          driveId: null,
          parents: [],
          capabilities: { canEdit: true, canAddChildren: null },
          trashed: false,
          shortcutTargetId: null,
        },
      }),
    };
  }

  async function arm(enabled: boolean) {
    await db.companySheetsDestination.update({
      where: { clientAccountId: client.pilot },
      data: {
        campaignDispatchEnabled: enabled,
        campaignDispatchNotBefore: enabled ? new Date("2026-10-21T00:00:00.000Z") : null,
      },
    });
  }

  before(async () => {
    const url = assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url } } });
    await cleanup();
    await db.clientAccount.createMany({
      data: Object.values(client).map((clientAccountId) => ({
        clientAccountId,
        clientDisplayName: clientAccountId,
        status: "active",
      })),
    });
    const connection = await db.companyGoogleConnection.create({
      data: {
        connectionKey: "life_agent_launch",
        googleUserId: `company-pilot-${suffix}`,
        googleEmail: EMAIL,
        status: "connected",
        scopes: [
          "openid",
          "email",
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive.metadata.readonly",
          "https://www.googleapis.com/auth/drive.file",
        ],
        tokenVersion: 1,
      },
    });
    connectionId = connection.id;
    const destination = await db.companySheetsDestination.create({
      data: {
        clientAccountId: client.pilot,
        companyConnectionId: connectionId,
        spreadsheetId,
        spreadsheetTitle: "Pilot",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        worksheetId: 0,
        worksheetTitle: "Sheet1",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
      },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 7,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        boundAt: new Date("2026-10-21T00:00:00.000Z"),
      },
    });
    await db.companySheetsDestination.create({
      data: {
        clientAccountId: client.other,
        companyConnectionId: connectionId,
        spreadsheetId: `sheetOther${suffix}`,
        spreadsheetTitle: "Other",
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/sheetOther${suffix}`,
        worksheetId: 0,
        worksheetTitle: "Sheet1",
        controlBasis: "drive_owner_verified",
        accessStatus: "readable",
        sharingStatus: "missing_recipient",
        enabled: false,
        campaignDispatchEnabled: false,
        agedDispatchEnabled: false,
      },
    });
  });

  after(async () => {
    if (db) {
      await cleanup();
      await db.$disconnect();
    }
  });

  async function cleanup() {
    const ids = Object.values(client);
    if (ruleIds.length > 0) {
      await db.campaignRoutingRule.deleteMany({ where: { id: { in: ruleIds } } });
    }
    await db.companySheetsDeliveryJob.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsDispatchIntent.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.companySheetsWorksheetLock.deleteMany({
      where: { spreadsheetId: { in: [spreadsheetId, `sheetOther${suffix}`] } },
    });
    await db.companySheetsDestination.deleteMany({ where: { clientAccountId: { in: ids } } });
    await db.sourceLeadEvent.deleteMany({
      where: { sourceRouteKey: COMPANY_SHEETS_PILOT_ROUTE_KEY, clientAccountIdResolved: { in: ids } },
    });
    await db.routingDryRunDecision.deleteMany({
      where: { masterClientAccountId: { in: ids }, sourceLeadUid: { startsWith: "sheets-pilot:" } },
    });
    await db.companyGoogleConnection.deleteMany({ where: { connectionKey: "life_agent_launch" } });
    await db.clientAccount.deleteMany({ where: { clientAccountId: { in: ids } } });
  }

  async function leadCount(sourceLeadId: string) {
    return db.sourceLeadEvent.count({
      where: { sourceRouteKey: COMPANY_SHEETS_PILOT_ROUTE_KEY, sourceLeadId },
    });
  }

  it("writes nothing when dispatch, the client switch, or the campaign tab is not armed", async () => {
    const blocked = await submitCompanySheetsCampaignPilot(
      { idempotencyKey: "pilot-offflag" },
      pilotDeps(false)
    );
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "pilot_not_armed");
    assert.equal(await leadCount("pilot-offflag"), 0);

    const switched = await submitCompanySheetsCampaignPilot(
      { idempotencyKey: "pilot-switch0" },
      pilotDeps(true)
    );
    assert.equal(switched.ok, false);
    if (!switched.ok) assert.equal(switched.code, "pilot_not_armed");
    assert.equal(await leadCount("pilot-switch0"), 0);

    await arm(true);
    await db.companySheetsTabContract.deleteMany({
      where: { destination: { clientAccountId: client.pilot }, role: "campaign" },
    });
    const missing = await submitCompanySheetsCampaignPilot(
      { idempotencyKey: "pilot-notab01" },
      pilotDeps(true)
    );
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.code, "pilot_not_armed");
    assert.equal(await leadCount("pilot-notab01"), 0);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId: client.pilot } }), 0);
    const destination = await db.companySheetsDestination.findUniqueOrThrow({
      where: { clientAccountId: client.pilot },
    });
    await db.companySheetsTabContract.create({
      data: {
        destinationId: destination.id,
        role: "campaign",
        setupState: "bound",
        worksheetId: 7,
        worksheetTitle: "Campaign Leads",
        schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
        headerContract: [...COMPANY_SHEETS_LEAD_HEADER],
        boundAt: new Date("2026-10-21T00:00:00.000Z"),
      },
    });
  });

  it("rejects a body that chooses a client or a contact before any write", async () => {
    await arm(true);
    const previous = process.env.ADMIN_API_KEY;
    process.env.ADMIN_API_KEY = "pilot-test-admin-key";
    const app = Fastify({ logger: false });
    try {
      await app.register(adminCompanySheetsDeliveryRoutes, { prefix: "/admin/v1", deps: pilotDeps(true) });
      const denied = await app.inject({
        method: "POST",
        url: "/admin/v1/company-sheets/internal-test/campaign-pilot",
        headers: { [HEADER]: "pilot-test-admin-key", "content-type": "application/json" },
        payload: { idempotencyKey: "pilot-extra01", clientAccountId: client.other, email: "real@example.com" },
      });
      assert.equal(denied.statusCode, 400);
      assert.equal(denied.json().error, "invalid_pilot");
      assert.equal(await leadCount("pilot-extra01"), 0);
      assert.equal(sheet.calls, 0);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.ADMIN_API_KEY;
      else process.env.ADMIN_API_KEY = previous;
    }
  });

  it("refuses before writing when canonical routing would select another client", async () => {
    await arm(true);
    const refused = await submitCompanySheetsCampaignPilot({ idempotencyKey: "pilot-foreign" }, {
      ...pilotDeps(true),
      confirmRoute: async () => ({ ok: false, code: "pilot_routed_elsewhere" }),
    });
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.code, "pilot_routed_elsewhere");
    assert.equal(await leadCount("pilot-foreign"), 0);
    assert.equal(await db.routingDryRunDecision.count({ where: { masterClientAccountId: client.pilot } }), 0);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId: client.pilot } }), 0);
  });

  it("records one operator-confirmed intent and lets one drain write one synthetic row", async () => {
    await arm(true);
    const rule = await db.campaignRoutingRule.create({
      data: {
        masterClientAccountId: "some-master",
        clientAccountId: client.other,
        clientDisplayName: "Other",
        matchType: "keyword_fallback",
        keywordPattern: "synthetic",
        active: true,
      },
    });
    ruleIds.push(rule.id);
    const canary = await db.companySheetsDeliveryJob.create({
      data: {
        kind: "canary",
        status: "succeeded",
        clientAccountId: client.pilot,
        companyConnectionId: connectionId,
        spreadsheetId,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
        worksheetId: 534018357,
        worksheetTitle: "Canary",
        controlBasis: "drive_owner_verified",
        destinationUpdatedAt: new Date("2026-10-21T00:00:00.000Z"),
        headerContract: ["delivery_row_id", "sample_formula", "sample_plus", "note"],
        schemaVersion: "company_sheets_canary_v1",
        idempotencyKey: `canary:${client.pilot}:kept`,
        rowsTotal: 3,
        rowsWritten: 3,
        attemptCount: 1,
      },
    });

    const first = await submitCompanySheetsCampaignPilot({ idempotencyKey: "pilot-armed01" }, pilotDeps(true));
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.created, true);
    assert.equal(first.executed, false);
    assert.equal(first.googleCalled, false);
    assert.equal(first.clientAccountId, client.pilot);
    assert.equal(first.routingAuthority, "operator_selected_destination");
    assert.equal(first.matchType, "internal_sheets_pilot");
    assert.equal(first.intentStatus, "pending");
    assert.equal(sheet.calls, 0);

    const lead = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: first.sourceLeadEventId } });
    assert.equal(lead.status, "routing_matched");
    assert.equal(lead.clientAccountIdResolved, client.pilot);
    assert.equal(lead.sourceProvider, "manual_import");
    assert.equal(lead.sourceCampaignId, null);
    const normalized = lead.normalizedPayloadJson as { event?: { send_to_meta?: boolean }; contact?: { email?: string } };
    assert.equal(normalized.event?.send_to_meta, false);
    assert.equal(normalized.contact?.email, COMPANY_SHEETS_PILOT_EMAIL);
    const decision = await db.routingDryRunDecision.findUniqueOrThrow({ where: { id: first.routingDryRunDecisionId ?? "" } });
    const snapshot = decision.attributionSnapshot as { matchType?: string; routingAuthority?: string };
    assert.equal(snapshot.matchType, "internal_sheets_pilot");
    assert.equal(snapshot.routingAuthority, "operator_selected_destination");
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: lead.id } }), 0);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);
    assert.equal(await db.companySheetsDispatchIntent.count({ where: { clientAccountId: client.other } }), 0);

    const replay = await submitCompanySheetsCampaignPilot({ idempotencyKey: "pilot-armed01" }, pilotDeps(true));
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.created, false);
    assert.equal(replay.sourceLeadEventId, first.sourceLeadEventId);
    assert.equal(replay.intentId, first.intentId);
    assert.equal(await leadCount("pilot-armed01"), 1);
    assert.equal(
      await db.routingDryRunDecision.count({ where: { masterClientAccountId: client.pilot, sourceLeadUid: { startsWith: "sheets-pilot:" } } }),
      1
    );

    const drained = await processDueCompanySheetsDispatches(deliveryDeps(true));
    assert.equal(drained.ok, true);
    assert.equal(drained.processed, 1);
    assert.equal(drained.executed, 1);
    const intent = await db.companySheetsDispatchIntent.findUniqueOrThrow({ where: { id: first.intentId ?? "" } });
    assert.equal(intent.status, "completed");
    const job = await db.companySheetsDeliveryJob.findFirstOrThrow({ where: { sourceLeadEventId: lead.id } });
    assert.equal(job.kind, "lead");
    assert.equal(job.status, "succeeded");
    assert.equal(job.worksheetId, 7);
    assert.equal(job.rowsWritten, 1);
    assert.equal(job.rowsTotal, 1);
    assert.deepEqual(sheet.rows[0], [...COMPANY_SHEETS_LEAD_HEADER]);
    assert.equal(sheet.appends.length, 1);
    const appended = sheet.appends[0]?.[1] ?? [];
    assert.equal(appended[0], `lead:${client.pilot}:${lead.id}`);
    assert.equal(appended[4], "Synthetic Sheets");
    assert.equal(appended[5], COMPANY_SHEETS_PILOT_EMAIL);
    assert.equal(appended[6], COMPANY_SHEETS_PILOT_PHONE);
    assert.equal(sheet.rows.filter((row) => row[0] === appended[0]).length, 1);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { clientAccountId: client.other } }), 0);
    const kept = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: canary.id } });
    assert.equal(kept.status, "succeeded");
    assert.equal(kept.attemptCount, 1);
    assert.equal(kept.rowsWritten, 3);
    const other = await db.companySheetsDestination.findUniqueOrThrow({ where: { clientAccountId: client.other } });
    assert.equal(other.campaignDispatchEnabled, false);
    assert.equal(other.agedDispatchEnabled, false);

    const replayAfterDrain = await submitCompanySheetsCampaignPilot(
      { idempotencyKey: "pilot-armed01" },
      pilotDeps(true)
    );
    assert.equal(replayAfterDrain.ok, true);
    if (!replayAfterDrain.ok) return;
    assert.equal(replayAfterDrain.created, false);
    assert.equal(replayAfterDrain.sourceLeadEventId, first.sourceLeadEventId);
    assert.equal(replayAfterDrain.intentId, first.intentId);
    const drainedAgain = await processDueCompanySheetsDispatches(deliveryDeps(true));
    assert.equal(drainedAgain.processed, 0);
    assert.equal(drainedAgain.executed, 0);
    assert.equal(sheet.appends.length, 1);
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 1);
    assert.equal(await db.companySheetsDeliveryRow.count({ where: { jobId: job.id } }), 1);
    const keptAfter = await db.companySheetsDeliveryJob.findUniqueOrThrow({ where: { id: canary.id } });
    assert.equal(keptAfter.status, "succeeded");
    assert.equal(keptAfter.attemptCount, 1);
    assert.equal(keptAfter.rowsWritten, 3);

    const enrichment = lead.enrichmentMetadataJson as { recordClass?: string; intake?: string };
    assert.equal(enrichment.recordClass, "company_sheets_internal_pilot");
    assert.equal(enrichment.intake, "company_sheets_internal_pilot");
    assert.equal(decision.routingEventNameInternal, "operator_selected_destination");
    assert.equal(decision.confidence, "operator_selected");
    assert.equal(decision.matchReason.includes("Matched routing rule"), false);
    const visibleToScan = await db.sourceLeadEvent.findMany({
      where: {
        AND: [
          { id: lead.id },
          { status: { in: ["normalized", "routing_matched", "approved"] } },
          companySheetsInternalPilotLeadExclusion(),
        ],
      },
      select: { id: true },
    });
    assert.equal(visibleToScan.length, 0);
    assert.equal(await db.fulfillmentOutbox.count({ where: { sourceLeadEventId: lead.id } }), 0);
    const inventory = await trackCampaignInventoryFromSourceEvent(
      { sourceLeadEventId: lead.id, sourceLane: "leadcapture_io" },
      db
    );
    assert.equal(inventory.ok, true);
    if (inventory.ok) assert.equal(inventory.outcome, "skipped_not_resale_supply");
    assert.equal(await db.leadInventoryItem.count({ where: { sourceLeadEventId: lead.id } }), 0);
    const approved = await approveSourceLeadDelivery({
      sourceLeadEventId: lead.id,
      mode: "simulate",
      operatorConfirmationText: SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION,
    });
    assert.equal(approved.ok, false);
    if (!approved.ok) assert.equal(approved.error, "company_sheets_internal_pilot");
    const plan = await generateLeadDeliveryPlanForDecision(decision.id);
    assert.equal("blocked" in plan, true);
    assert.equal(await db.leadDeliveryPlan.count({ where: { routingDryRunDecisionId: decision.id } }), 0);
    const pool = await listLiveLeadPool({ limit: 50 }, db);
    assert.equal(pool.items.some((item) => item.sourceEventId === lead.id), false);
  });

  it("stores a canonical rule decision when the matcher confirms the test client", async () => {
    await arm(true);
    const confirmed = await submitCompanySheetsCampaignPilot({ idempotencyKey: "pilot-canon01" }, {
      ...pilotDeps(true),
      confirmRoute: async () => ({
        ok: true,
        routingAuthority: "campaign_routing_rule",
        matchType: "campaign_id",
        matchedRuleId: "rule-self",
        destinationSubaccountIdGhl: "",
        reason: "Matched routing rule (campaign_id) → internal test",
      }),
    });
    assert.equal(confirmed.ok, true);
    if (!confirmed.ok) return;
    assert.equal(confirmed.routingAuthority, "campaign_routing_rule");
    assert.equal(confirmed.matchType, "campaign_id");
    const lead = await db.sourceLeadEvent.findUniqueOrThrow({ where: { id: confirmed.sourceLeadEventId } });
    assert.equal(lead.routingRuleIdResolved, "rule-self");
    assert.equal(await db.companySheetsDeliveryJob.count({ where: { sourceLeadEventId: lead.id } }), 0);
  });
});
