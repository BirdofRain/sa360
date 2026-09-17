import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";

import { GOOGLE_SHEETS_HEADER_SCHEMA_VERSION } from "../../lib/google-sheets-env.js";
import { payloadContainsPlaintextSecret } from "../../lib/token-field-denylist.js";
import {
  createSa360SpreadsheetForClient,
  getGoogleSheetsDestinationForClient,
  resolveGoogleSpreadsheetForClient,
  saveGoogleSheetsDestinationForClient,
  testGoogleSheetAccessForClient,
  type GoogleSheetsDestinationDeps,
} from "./google-sheets-destination.service.js";
import { clientGoogleIntegrationRoutes } from "../../routes/integrations-google.js";

const ID = "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms";
const ACCESS = "ya29.destination-access";
const enabledEnv = {
  SA360_GOOGLE_SHEETS_DESTINATION_ENABLED: "true",
  SA360_GOOGLE_OAUTH_ENABLED: "false",
} as NodeJS.ProcessEnv;

const metadata = {
  spreadsheetId: ID,
  title: "Customer Sheet",
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}`,
  worksheets: [
    { sheetId: 0, title: "Leads", index: 0, hidden: false, sheetType: "GRID" },
    { sheetId: 99, title: "Chart", index: 1, hidden: false, sheetType: "OBJECT" },
  ],
};

function tokenOk() {
  return {
    ok: true as const,
    accessToken: ACCESS,
    connectionId: "conn-1",
    tokenVersion: 2,
  };
}

function sheetsDeps(overrides: Partial<GoogleSheetsDestinationDeps> = {}): GoogleSheetsDestinationDeps {
  return {
    env: enabledEnv,
    getAccessToken: async () => tokenOk(),
    getMetadata: async () => ({ ok: true as const, metadata }),
    createSpreadsheet: async () => ({
      ok: true as const,
      metadata: {
        ...metadata,
        title: "SA360 Leads",
        worksheets: [{ sheetId: 7, title: "Leads", index: 0, hidden: false, sheetType: "GRID" }],
      },
    }),
    getConnection: async () =>
      ({
        id: "conn-1",
        clientAccountId: "session-tenant",
        status: "connected",
        googleEmail: "user@example.com",
        googleDisplayName: "User",
        googleUserId: "sub",
        tokenExpiresAt: new Date().toISOString(),
        scopes: [],
        tokenType: "Bearer",
        tokenVersion: 2,
        connectedAt: new Date().toISOString(),
        lastRefreshedAt: null,
        reconnectRequiredAt: null,
        disconnectedAt: null,
        lastError: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }) as never,
    ...overrides,
  };
}

test("A/B. destination flag defaults off and blocks Sheets HTTP", async () => {
  let metadataCalls = 0;
  let tokenCalls = 0;
  const result = await resolveGoogleSpreadsheetForClient("tenant-a", ID, {
    env: { SA360_GOOGLE_OAUTH_ENABLED: "true" },
    getAccessToken: async () => {
      tokenCalls += 1;
      return tokenOk();
    },
    getMetadata: async () => {
      metadataCalls += 1;
      return { ok: true as const, metadata };
    },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "destination_disabled");
  assert.equal(metadataCalls, 0);
  assert.equal(tokenCalls, 0);
});

test("R. resolve returns safe tab metadata and does not persist", async () => {
  let persisted = 0;
  const db = {
    deliveryTarget: {
      findMany: async () => {
        persisted += 1;
        return [];
      },
      create: async () => {
        persisted += 1;
        throw new Error("must not persist");
      },
    },
  } as unknown as PrismaClient;
  const result = await resolveGoogleSpreadsheetForClient("session-tenant", `https://docs.google.com/spreadsheets/d/${ID}/edit`, {
    ...sheetsDeps(),
    db,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.spreadsheet.spreadsheetId, ID);
    assert.equal(result.spreadsheet.title, "Customer Sheet");
    assert.equal(result.spreadsheet.worksheets[0]?.sheetId, 0);
    assert.equal(JSON.stringify(result.spreadsheet).includes(ACCESS), false);
    assert.equal(JSON.stringify(result.spreadsheet).includes("refresh"), false);
  }
  assert.equal(persisted, 0);
});

