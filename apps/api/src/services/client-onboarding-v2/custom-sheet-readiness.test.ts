import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";

import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
  COMPANY_SHEETS_LEAD_HEADER_V2,
  COMPANY_SHEETS_WRITE_READINESS_VERIFIED,
} from "../../lib/company-google-sheets-env.js";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA } from "../company-sheets-delivery/company-sheets-custom-row.js";
import { recordActivationIntent } from "./onboarding-config.service.js";
import { assessBoundCampaignHeader, readClientOnboardingSummary, sheetsFirstActivationReady } from "./readiness.js";

const CLIENT = "readiness_client";
const SHEET = "sheet_readiness";
const CUTOFF = new Date("2026-10-27T14:43:39.233Z");
const CUSTOM_HEADER = ["Date", "Lead Type", "Client Name"];
const WRITER_FLAG = "SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED";

type ReadyInput = {
  schemaVersion: string;
  header: string[] | null;
  writeReadiness: string;
  worksheetId?: number;
  map?: { spreadsheetId: string; worksheetId: number; headerSnapshot: string[] } | null;
  campaignTest?: boolean;
  controlBasis?: string;
};

function activationDb(input: ReadyInput) {
  const worksheetId = input.worksheetId ?? 0;
  const destination = {
    id: "dest_readiness",
    clientAccountId: CLIENT,
    spreadsheetId: SHEET,
    spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet_readiness/edit",
    worksheetId,
    worksheetTitle: "VET Web Form",
    campaignDispatchEnabled: false,
    agedDispatchEnabled: false,
    campaignDispatchNotBefore: CUTOFF,
    writeReadiness: input.writeReadiness,
    deliveryExecution: "disabled",
    accessStatus: "readable",
    controlBasis: input.controlBasis ?? "approved_shared_drive",
    tabContracts: [
      {
        id: "tab_campaign",
        role: "campaign",
        setupState: "bound",
        worksheetId,
        worksheetTitle: "VET Web Form",
        schemaVersion: input.schemaVersion,
        headerContract: input.header,
      },
    ],
  };
  const client = {
    clientAccountId: CLIENT,
    clientDisplayName: "Readiness Client",
    status: "active",
    primaryNicheKeys: ["veteran"],
    primaryProductTypes: ["final_expense"],
    onboardingSetup: null,
    onboardingDestinationProfile: {
      revision: 2,
      sheetsSelected: true,
      ghlMode: "unset",
      notesEnabled: false,
      notesContractVersion: null,
    },
    ghlDestination: null,
    companySheetsDestination: destination,
  };
  const campaignJob = input.campaignTest
    ? {
        id: "job_campaign_test",
        kind: "campaign_test",
        status: "succeeded",
        sourceLeadEventId: "synthetic-campaign-test",
        clientAccountId: CLIENT,
        worksheetId,
        createdAt: new Date("2026-10-27T21:00:00.000Z"),
      }
    : null;
  const db = {
    clientAccount: {
      findUnique: async () => client,
      findUniqueOrThrow: async () => client,
    },
    sourceFunnel: { findMany: async () => [] },
    sourceLeadEvent: { findMany: async () => [] },
    companySheetsDeliveryJob: {
      findMany: async () => (campaignJob ? [campaignJob] : []),
      findFirst: async (args: { where?: { kind?: { in?: string[] } } }) => {
        const kinds = args.where?.kind?.in ?? [];
        return campaignJob && kinds.includes("campaign_test") ? { id: campaignJob.id } : null;
      },
      count: async () => 0,
    },
    companySheetsDispatchIntent: { findMany: async () => [] },
    companySheetsDestination: { findUnique: async () => destination },
    clientSheetColumnMap: {
      findFirst: async (args: { where?: { spreadsheetId?: string; worksheetId?: number; status?: string } }) => {
        const map = input.map;
        if (!map) return null;
        const where = args.where ?? {};
        if (where.spreadsheetId && where.spreadsheetId !== map.spreadsheetId) return null;
        if (where.worksheetId != null && where.worksheetId !== map.worksheetId) return null;
        if (where.status && where.status !== "published") return null;
        return {
          id: "map_readiness",
          status: "published",
          sourceScope: "shared",
          spreadsheetId: map.spreadsheetId,
          worksheetId: map.worksheetId,
          headerSnapshot: map.headerSnapshot,
        };
      },
    },
    deliveryTarget: { findMany: async () => [] },
    clientOnboardingTestAttempt: { findFirst: async () => null },
    clientOnboardingActivationIntent: {
      create: async (args: { data: { status: string; expectedReceiptIds: string[]; activatesDelivery: boolean } }) => ({
        id: "intent_readiness",
        ...args.data,
      }),
    },
  };
  return { db: db as unknown as PrismaClient, destination };
}

