import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import {
  COMPANY_GOOGLE_DRIVE_FILES_URL,
  COMPANY_GOOGLE_DRIVE_METADATA_SCOPE,
  COMPANY_GOOGLE_SPREADSHEETS_SCOPE,
} from "../lib/company-google-sheets-env.js";
import {
  COMPANY_DRIVE_FOLDER_MIME,
  COMPANY_DRIVE_SHORTCUT_MIME,
  COMPANY_DRIVE_SPREADSHEET_MIME,
} from "../services/company-google/company-google-storage-policy.js";
import type { CompanyDriveFile } from "../services/company-google/company-google-drive-http.js";
import {
  adminClientOnboardingV2ReadRoutes,
  type ClientOnboardingV2ReadRouteOptions,
} from "./admin-client-onboarding-v2-read.js";

const CLIENT = "onb_fixture_client";
const OTHER = "other_client";
const ADMIN_KEY = "onboarding-read-test-key";
const SPREADSHEET = "alexGrossSheet01";
const OTHER_SHEET = "otherClientSheet1";
const APPROVED_DRIVE = "approvedDrive01";
const APPROVED_PARENT = "approvedParent1";
const FOLDER_ID = "clientFolder01";
const SHORTCUT_TARGET = "shortcutTargetNeverFetched01";

const legacyHeader = [
  "Age/ DOB",
  "Primary Reason",
  "Fixture Legacy 03",
  "Fixture Legacy 04",
  "Fixture Legacy 05",
  "Fixture Legacy 06",
  "Fixture Legacy 07",
  "Fixture Legacy 08",
  "Fixture Legacy 09",
  "Fixture Legacy 10",
  "Fixture Legacy 11",
  "Fixture Legacy 12",
  "Fixture Legacy 13",
  "Fixture Legacy 14",
  "Fixture Legacy 15",
];

type Call = { model: string; op: string; args: unknown };

function sheetsEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "true",
    COMPANY_GOOGLE_APPROVED_SHARED_DRIVE_ID: APPROVED_DRIVE,
    COMPANY_GOOGLE_APPROVED_PARENT_FOLDER_ID: APPROVED_PARENT,
    ...overrides,
  };
}

function readEnv(flag: string | undefined = "true"): NodeJS.ProcessEnv {
  return sheetsEnv({
    SA360_CLIENT_ONBOARDING_V2_READ_ENABLED: flag,
  });
}

function adminHeaders(extra: Record<string, string> = {}) {
  return { "x-sa360-admin-key": ADMIN_KEY, ...extra };
}

function driveFile(overrides: Partial<CompanyDriveFile> & Pick<CompanyDriveFile, "id" | "name" | "mimeType">): CompanyDriveFile {
  return {
    ownedByMe: false,
    ownerEmails: ["sheets@lifeagentlaunch.test"],
    driveId: APPROVED_DRIVE,
    parents: [APPROVED_PARENT],
    capabilities: { canEdit: true, canAddChildren: true },
    trashed: false,
    shortcutTargetId: null,
    ...overrides,
  };
}

function clientRow(headerContract: string[] = [...COMPANY_SHEETS_V3_HEADER]) {
  return {
    clientAccountId: CLIENT,
    clientDisplayName: "Fixture Client",
    status: "active",
    primaryNicheKeys: ["veteran"],
    primaryProductTypes: ["final_expense"],
    onboardingSetup: {
      status: "submitted",
      revision: 2,
      setupDataJson: { destinationChoice: "google_sheets", sourceProvider: "other" },
    },
    ghlDestination: null,
    companySheetsDestination: destinationRow(headerContract),
  };
}

function destinationRow(headerContract: string[]) {
  return {
    id: "dest_fixture",
    clientAccountId: CLIENT,
    spreadsheetId: SPREADSHEET,
    campaignDispatchEnabled: true,
    campaignDispatchNotBefore: new Date("2026-10-26T12:00:00.000Z"),
    agedDispatchEnabled: false,
    writeReadiness: "not_verified",
    deliveryExecution: "disabled",
    accessStatus: "readable",
    controlBasis: "approved_shared_drive",
    tabContracts: [
      {
        id: "tab_campaign",
        role: "campaign",
        setupState: "bound",
        worksheetId: 11,
        worksheetTitle: "Campaign Leads",
        schemaVersion: "company_sheets_campaign_v3",
        headerContract,
      },
    ],
  };
}