test("H/I. resolve rejects evil URLs without fetching them", async () => {
  let fetched = 0;
  const result = await resolveGoogleSpreadsheetForClient(
    "session-tenant",
    "https://evil.example/spreadsheets/d/" + ID,
    sheetsDeps({
      getMetadata: async () => {
        fetched += 1;
        throw new Error("must not fetch supplied URL");
      },
    })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "invalid_spreadsheet_ref");
  assert.equal(fetched, 0);
});

test("S-W. resolve maps Google errors without raw bodies", async () => {
  const mapping: Array<[string, string]> = [
    ["access_denied", "access_denied"],
    ["not_found", "spreadsheet_unavailable"],
    ["rate_limited", "retryable"],
    ["server_error", "retryable"],
    ["network_error", "retryable"],
  ];
  for (const [reason, code] of mapping) {
    const result = await resolveGoogleSpreadsheetForClient(
      "session-tenant",
      ID,
      sheetsDeps({
        getMetadata: async () => ({ ok: false as const, reason: reason as never }),
      })
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, code);
      assert.equal(JSON.stringify(result).includes("PERMISSION_DENIED"), false);
      assert.equal(JSON.stringify(result).includes(ACCESS), false);
    }
  }
});

test("AR. disconnected Google account cannot resolve, create, or test", async () => {
  const disconnected = sheetsDeps({
    getAccessToken: async () => ({ ok: false as const, code: "google_not_connected" }),
  });
  const resolve = await resolveGoogleSpreadsheetForClient("session-tenant", ID, disconnected);
  const created = await createSa360SpreadsheetForClient("session-tenant", undefined, disconnected);
  const tested = await testGoogleSheetAccessForClient(
    "session-tenant",
    { spreadsheetId: ID, worksheetId: 0 },
    disconnected
  );
  assert.equal(resolve.ok, false);
  assert.equal(created.ok, false);
  assert.equal(tested.ok, false);
  if (!resolve.ok) assert.equal(resolve.code, "google_not_connected");
});