async function withWriter(enabled: boolean, run: () => Promise<void>) {
  const previous = process.env[WRITER_FLAG];
  if (enabled) process.env[WRITER_FLAG] = "true";
  else delete process.env[WRITER_FLAG];
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env[WRITER_FLAG];
    else process.env[WRITER_FLAG] = previous;
  }
}

test("preset headers are ready only when the bound header is exact", () => {
  const v3 = assessBoundCampaignHeader({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
    setupState: "bound",
    header: [...COMPANY_SHEETS_V3_HEADER],
    spreadsheetId: SHEET,
    worksheetId: 11,
    publishedMap: null,
  });
  assert.equal(v3.preset, true);
  assert.equal(v3.headerReady, true);
  assert.equal(v3.customMapMatches, false);

  const v2 = assessBoundCampaignHeader({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
    setupState: "bound",
    header: [...COMPANY_SHEETS_LEAD_HEADER_V2],
    spreadsheetId: SHEET,
    worksheetId: 11,
    publishedMap: null,
  });
  assert.equal(v2.preset, true);
  assert.equal(v2.headerReady, true);

  const drifted = assessBoundCampaignHeader({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
    setupState: "bound",
    header: [...COMPANY_SHEETS_V3_HEADER, "Extra"],
    spreadsheetId: SHEET,
    worksheetId: 11,
    publishedMap: null,
  });
  assert.equal(drifted.headerReady, false);
});

test("a custom tab is ready only when the published map is bound to that tab and header", () => {
  const matching = assessBoundCampaignHeader({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
    setupState: "bound",
    header: CUSTOM_HEADER,
    spreadsheetId: SHEET,
    worksheetId: 0,
    publishedMap: { spreadsheetId: SHEET, worksheetId: 0, headerSnapshot: CUSTOM_HEADER },
  });
  assert.equal(matching.preset, false);
  assert.equal(matching.headerReady, true);
  assert.equal(matching.customMapMatches, true);

  const otherTab = assessBoundCampaignHeader({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
    setupState: "bound",
    header: CUSTOM_HEADER,
    spreadsheetId: SHEET,
    worksheetId: 0,
    publishedMap: { spreadsheetId: SHEET, worksheetId: 9, headerSnapshot: CUSTOM_HEADER },
  });
  assert.equal(otherTab.headerReady, false);
  assert.equal(otherTab.customMapMatches, false);

  const drifted = assessBoundCampaignHeader({
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
    setupState: "bound",
    header: CUSTOM_HEADER,
    spreadsheetId: SHEET,
    worksheetId: 0,
    publishedMap: { spreadsheetId: SHEET, worksheetId: 0, headerSnapshot: ["Date", "Lead Type", "Other"] },
  });
  assert.equal(drifted.headerReady, false);
  assert.equal(drifted.customMapMatches, false);
});

test("first activation ignores a production receipt and treats a drifted header as stale permission", () => {
  const ready = {
    preset: true,
    headerReady: true,
    customWriterEnabled: false,
    writeReadiness: COMPANY_SHEETS_WRITE_READINESS_VERIFIED,
    controlledTestSucceeded: true,
    uncertainJobs: 0,
    controlSelectable: true,
  };
  assert.equal(sheetsFirstActivationReady(ready), true);
  assert.equal(sheetsFirstActivationReady({ ...ready, headerReady: false }), false);
  assert.equal(sheetsFirstActivationReady({ ...ready, writeReadiness: "not_verified" }), false);
  assert.equal(
    sheetsFirstActivationReady({
      ...ready,
      preset: false,
      customWriterEnabled: false,
    }),
    false
  );
  assert.equal(
    sheetsFirstActivationReady({
      ...ready,
      preset: false,
      customWriterEnabled: true,
    }),
    true
  );
});

test("preset first activation is ready without a production receipt", async () => {
  await withWriter(false, async () => {
    const { db, destination } = activationDb({
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V2,
      header: [...COMPANY_SHEETS_LEAD_HEADER_V2],
      writeReadiness: "verified",
      campaignTest: true,
    });
    const summary = await readClientOnboardingSummary(CLIENT, db);
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    const receipt = summary.gates.find((gate) => gate.id === "sheets_writer_receipt");
    assert.equal(receipt?.role, "evidence");
    assert.equal(receipt?.required, false);
    assert.equal(receipt?.satisfied, false);
    assert.equal(summary.blockers.includes("sheets_writer_receipt"), false);
    assert.equal(summary.sheets.writeReadiness, "verified");
    const intent = await recordActivationIntent(
      {
        clientAccountId: CLIENT,
        requestId: "req_preset_ready",
        destination: "google_sheets_campaign",
        confirmation: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        expectedReceiptIds: [],
      },
      db
    );
    assert.equal(intent.ok, true);
    if (!intent.ok) return;
    assert.equal(intent.status, "ready_for_operator");
    assert.equal(intent.activatesDelivery, false);
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), CUTOFF.toISOString());
  });
});