function createDb(
  options: {
    client?: object | null;
    headerContract?: string[];
    publishedMap?: { spreadsheetId: string; worksheetId: number; headerSnapshot: string[] } | null;
  } = {}
) {
  const calls: Call[] = [];
  const client = (options.client === undefined ? clientRow(options.headerContract) : options.client) as
    | (ReturnType<typeof clientRow> & { clientAccountId: string })
    | null;
  const destination = client?.companySheetsDestination ?? null;
  const note = (model: string, op: string, args: unknown) => {
    calls.push({ model, op, args });
  };
  const refuse = (model: string, op: string) => async (args: unknown) => {
    note(model, op, args);
    throw new Error(`unexpected write ${model}.${op}`);
  };
  const db = {
    clientAccount: {
      findUnique: async (args: { where: { clientAccountId: string } }) => {
        note("clientAccount", "findUnique", args);
        if (!client || args.where.clientAccountId !== CLIENT) return null;
        return client;
      },
      update: refuse("clientAccount", "update"),
      create: refuse("clientAccount", "create"),
    },
    sourceFunnel: {
      findMany: async (args: unknown) => {
        note("sourceFunnel", "findMany", args);
        return [
          {
            id: "funnel_fixture",
            provider: "leadcapture_io",
            providerFunnelId: "form-1",
            parentUrlKey: "go.example.test/fixture",
            pageSlug: "fixture",
            associationStatus: "confirmed",
            originClientAccountId: CLIENT,
            suggestedClientAccountId: null,
            firstSeenAt: null,
            updatedAt: new Date("2026-10-26T14:00:00.000Z"),
          },
        ];
      },
      create: refuse("sourceFunnel", "create"),
    },
    sourceLeadEvent: {
      findMany: async (args: unknown) => {
        note("sourceLeadEvent", "findMany", args);
        return [];
      },
      create: refuse("sourceLeadEvent", "create"),
    },
    companySheetsDeliveryJob: {
      findMany: async (args: unknown) => {
        note("companySheetsDeliveryJob", "findMany", args);
        return [];
      },
      count: async (args: unknown) => {
        note("companySheetsDeliveryJob", "count", args);
        return 0;
      },
      create: refuse("companySheetsDeliveryJob", "create"),
      update: refuse("companySheetsDeliveryJob", "update"),
    },
    companySheetsDispatchIntent: {
      findMany: async (args: unknown) => {
        note("companySheetsDispatchIntent", "findMany", args);
        return [];
      },
      create: refuse("companySheetsDispatchIntent", "create"),
    },
    clientSheetColumnMap: {
      findFirst: async (args: { where?: { spreadsheetId?: string; worksheetId?: number; status?: string } }) => {
        note("clientSheetColumnMap", "findFirst", args);
        const map = options.publishedMap;
        if (!map) return null;
        const where = args.where ?? {};
        if (where.spreadsheetId && where.spreadsheetId !== map.spreadsheetId) return null;
        if (where.worksheetId != null && where.worksheetId !== map.worksheetId) return null;
        if (where.status && where.status !== "published") return null;
        return {
          id: "map_fixture",
          spreadsheetId: map.spreadsheetId,
          worksheetId: map.worksheetId,
          headerSnapshot: map.headerSnapshot,
          status: "published",
          sourceScope: "shared",
        };
      },
      create: refuse("clientSheetColumnMap", "create"),
      update: refuse("clientSheetColumnMap", "update"),
    },
    companySheetsDestination: {
      findUnique: async (args: { where: { clientAccountId?: string; spreadsheetId?: string } }) => {
        note("companySheetsDestination", "findUnique", args);
        if (args.where.spreadsheetId === OTHER_SHEET) {
          return { clientAccountId: OTHER, tabContracts: [] };
        }
        if (args.where.spreadsheetId === SPREADSHEET) return destination;
        if (args.where.clientAccountId === CLIENT) return destination;
        return null;
      },
      update: refuse("companySheetsDestination", "update"),
      create: refuse("companySheetsDestination", "create"),
    },
    companySheetsTabContract: {
      update: refuse("companySheetsTabContract", "update"),
      create: refuse("companySheetsTabContract", "create"),
    },
    companySheetsClientFolder: {
      findUnique: async (args: unknown) => {
        note("companySheetsClientFolder", "findUnique", args);
        return null;
      },
      create: refuse("companySheetsClientFolder", "create"),
      update: refuse("companySheetsClientFolder", "update"),
    },
    deliveryTarget: {
      findMany: async (args: unknown) => {
        note("deliveryTarget", "findMany", args);
        return [];
      },
      update: refuse("deliveryTarget", "update"),
    },
    ghlLiveDeliveryRun: {
      findMany: async (args: unknown) => {
        note("ghlLiveDeliveryRun", "findMany", args);
        return [];
      },
      create: refuse("ghlLiveDeliveryRun", "create"),
    },
    companyGoogleConnection: {
      findUnique: async (args: unknown) => {
        note("companyGoogleConnection", "findUnique", args);
        return {
          id: "company_connection",
          connectionKey: "life_agent_launch",
          status: "connected",
          googleEmail: "sheets@lifeagentlaunch.test",
          scopes: [COMPANY_GOOGLE_SPREADSHEETS_SCOPE, COMPANY_GOOGLE_DRIVE_METADATA_SCOPE],
        };
      },
      update: refuse("companyGoogleConnection", "update"),
    },
  };
  return { db: db as never, calls };
}