test("Y/AA. create uses default title, Leads worksheet, and writes no lead rows", async () => {
  let bodyTitle = "";
  const result = await createSa360SpreadsheetForClient(
    "session-tenant",
    undefined,
    sheetsDeps({
      createSpreadsheet: async (input) => {
        bodyTitle = input.title;
        assert.equal(input.worksheetTitle, "Leads");
        return {
          ok: true as const,
          metadata: {
            spreadsheetId: ID,
            title: input.title,
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}`,
            worksheets: [{ sheetId: 7, title: "Leads", index: 0, hidden: false, sheetType: "GRID" }],
          },
        };
      },
    })
  );
  assert.equal(result.ok, true);
  assert.equal(bodyTitle, "SA360 Leads");
  if (result.ok) {
    assert.equal(result.spreadsheet.createdBySa360, true);
    assert.equal(result.spreadsheet.worksheet.title, "Leads");
  }
});

test("AC/AD/AE. test is read-only and confirms the requested GRID worksheet", async () => {
  let methods: string[] = [];
  const ok = await testGoogleSheetAccessForClient(
    "session-tenant",
    { spreadsheetId: ID, worksheetId: 0 },
    sheetsDeps({
      getMetadata: async () => {
        methods.push("GET");
        return { ok: true as const, metadata };
      },
      createSpreadsheet: async () => {
        methods.push("POST");
        throw new Error("must not create");
      },
    })
  );
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.result.readOnlyAccess, true);
    assert.equal(ok.result.writePermissionVerified, false);
    assert.equal(ok.result.worksheetTitle, "Leads");
  }
  const missing = await testGoogleSheetAccessForClient(
    "session-tenant",
    { spreadsheetId: ID, worksheetId: 12345 },
    sheetsDeps()
  );
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.code, "worksheet_unavailable");
  const objectSheet = await testGoogleSheetAccessForClient(
    "session-tenant",
    { spreadsheetId: ID, worksheetId: 99 },
    sheetsDeps()
  );
  assert.equal(objectSheet.ok, false);
  if (!objectSheet.ok) assert.equal(objectSheet.code, "worksheet_not_grid");
  assert.deepEqual(methods, ["GET"]);
});

test("AF/AG/AH. destination save re-resolves server-side and stores references only", async () => {
  const stored: Record<string, unknown>[] = [];
  const db = {
    deliveryTarget: {
      findMany: async () => stored.map((row, index) => ({ id: `target-${index}`, ...row })),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        stored.push(data);
        return {
          id: "target-1",
          clientAccountId: "session-tenant",
          ...data,
        };
      },
      update: async () => stored[0],
      delete: async () => ({}),
    },
    deliveryInstruction: { count: async () => 0 },
  } as unknown as PrismaClient;
  let resolveCount = 0;
  const result = await saveGoogleSheetsDestinationForClient(
    "session-tenant",
    {
      spreadsheetId: ID,
      worksheetId: 0,
      createdBySa360: true,
    },
    sheetsDeps({
      db,
      getMetadata: async (input) => {
        resolveCount += 1;
        assert.equal(input.spreadsheetId, ID);
        assert.equal(input.accessToken, ACCESS);
        return { ok: true as const, metadata };
      },
    })
  );
  assert.equal(result.ok, true);
  assert.equal(resolveCount, 1);
  const metadataJson = stored[0]?.configMetadataJson as Record<string, unknown>;
  assert.equal(metadataJson.spreadsheetId, ID);
  assert.equal(metadataJson.worksheetId, 0);
  assert.equal(metadataJson.worksheetTitle, "Leads");
  assert.equal(metadataJson.headerSchemaVersion, GOOGLE_SHEETS_HEADER_SCHEMA_VERSION);
  assert.equal(metadataJson.connectionRefId, "conn-1");
  assert.equal(metadataJson.accessToken, undefined);
  assert.equal(payloadContainsPlaintextSecret(metadataJson, [ACCESS]), false);
  assert.equal(stored[0]?.enabled, false);
  assert.equal(stored[0]?.isRequired, false);
  if (result.ok && result.destination.configured) {
    assert.equal(JSON.stringify(result.destination).includes(ACCESS), false);
  }
});

test("C/D/E. Sheets routes require portal tenant and reject browser clientAccountId", async () => {
  const app = Fastify();
  const seen: string[] = [];
  await app.register(clientGoogleIntegrationRoutes, {
    prefix: "/client/v1",
    requirePortalTenant: async () => ({ clientAccountId: "session-tenant" }),
    sheetsDeps: sheetsDeps({
      getAccessToken: async (clientAccountId) => {
        seen.push(clientAccountId);
        return tokenOk();
      },
    }),
  });
  try {
    const resolved = await app.inject({
      method: "POST",
      url: "/client/v1/integrations/google/sheets/resolve",
      payload: { spreadsheet: ID },
    });
    assert.equal(resolved.statusCode, 200);
    assert.deepEqual(seen, ["session-tenant"]);

    const override = await app.inject({
      method: "POST",
      url: "/client/v1/integrations/google/sheets/resolve",
      payload: { spreadsheet: ID, clientAccountId: "other-tenant" },
    });
    assert.equal(override.statusCode, 400);

    const getOverride = await app.inject({
      method: "GET",
      url: "/client/v1/integrations/google/sheets/destination?clientAccountId=other-tenant",
    });
    assert.equal(getOverride.statusCode, 400);
  } finally {
    await app.close();
  }
});

test("C. Sheets destination routes require authenticated portal session", async () => {
  const previous = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "test-portal-api-key";
  const app = Fastify();
  await app.register(clientGoogleIntegrationRoutes, { prefix: "/client/v1" });
  try {
    for (const [method, url] of [
      ["POST", "/client/v1/integrations/google/sheets/resolve"],
      ["POST", "/client/v1/integrations/google/sheets/create"],
      ["POST", "/client/v1/integrations/google/sheets/test"],
      ["PUT", "/client/v1/integrations/google/sheets/destination"],
      ["GET", "/client/v1/integrations/google/sheets/destination"],
      ["DELETE", "/client/v1/integrations/google/sheets/destination"],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { "x-sa360-client-portal-key": "test-portal-api-key" },
      });
      assert.equal(response.statusCode, 401);
    }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.CLIENT_PORTAL_API_KEY;
    else process.env.CLIENT_PORTAL_API_KEY = previous;
  }
});

test("AT. GET destination returns no secrets when unconfigured", async () => {
  const db = {
    deliveryTarget: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const result = await getGoogleSheetsDestinationForClient("session-tenant", sheetsDeps({ db }));
  assert.equal(result.destination.configured, false);
  assert.equal(JSON.stringify(result).toLowerCase().includes("token"), false);
});