test("header drift blocks first activation while the stored probe value stays verified", async () => {
  await withWriter(false, async () => {
    const { db, destination } = activationDb({
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      header: [...COMPANY_SHEETS_V3_HEADER, "Extra"],
      writeReadiness: "verified",
      campaignTest: true,
    });
    const summary = await readClientOnboardingSummary(CLIENT, db);
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.equal(summary.sheets.writeReadiness, "verified");
    const probe = summary.gates.find((gate) => gate.id === "sheets_permission_probe");
    assert.equal(probe?.satisfied, false);
    assert.equal(summary.blockers.includes("sheets_permission_probe"), true);
    assert.equal(summary.blockers.includes("sheets_writer_receipt"), false);
    const intent = await recordActivationIntent(
      {
        clientAccountId: CLIENT,
        requestId: "req_preset_drift",
        destination: "google_sheets_campaign",
        confirmation: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        expectedReceiptIds: ["receipt_should_not_matter"],
      },
      db
    );
    assert.equal(intent.ok, true);
    if (!intent.ok) return;
    assert.equal(intent.status, "blocked");
    assert.equal(intent.activatesDelivery, false);
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), CUTOFF.toISOString());
  });
});

test("a valid custom map can pass first activation only when the custom writer flag is on, still without a receipt", async () => {
  const input: ReadyInput = {
    schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
    header: CUSTOM_HEADER,
    writeReadiness: "verified",
    campaignTest: true,
    map: { spreadsheetId: SHEET, worksheetId: 0, headerSnapshot: CUSTOM_HEADER },
  };
  await withWriter(false, async () => {
    const { db } = activationDb(input);
    const summary = await readClientOnboardingSummary(CLIENT, db);
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    const custom = summary.gates.find((gate) => gate.id === "sheets_custom_map_published");
    assert.equal(summary.destinationProfile.sheetsSelected, true);
    assert.equal(custom?.required, true);
    assert.equal(custom?.satisfied, true);
    assert.equal(summary.blockers.includes("sheets_custom_map_published"), false);
    assert.equal(summary.blockers.includes("sheets_writer_receipt"), false);
    const intent = await recordActivationIntent(
      {
        clientAccountId: CLIENT,
        requestId: "req_custom_flag_off",
        destination: "google_sheets_campaign",
        confirmation: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        expectedReceiptIds: [],
      },
      db
    );
    assert.equal(intent.ok, true);
    if (!intent.ok) return;
    assert.equal(intent.status, "blocked");
  });
  await withWriter(true, async () => {
    const { db, destination } = activationDb(input);
    const intent = await recordActivationIntent(
      {
        clientAccountId: CLIENT,
        requestId: "req_custom_flag_on",
        destination: "google_sheets_campaign",
        confirmation: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        expectedReceiptIds: [],
      },
      db
    );
    assert.equal(intent.ok, true);
    if (!intent.ok) return;
    assert.equal(intent.status, "ready_for_operator");
    assert.equal(intent.activatesDelivery, false);
    assert.equal(destination.campaignDispatchEnabled, false);
    assert.equal(destination.campaignDispatchNotBefore?.toISOString(), CUTOFF.toISOString());
  });
});

test("a drifted custom header stays unready even when a production receipt id is supplied", async () => {
  await withWriter(true, async () => {
    const { db } = activationDb({
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_CUSTOM_SCHEMA,
      header: CUSTOM_HEADER,
      writeReadiness: "verified",
      campaignTest: true,
      map: { spreadsheetId: SHEET, worksheetId: 0, headerSnapshot: ["Date", "Other", "Client Name"] },
    });
    const summary = await readClientOnboardingSummary(CLIENT, db);
    assert.equal(summary.ok, true);
    if (!summary.ok) return;
    assert.equal(summary.sheets.writeReadiness, "verified");
    assert.equal(summary.gates.find((gate) => gate.id === "sheets_custom_map_published")?.satisfied, false);
    assert.equal(summary.gates.find((gate) => gate.id === "sheets_permission_probe")?.satisfied, false);
    const intent = await recordActivationIntent(
      {
        clientAccountId: CLIENT,
        requestId: "req_custom_drift",
        destination: "google_sheets_campaign",
        confirmation: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        expectedReceiptIds: ["live_receipt"],
      },
      db
    );
    assert.equal(intent.ok, true);
    if (!intent.ok) return;
    assert.equal(intent.status, "blocked");
  });
});