function throwingDb() {
  const calls: Call[] = [];
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return new Proxy(
        {},
        {
          get(_inner, op) {
            return async () => {
              calls.push({ model: String(prop), op: String(op), args: null });
              throw new Error(`database was called: ${String(prop)}.${String(op)}`);
            };
          },
        }
      );
    },
  };
  return { db: new Proxy({}, handler) as never, calls };
}

async function buildApp(
  options: ClientOnboardingV2ReadRouteOptions,
  env: NodeJS.ProcessEnv = readEnv()
): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(adminClientOnboardingV2ReadRoutes, {
    prefix: "/admin/v1",
    env,
    ...options,
    sheetsDeps: { env, ...(options.sheetsDeps ?? {}) },
  });
  return app;
}

function alexWorkbook() {
  return {
    spreadsheetId: SPREADSHEET,
    title: "Alex Gross Leads",
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET}`,
    worksheets: [
      { sheetId: 11, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" },
      { sheetId: 12, title: "VET Web Form", index: 1, hidden: false, sheetType: "GRID" },
      { sheetId: 13, title: "Daily Stats", index: 2, hidden: false, sheetType: "GRID" },
      { sheetId: 14, title: "Weekly Stats", index: 3, hidden: false, sheetType: "GRID" },
      { sheetId: 15, title: "Prefix Extra", index: 4, hidden: false, sheetType: "GRID" },
      { sheetId: 16, title: "Blank Grid", index: 5, hidden: false, sheetType: "GRID" },
    ],
  };
}

function valuesFor(range: string): { ok: true; values: string[][] } {
  const title = range.match(/^'((?:[^']|'')*)'!/)?.[1]?.replaceAll("''", "'") ?? "";
  const headerProbe = range.endsWith("!A1:ZZ2");
  if (title === "Campaign Leads") {
    return { ok: true, values: headerProbe ? [[...COMPANY_SHEETS_V3_HEADER]] : [[COMPANY_SHEETS_V3_HEADER[0]!]] };
  }
  if (title === "VET Web Form") {
    const columnA = [[legacyHeader[0]!], ["row-1"], ["row-2"], ["row-3"], ["row-4"], ["row-5"]];
    return { ok: true, values: headerProbe ? [legacyHeader] : columnA };
  }
  if (title === "Daily Stats" || title === "Weekly Stats") {
    return { ok: true, values: headerProbe ? [[...COMPANY_SHEETS_V3_HEADER]] : [[COMPANY_SHEETS_V3_HEADER[0]!], ["stat"]] };
  }
  if (title === "Prefix Extra") {
    const header = [...COMPANY_SHEETS_V3_HEADER, "Extra"];
    return { ok: true, values: headerProbe ? [header] : [[header[0]!]] };
  }
  if (title === "Blank Grid") return { ok: true, values: [] };
  if (title === "Campaign Leads Copy") {
    return { ok: true, values: headerProbe ? [[...COMPANY_SHEETS_V3_HEADER]] : [[COMPANY_SHEETS_V3_HEADER[0]!]] };
  }
  throw new Error(`unexpected range ${range}`);
}

test("onboarding reads require the admin key and reject portal, workspace, and assertion credentials", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const { db, calls } = throwingDb();
  const app = await buildApp({ db });
  try {
    const missing = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding`,
      headers: { cookie: "sa360_admin_session=observer" },
    });
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.json().error, "Unauthorized");

    for (const header of [
      { "x-sa360-client-portal-key": "portal-key" },
      { "x-sa360-client-portal-assertion": "assertion" },
      { "x-sa360-workspace-key": "workspace-key" },
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/admin/v1/clients/${CLIENT}/onboarding`,
        headers: { ...adminHeaders(), ...header },
      });
      assert.equal(response.statusCode, 403, JSON.stringify(header));
      assert.equal(response.json().error, "forbidden");
    }
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("the read flag is exact, onboarding plugins mount once, and observers are not allowlisted", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const appSource = readFileSync(new URL("../app.ts", import.meta.url), "utf8");
  const allowlist = readFileSync(
    new URL("../../../admin-coc/src/lib/admin-coc-observer-access.ts", import.meta.url),
    "utf8"
  );
  assert.equal((appSource.match(/app\.register\(adminClientOnboardingV2ReadRoutes/g) ?? []).length, 1);
  assert.equal((appSource.match(/app\.register\(adminClientOnboardingV2GhlRoutes/g) ?? []).length, 1);
  assert.equal((appSource.match(/app\.register\(adminClientOnboardingV2TestRoutes/g) ?? []).length, 1);
  assert.equal((appSource.match(/app\.register\(adminClientOnboardingV2ConfigRoutes/g) ?? []).length, 1);
  assert.equal(allowlist.includes("onboarding"), false);

  const { db, calls } = throwingDb();
  const app = await buildApp({ db }, readEnv("TRUE"));
  try {
    const response = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding`,
      headers: adminHeaders(),
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "onboarding_read_disabled");
    const proof = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding/source-proof`,
      headers: adminHeaders(),
    });
    assert.equal(proof.statusCode, 404);
    assert.equal(proof.json().error, "onboarding_read_disabled");
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("summary reports stored dispatch state and distinct source proofs without writing", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const { db, calls } = createDb();
  const app = await buildApp({ db });
  try {
    const mismatch = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding?clientAccountId=${OTHER}`,
      headers: adminHeaders(),
    });
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.json().error, "client_account_mismatch");

    const missing = await app.inject({
      method: "GET",
      url: "/admin/v1/clients/missing_client/onboarding",
      headers: adminHeaders(),
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "client_not_found");

    const malformed = await app.inject({
      method: "GET",
      url: "/admin/v1/clients/bad%20id/onboarding",
      headers: adminHeaders(),
    });
    assert.equal(malformed.statusCode, 404);
    assert.equal(malformed.json().error, "client_not_found");

    const response = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding`,
      headers: adminHeaders(),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.contractVersion, "client_onboarding_v2");
    assert.equal(body.setupRequest.operational, false);
    assert.equal(body.setupRequest.destinationChoice, "google_sheets");
    assert.equal(body.liveActivationPerformedByOnboarding, false);
    assert.equal(body.externalZapier.preserved, true);
    assert.equal(body.externalZapier.replacedByNative, false);
    assert.equal(body.sheets.campaignDispatchEnabled, true);
    assert.equal(body.sheets.campaignDispatchNotBefore, "2026-10-26T12:00:00.000Z");
    assert.equal(body.sheets.writeReadiness, "not_verified");
    assert.equal(body.ghl.notesEnabled, false);
    assert.equal(body.ghl.notesContractVersion, null);
    assert.equal(body.sources.length, 1);
    assert.equal(body.sources[0].proofs.linked.satisfied, true);
    assert.equal(body.sources[0].proofs.observed.satisfied, false);
    assert.equal(body.sources[0].proofs.routingMatched.satisfied, false);
    assert.equal(body.sources[0].proofs.delivery.satisfied, false);
    const probe = body.gates.find((gate: { id: string }) => gate.id === "sheets_permission_probe");
    const headerGate = body.gates.find((gate: { id: string }) => gate.id === "sheets_header_dispatch_ready");
    const customMap = body.gates.find((gate: { id: string }) => gate.id === "sheets_custom_map_published");
    const receipt = body.gates.find((gate: { id: string; role?: string }) => gate.id === "sheets_writer_receipt");
    assert.equal(probe.required, true);
    assert.equal(probe.satisfied, false);
    assert.equal(probe.role, "prerequisite");
    assert.equal(headerGate.required, true);
    assert.equal(headerGate.satisfied, true);
    assert.equal(customMap.required, false);
    assert.equal(customMap.satisfied, false);
    assert.equal(receipt.required, false);
    assert.equal(receipt.satisfied, false);
    assert.equal(receipt.role, "evidence");
    assert.equal(body.blockers.includes("sheets_permission_probe"), true);
    assert.equal(body.blockers.includes("sheets_writer_receipt"), false);
    assert.equal(body.blockers.includes("leadcapture_routing_matched"), true);
    assert.equal(calls.some((call) => call.op === "update" || call.op === "create"), false);

    const proof = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding/source-proof`,
      headers: adminHeaders(),
    });
    assert.equal(proof.statusCode, 200);
    assert.equal(proof.json().sources[0].proofs.linked.satisfied, true);
    assert.equal(calls.some((call) => call.model === "sourceLeadEvent" && call.op === "create"), false);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

function profileSheetsClient(input: {
  schemaVersion: string;
  header: string[];
  writeReadiness: string;
  sheetsSelected: boolean;
}) {
  const base = clientRow(input.header);
  return {
    ...base,
    onboardingSetup: {
      status: "submitted",
      revision: 2,
      setupDataJson: { destinationChoice: "ghl", sourceProvider: "other" },
    },
    onboardingDestinationProfile: {
      revision: 3,
      sheetsSelected: input.sheetsSelected,
      ghlMode: "unset",
      notesEnabled: false,
      notesContractVersion: null,
    },
    companySheetsDestination: {
      ...base.companySheetsDestination,
      writeReadiness: input.writeReadiness,
      tabContracts: [
        {
          id: "tab_campaign",
          role: "campaign",
          setupState: "bound",
          worksheetId: 0,
          worksheetTitle: "VET Web Form",
          schemaVersion: input.schemaVersion,
          headerContract: input.header,
        },
      ],
    },
  };
}

test("selecting Sheets on the destination profile reports a valid custom map and ignores a missing receipt", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const header = ["Date", "Lead Type", "Client Name"];
  const { db } = createDb({
    client: profileSheetsClient({
      schemaVersion: "company_sheets_campaign_custom_v1",
      header,
      writeReadiness: "verified",
      sheetsSelected: true,
    }),
    publishedMap: { spreadsheetId: SPREADSHEET, worksheetId: 0, headerSnapshot: header },
  });
  const app = await buildApp({ db });
  try {
    const response = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding`,
      headers: adminHeaders(),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.destinationProfile.sheetsSelected, true);
    assert.equal(body.sheets.writeReadiness, "verified");
    const gate = (id: string) => body.gates.find((item: { id: string }) => item.id === id);
    assert.equal(gate("sheets_header_dispatch_ready").required, true);
    assert.equal(gate("sheets_header_dispatch_ready").satisfied, true);
    assert.equal(gate("sheets_custom_map_published").required, true);
    assert.equal(gate("sheets_custom_map_published").satisfied, true);
    assert.equal(gate("sheets_permission_probe").required, true);
    assert.equal(gate("sheets_permission_probe").satisfied, true);
    assert.equal(gate("sheets_writer_receipt").required, false);
    assert.equal(gate("sheets_writer_receipt").role, "evidence");
    assert.equal(gate("sheets_writer_receipt").satisfied, false);
    assert.equal(body.blockers.includes("sheets_custom_map_published"), false);
    assert.equal(body.blockers.includes("sheets_header_dispatch_ready"), false);
    assert.equal(body.blockers.includes("sheets_permission_probe"), false);
    assert.equal(body.blockers.includes("sheets_writer_receipt"), false);

    const hidden = createDb({
      client: profileSheetsClient({
        schemaVersion: "company_sheets_campaign_custom_v1",
        header,
        writeReadiness: "verified",
        sheetsSelected: false,
      }),
      publishedMap: { spreadsheetId: SPREADSHEET, worksheetId: 0, headerSnapshot: header },
    });
    const hiddenApp = await buildApp({ db: hidden.db });
    try {
      const unselected = await hiddenApp.inject({
        method: "GET",
        url: `/admin/v1/clients/${CLIENT}/onboarding`,
        headers: adminHeaders(),
      });
      assert.equal(unselected.statusCode, 200);
      const unselectedBody = unselected.json();
      assert.equal(unselectedBody.destinationProfile.sheetsSelected, false);
      const unselectedMap = unselectedBody.gates.find((item: { id: string }) => item.id === "sheets_custom_map_published");
      assert.equal(unselectedMap.required, false);
      assert.equal(unselectedMap.satisfied, true);
      assert.equal(unselectedBody.blockers.includes("sheets_custom_map_published"), false);
    } finally {
      await hiddenApp.close();
    }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("header drift makes a verified permission probe stale without hiding the stored readiness", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const header = ["Date", "Lead Type", "Client Name"];
  const { db } = createDb({
    client: profileSheetsClient({
      schemaVersion: "company_sheets_campaign_custom_v1",
      header,
      writeReadiness: "verified",
      sheetsSelected: true,
    }),
    publishedMap: { spreadsheetId: SPREADSHEET, worksheetId: 0, headerSnapshot: ["Date", "Lead Type", "Other"] },
  });
  const app = await buildApp({ db });
  try {
    const response = await app.inject({
      method: "GET",
      url: `/admin/v1/clients/${CLIENT}/onboarding`,
      headers: adminHeaders(),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.sheets.writeReadiness, "verified");
    const gate = (id: string) => body.gates.find((item: { id: string }) => item.id === id);
    assert.equal(gate("sheets_header_dispatch_ready").satisfied, false);
    assert.equal(gate("sheets_custom_map_published").required, true);
    assert.equal(gate("sheets_custom_map_published").satisfied, false);
    assert.equal(gate("sheets_permission_probe").satisfied, false);
    assert.equal(body.blockers.includes("sheets_permission_probe"), true);
    assert.equal(body.blockers.includes("sheets_custom_map_published"), true);
    assert.equal(body.blockers.includes("sheets_writer_receipt"), false);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("Drive search filters locally, pages, and does not select duplicate or unapproved folders", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const fetched: string[] = [];
  const controlCalls: string[] = [];
  const { db, calls } = createDb();
  let namedMode: "ambiguous" | "unique" = "ambiguous";
  const app = await buildApp({
    db,
    sheetsDeps: {
      getAccessToken: async () => ({
        ok: true as const,
        accessToken: "test-token",
        connectionId: "company_connection",
        tokenVersion: 1,
        googleEmail: "sheets@lifeagentlaunch.test",
      }),
      establishControl: async () => {
        controlCalls.push("establish");
        throw new Error("establishControl was not expected");
      },
      findNamedChild: async () => {
        const files = [
          driveFile({ id: "nameMatchFolder1", name: "Fixture Client", mimeType: COMPANY_DRIVE_FOLDER_MIME }),
          driveFile({ id: "nameMatchFolder2", name: "Fixture Client", mimeType: COMPANY_DRIVE_FOLDER_MIME }),
        ];
        if (namedMode === "unique") return { ok: true as const, files: files.slice(0, 1) };
        return { ok: false as const, reason: "ambiguous" as const, files };
      },
      fetchImpl: async (url) => {
        const href = String(url);
        fetched.push(href);
        if (!href.startsWith(`${COMPANY_GOOGLE_DRIVE_FILES_URL}?`)) {
          throw new Error(`unexpected Drive URL ${href}`);
        }
        return new Response(
          JSON.stringify({
            nextPageToken: "next-page-token",
            files: [
              {
                id: "alexFolder0001",
                name: "Alex Gross Folder",
                mimeType: COMPANY_DRIVE_FOLDER_MIME,
                driveId: APPROVED_DRIVE,
                parents: [APPROVED_PARENT],
                trashed: false,
              },
              {
                id: "alexShortcut01",
                name: "Alex Shortcut",
                mimeType: COMPANY_DRIVE_SHORTCUT_MIME,
                driveId: APPROVED_DRIVE,
                parents: [APPROVED_PARENT],
                trashed: false,
                shortcutDetails: { targetId: SHORTCUT_TARGET },
              },
              {
                id: "alexTrash00001",
                name: "Alex Trash",
                mimeType: COMPANY_DRIVE_FOLDER_MIME,
                driveId: APPROVED_DRIVE,
                parents: [APPROVED_PARENT],
                trashed: true,
              },
              {
                id: "alexForeign001",
                name: "Alex Foreign Sheet",
                mimeType: COMPANY_DRIVE_SPREADSHEET_MIME,
                driveId: "foreignDrive001",
                parents: [APPROVED_PARENT],
                trashed: false,
              },
              {
                id: "otherFolder001",
                name: "Unrelated Folder",
                mimeType: COMPANY_DRIVE_FOLDER_MIME,
                driveId: APPROVED_DRIVE,
                parents: [APPROVED_PARENT],
                trashed: false,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      },
    },
  }, sheetsEnv());
  try {
    const response = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/drive/search`,
      headers: adminHeaders(),
      payload: { scope: "approved_parent", query: "Alex", pageToken: "cursor token" },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.saved, false);
    assert.equal(body.selectedFolderId, null);
    assert.equal(body.nameMatch, "ambiguous");
    assert.equal(body.nextPageToken, "next-page-token");
    assert.equal(body.suggestions.length, 2);
    assert.equal(body.suggestions.every((item: { selected: boolean }) => item.selected === false), true);
    const titles = body.items.map((item: { title: string }) => item.title);
    assert.deepEqual(titles, ["Alex Gross Folder", "Alex Shortcut", "Alex Trash", "Alex Foreign Sheet"]);
    const shortcut = body.items.find((item: { title: string }) => item.title === "Alex Shortcut");
    assert.equal(shortcut.selectable, false);
    assert.equal(shortcut.shortcut, true);
    assert.equal(shortcut.reason, "shortcut_bypass");
    const trashed = body.items.find((item: { title: string }) => item.title === "Alex Trash");
    assert.equal(trashed.selectable, false);
    assert.equal(trashed.reason, "trashed_file");
    const foreign = body.items.find((item: { title: string }) => item.title === "Alex Foreign Sheet");
    assert.equal(foreign.selectable, false);
    assert.equal(foreign.reason, "unapproved_shared_drive");
    const folder = body.items.find((item: { title: string }) => item.title === "Alex Gross Folder");
    assert.equal(folder.selectable, true);
    assert.equal(folder.selected, false);
    assert.equal(fetched.length, 1);
    const listed = new URL(fetched[0]!);
    assert.equal(decodeURIComponent(listed.searchParams.get("q") ?? "").includes("Alex"), false);
    assert.equal(listed.searchParams.get("pageToken"), "cursor token");
    assert.equal(fetched.some((url) => url.includes(SHORTCUT_TARGET)), false);
    assert.equal(controlCalls.length, 0);
    assert.equal(calls.some((call) => call.op === "update" || call.op === "create"), false);

    namedMode = "unique";
    const unique = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/drive/search`,
      headers: adminHeaders(),
      payload: { scope: "approved_parent", query: "Alex" },
    });
    assert.equal(unique.statusCode, 200);
    assert.equal(unique.json().nameMatch, "unique");
    assert.equal(unique.json().selectedFolderId, null);
    assert.equal(unique.json().saved, false);

    const mismatch = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/drive/search`,
      headers: adminHeaders(),
      payload: { scope: "approved_parent", query: "Alex", clientAccountId: OTHER },
    });
    assert.equal(mismatch.statusCode, 400);
    assert.equal(mismatch.json().error, "client_account_mismatch");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("folder URL resolution uses the authorized resolver and rejects invalid URLs before fetch", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const fetched: string[] = [];
  const driveReads: string[] = [];
  const { db } = createDb();
  const app = await buildApp({
    db,
    sheetsDeps: {
      getAccessToken: async () => ({
        ok: true as const,
        accessToken: "test-token",
        connectionId: "company_connection",
        tokenVersion: 1,
        googleEmail: "sheets@lifeagentlaunch.test",
      }),
      fetchImpl: async (url) => {
        fetched.push(String(url));
        throw new Error("folder resolve fetched a URL");
      },
      getDriveFile: async ({ fileId }) => {
        driveReads.push(fileId);
        if (fileId === FOLDER_ID) {
          return {
            ok: true as const,
            file: driveFile({
              id: FOLDER_ID,
              name: "Fixture Client",
              mimeType: COMPANY_DRIVE_FOLDER_MIME,
              parents: [APPROVED_PARENT],
            }),
          };
        }
        if (fileId === APPROVED_PARENT) {
          return {
            ok: true as const,
            file: driveFile({
              id: APPROVED_PARENT,
              name: "Approved Parent",
              mimeType: COMPANY_DRIVE_FOLDER_MIME,
              parents: [],
            }),
          };
        }
        if (fileId === "foreignFolder1") {
          return {
            ok: true as const,
            file: driveFile({
              id: "foreignFolder1",
              name: "Foreign",
              mimeType: COMPANY_DRIVE_FOLDER_MIME,
              driveId: "foreignDrive001",
              parents: [APPROVED_PARENT],
            }),
          };
        }
        throw new Error(`unexpected drive file ${fileId}`);
      },
    },
  });
  try {
    const invalid = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/drive/resolve`,
      headers: adminHeaders(),
      payload: { folder: "https://evil.example/folders/clientFolder01" },
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().error, "invalid_folder");
    assert.equal(fetched.length, 0);
    assert.equal(driveReads.length, 0);

    const missingClient = Fastify();
    const empty = createDb({ client: null });
    await missingClient.register(adminClientOnboardingV2ReadRoutes, {
      prefix: "/admin/v1",
      db: empty.db,
      env: readEnv(),
      sheetsDeps: {
        env: readEnv(),
        fetchImpl: async () => {
          throw new Error("missing client fetched a URL");
        },
      },
    });
    const missing = await missingClient.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/drive/resolve`,
      headers: adminHeaders(),
      payload: { folder: `https://drive.google.com/drive/folders/${FOLDER_ID}` },
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error, "client_not_found");
    await missingClient.close();

    const resolved = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/drive/resolve`,
      headers: adminHeaders(),
      payload: { folder: `https://drive.google.com/drive/folders/${FOLDER_ID}` },
    });
    assert.equal(resolved.statusCode, 200);
    const body = resolved.json();
    assert.equal(body.saved, false);
    assert.equal(body.folder.folderId, FOLDER_ID);
    assert.equal(body.folder.driveId, APPROVED_DRIVE);
    assert.deepEqual(driveReads, [FOLDER_ID, APPROVED_PARENT]);
    assert.equal(fetched.length, 0);

    const unapproved = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/drive/resolve`,
      headers: adminHeaders(),
      payload: { folder: "https://drive.google.com/drive/folders/foreignFolder1" },
    });
    assert.equal(unapproved.statusCode, 409);
    assert.equal(unapproved.json().error, "unapproved_shared_drive");
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("sheet preview classifies the fixture workbook and does not bind or write", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const metadataCalls: string[] = [];
  const valueCalls: string[] = [];
  const { db, calls } = createDb({ headerContract: ["Drifted"] });
  const sheetsDeps = {
    getAccessToken: async () => ({
      ok: true as const,
      accessToken: "test-token",
      connectionId: "company_connection",
      tokenVersion: 1,
      googleEmail: "sheets@lifeagentlaunch.test",
    }),
    establishControl: async (input: { spreadsheetId: string }) => {
      assert.equal([SPREADSHEET, "twoCampaignTabs"].includes(input.spreadsheetId), true);
      return { ok: true as const, controlBasis: "approved_shared_drive" as const, creationId: null };
    },
    getMetadata: async (input: { spreadsheetId: string }) => {
      metadataCalls.push(input.spreadsheetId);
      if (input.spreadsheetId === "twoCampaignTabs") {
        return {
          ok: true as const,
          metadata: {
            spreadsheetId: "twoCampaignTabs",
            title: "Two Tabs",
            spreadsheetUrl: "https://docs.google.com/spreadsheets/d/twoCampaignTabs",
            worksheets: [
              { sheetId: 21, title: "Campaign Leads", index: 0, hidden: false, sheetType: "GRID" },
              { sheetId: 22, title: "Campaign Leads", index: 1, hidden: false, sheetType: "GRID" },
            ],
          },
        };
      }
      return { ok: true as const, metadata: alexWorkbook() };
    },
    getValues: async (input: { range: string }) => {
      valueCalls.push(input.range);
      if (input.range.includes("Campaign Leads Copy") || input.range.includes("twoCampaign")) {
        return valuesFor(input.range.includes("A1:ZZ2") ? "'Campaign Leads Copy'!A1:ZZ2" : "'Campaign Leads Copy'!A1:A5001");
      }
      return valuesFor(input.range);
    },
    fetchImpl: async () => {
      throw new Error("preview fetched a URL");
    },
  };
  const app = await buildApp({ db, sheetsDeps });
  try {
    const statsTitle = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/sheets/preview`,
      headers: adminHeaders(),
      payload: {
        spreadsheetId: SPREADSHEET,
        purpose: "campaign",
        worksheetTitle: "Daily Stats",
        override: true,
      },
    });
    assert.equal(statsTitle.statusCode, 422);
    assert.equal(statsTitle.json().error, "stats_tab_not_a_delivery_target");
    assert.equal(metadataCalls.length, 0);

    const preview = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/sheets/preview`,
      headers: adminHeaders(),
      payload: { spreadsheetId: SPREADSHEET, purpose: "campaign" },
    });
    assert.equal(preview.statusCode, 200);
    const body = preview.json();
    assert.equal(body.saved, false);
    assert.equal(body.recommendation.selected, false);
    assert.equal(body.recommendation.bound, false);
    assert.equal(body.recommendation.existingBinding, true);
    assert.equal(body.recommendation.classification, "v3_exact_header");
    assert.equal(body.recommendation.fastPath, true);
    assert.equal(body.recommendation.title, "Campaign Leads");
    assert.equal(body.recommendation.requiresExplicitSelection, true);
    const byTitle = (title: string) => body.worksheets.find((sheet: { title: string }) => sheet.title === title);
    const campaign = byTitle("Campaign Leads");
    assert.equal(campaign.classification, "v3_exact_header");
    assert.equal(campaign.fastPath, true);
    assert.equal(campaign.historicalDataRows, "empty");
    assert.equal(campaign.headerDrift, true);
    assert.equal(campaign.reasons.includes("header_changed"), true);
    const legacy = byTitle("VET Web Form");
    assert.equal(legacy.classification, "legacy_custom_required");
    assert.equal(legacy.historicalDataRowCount, 5);
    assert.equal(legacy.deliveryEligible, false);
    assert.equal(legacy.header.includes("Age/ DOB"), true);
    assert.equal(legacy.header.includes("Primary Reason"), true);
    assert.equal(byTitle("Daily Stats").classification, "stats_excluded");
    assert.equal(byTitle("Weekly Stats").classification, "stats_excluded");
    assert.equal(byTitle("Prefix Extra").classification, "v3_prefix_with_extra_columns");
    assert.equal(byTitle("Prefix Extra").fastPath, false);
    assert.equal(byTitle("Blank Grid").classification, "compatible_empty");
    assert.equal(valueCalls.every((range) => range.endsWith("!A1:ZZ2") || range.includes("!A1:A")), true);
    assert.equal(valueCalls.some((range) => range.includes("!A1:A5001")), true);
    assert.equal(calls.some((call) => call.op === "update" || call.op === "create"), false);

    const statsId = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/sheets/preview`,
      headers: adminHeaders(),
      payload: { spreadsheetId: SPREADSHEET, purpose: "campaign", worksheetId: 13 },
    });
    assert.equal(statsId.statusCode, 422);
    assert.equal(statsId.json().error, "stats_tab_not_a_delivery_target");

    metadataCalls.length = 0;
    const tenant = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/sheets/preview`,
      headers: adminHeaders(),
      payload: { spreadsheetId: OTHER_SHEET, purpose: "campaign" },
    });
    assert.equal(tenant.statusCode, 403);
    assert.equal(tenant.json().error, "tenant_mismatch");
    assert.equal(metadataCalls.length, 0);

    const pasted = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/sheets/preview`,
      headers: adminHeaders(),
      payload: { spreadsheetId: "https://evil.example/spreadsheets/d/alexGrossSheet01", purpose: "campaign" },
    });
    assert.equal(pasted.statusCode, 400);
    assert.equal(pasted.json().error, "invalid_spreadsheet_ref");
    assert.equal(metadataCalls.length, 0);

    const ambiguous = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/sheets/preview`,
      headers: adminHeaders(),
      payload: { spreadsheetId: "twoCampaignTabs", purpose: "campaign" },
    });
    assert.equal(ambiguous.statusCode, 200);
    assert.equal(ambiguous.json().recommendation, null);
    assert.equal(ambiguous.json().saved, false);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("company sheets preview stays disabled when the company flag is off", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  const { db, calls } = throwingDb();
  const app = await buildApp(
    {
      db,
      sheetsDeps: {
        fetchImpl: async () => {
          throw new Error("disabled preview fetched a URL");
        },
        getMetadata: async () => {
          throw new Error("disabled preview read metadata");
        },
      },
    },
    sheetsEnv({ SA360_COMPANY_GOOGLE_SHEETS_ENABLED: "false" })
  );
  try {
    const response = await app.inject({
      method: "POST",
      url: `/admin/v1/clients/${CLIENT}/onboarding/sheets/preview`,
      headers: adminHeaders(),
      payload: { spreadsheetId: SPREADSHEET, purpose: "campaign" },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "destination_disabled");
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});
