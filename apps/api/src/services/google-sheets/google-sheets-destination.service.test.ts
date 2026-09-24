import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";

import { GOOGLE_SHEETS_HEADER_SCHEMA_VERSION } from "../../lib/google-sheets-env.js";
import { payloadContainsPlaintextSecret } from "../../lib/token-field-denylist.js";
import {
  createSa360SpreadsheetForClient,
  deleteGoogleSheetsDestinationForClient,
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

type FakeTarget = {
  id: string;
  clientAccountId: string;
  adapterKey: string;
  enabled: boolean;
  isPrimary: boolean;
  isRequired: boolean;
  displayName: string;
  readinessStatus: string;
  configMetadataJson: Record<string, unknown>;
  createdAt: Date;
};

/** In-memory DeliveryTarget store covering only the calls this service makes. */
function fakeDb(seed: { targets?: FakeTarget[]; instructionsFor?: string[] } = {}) {
  const targets: FakeTarget[] = [...(seed.targets ?? [])];
  const instructionsFor = new Set(seed.instructionsFor ?? []);
  let sequence = targets.length;

  const matches = (target: FakeTarget, where: Record<string, unknown>) => {
    if (where.clientAccountId && target.clientAccountId !== where.clientAccountId) return false;
    if (where.adapterKey && target.adapterKey !== where.adapterKey) return false;
    const id = where.id as { in?: string[] } | string | undefined;
    if (typeof id === "string" && target.id !== id) return false;
    if (id && typeof id === "object" && id.in && !id.in.includes(target.id)) return false;
    return true;
  };

  const db = {
    $executeRaw: async () => 0,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    deliveryTarget: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        targets.filter((target) => matches(target, where)),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        sequence += 1;
        const { clientAccount, ...fields } = data as Record<string, unknown>;
        void clientAccount;
        const created: FakeTarget = {
          id: `target-${sequence}`,
          createdAt: new Date(),
          clientAccountId: "session-tenant",
          ...(fields as unknown as Omit<FakeTarget, "id" | "createdAt" | "clientAccountId">),
        };
        targets.push(created);
        return created;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = targets.find((target) => target.id === where.id);
        if (!row) throw new Error("not_found");
        Object.assign(row, data);
        return row;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        const index = targets.findIndex((target) => target.id === where.id);
        if (index === -1) throw new Error("not_found");
        return targets.splice(index, 1)[0];
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const doomed = targets.filter((target) => matches(target, where));
        for (const target of doomed) {
          targets.splice(targets.indexOf(target), 1);
        }
        return { count: doomed.length };
      },
    },
    deliveryInstruction: {
      count: async ({ where }: { where: { deliveryTargetId: string | { in: string[] } } }) => {
        const ref = where.deliveryTargetId;
        const ids = typeof ref === "string" ? [ref] : ref.in;
        return ids.filter((id) => instructionsFor.has(id)).length;
      },
    },
  };
  return { db: db as unknown as PrismaClient, targets };
}

function sheetsTarget(overrides: Partial<FakeTarget> = {}): FakeTarget {
  return {
    id: "target-existing",
    clientAccountId: "session-tenant",
    adapterKey: "google_sheets.v1",
    enabled: false,
    isPrimary: false,
    isRequired: false,
    displayName: "Google Sheets",
    readinessStatus: "configured",
    configMetadataJson: {
      connectionRefId: "conn-1",
      spreadsheetId: ID,
      spreadsheetTitle: "Customer Sheet",
      worksheetId: 0,
      worksheetTitle: "Leads",
      headerSchemaVersion: GOOGLE_SHEETS_HEADER_SCHEMA_VERSION,
      createdBySa360: false,
    },
    createdAt: new Date(),
    ...overrides,
  };
}

test("AF/AG/AH. destination save re-resolves server-side and stores references only", async () => {
  const { db, targets } = fakeDb();
  let resolveCount = 0;
  const result = await saveGoogleSheetsDestinationForClient(
    "session-tenant",
    { spreadsheetId: ID, worksheetId: 0 },
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
  const metadataJson = targets[0]?.configMetadataJson as Record<string, unknown>;
  assert.equal(metadataJson.spreadsheetId, ID);
  assert.equal(metadataJson.worksheetId, 0);
  assert.equal(metadataJson.worksheetTitle, "Leads");
  assert.equal(metadataJson.headerSchemaVersion, GOOGLE_SHEETS_HEADER_SCHEMA_VERSION);
  assert.equal(metadataJson.connectionRefId, "conn-1");
  assert.equal(metadataJson.accessToken, undefined);
  assert.equal(payloadContainsPlaintextSecret(metadataJson, [ACCESS]), false);
  assert.equal(targets[0]?.enabled, false);
  assert.equal(targets[0]?.isRequired, false);
  if (result.ok && result.destination.configured) {
    assert.equal(JSON.stringify(result.destination).includes(ACCESS), false);
  }
});

test("HIGH #1. browser createdBySa360=true is never persisted for a pasted spreadsheet", async () => {
  const { db, targets } = fakeDb();
  const result = await saveGoogleSheetsDestinationForClient(
    "session-tenant",
    // A pasted spreadsheet the customer already owned, with a forged claim.
    { spreadsheetId: ID, worksheetId: 0, createdBySa360: true } as never,
    sheetsDeps({ db })
  );
  assert.equal(result.ok, true);
  const stored = targets[0]?.configMetadataJson as Record<string, unknown>;
  assert.equal(stored.createdBySa360, false);
  if (result.ok && result.destination.configured) {
    assert.equal(result.destination.createdBySa360, false);
  }
});

test("HIGH #1. PUT body cannot set provenance or target flags through the route", async () => {
  const { db, targets } = fakeDb();
  const app = Fastify();
  await app.register(clientGoogleIntegrationRoutes, {
    prefix: "/client/v1",
    requirePortalTenant: async () => ({ clientAccountId: "session-tenant" }),
    sheetsDeps: sheetsDeps({ db }),
  });
  try {
    const response = await app.inject({
      method: "PUT",
      url: "/client/v1/integrations/google/sheets/destination",
      payload: {
        spreadsheetId: ID,
        worksheetId: 0,
        createdBySa360: true,
        enabled: true,
        isRequired: true,
        isPrimary: true,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(targets.length, 1);
    assert.equal(targets[0]?.enabled, false);
    assert.equal(targets[0]?.isRequired, false);
    assert.equal(targets[0]?.isPrimary, false);
    assert.equal(
      (targets[0]?.configMetadataJson as Record<string, unknown>).createdBySa360,
      false
    );
    assert.equal(response.json().destination.createdBySa360, false);
  } finally {
    await app.close();
  }
});

test("LOW. invalid worksheet ids are rejected before any Google request", async () => {
  const invalid = [
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    1.5,
    "0",
    "abc",
    1e20,
    Number.MAX_SAFE_INTEGER,
    2_147_483_648,
    null,
    undefined,
    true,
  ];
  for (const worksheetId of invalid) {
    let googleCalls = 0;
    const deps = sheetsDeps({
      db: fakeDb().db,
      getMetadata: async () => {
        googleCalls += 1;
        return { ok: true as const, metadata };
      },
    });
    const saved = await saveGoogleSheetsDestinationForClient(
      "session-tenant",
      { spreadsheetId: ID, worksheetId },
      deps
    );
    const tested = await testGoogleSheetAccessForClient(
      "session-tenant",
      { spreadsheetId: ID, worksheetId },
      deps
    );
    assert.equal(saved.ok, false, `save accepted ${String(worksheetId)}`);
    if (!saved.ok) assert.equal(saved.code, "invalid_worksheet");
    assert.equal(tested.ok, false, `test accepted ${String(worksheetId)}`);
    if (!tested.ok) assert.equal(tested.code, "invalid_worksheet");
    assert.equal(googleCalls, 0, `Google called for ${String(worksheetId)}`);
  }
});

test("LOW. a Google 400 is not reported as a missing spreadsheet", async () => {
  const result = await resolveGoogleSpreadsheetForClient(
    "session-tenant",
    ID,
    sheetsDeps({ getMetadata: async () => ({ ok: false as const, reason: "invalid_request" }) })
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "invalid_spreadsheet_ref");
    assert.equal(result.statusCode, 400);
  }
});

test("HIGH #2. repeated identical saves keep exactly one target row", async () => {
  const { db, targets } = fakeDb();
  for (let i = 0; i < 3; i += 1) {
    const result = await saveGoogleSheetsDestinationForClient(
      "session-tenant",
      { spreadsheetId: ID, worksheetId: 0 },
      sheetsDeps({ db })
    );
    assert.equal(result.ok, true);
  }
  assert.equal(targets.length, 1);
});

test("HIGH #2. delete aborts without removing anything when any Sheets target is in use", async () => {
  const inUse = sheetsTarget({ id: "target-in-use" });
  const { db, targets } = fakeDb({
    targets: [sheetsTarget({ id: "target-free" }), inUse],
    instructionsFor: [inUse.id],
  });
  let googleCalls = 0;
  const result = await deleteGoogleSheetsDestinationForClient(
    "session-tenant",
    sheetsDeps({
      db,
      getMetadata: async () => {
        googleCalls += 1;
        return { ok: true as const, metadata };
      },
      createSpreadsheet: async () => {
        googleCalls += 1;
        throw new Error("must not create");
      },
    })
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "destination_in_use");
  // No partial delete: the unreferenced row survives too.
  assert.equal(targets.length, 2);
  assert.equal(googleCalls, 0);
});

test("HIGH #2. delete removes only the local target, with no Google call", async () => {
  const { db, targets } = fakeDb({ targets: [sheetsTarget()] });
  let googleCalls = 0;
  let connectionReads = 0;
  const result = await deleteGoogleSheetsDestinationForClient(
    "session-tenant",
    sheetsDeps({
      db,
      getMetadata: async () => {
        googleCalls += 1;
        return { ok: true as const, metadata };
      },
      getConnection: (async () => {
        connectionReads += 1;
        return { id: "conn-1", clientAccountId: "session-tenant", status: "connected" };
      }) as never,
    })
  );
  assert.equal(result.ok, true);
  assert.equal(targets.length, 0);
  assert.equal(googleCalls, 0);
  // The OAuth connection is only read for the status summary, never disconnected.
  assert.equal(connectionReads, 1);
  if (result.ok) assert.equal(result.destination.connection.status, "connected");
});

test("delete leaves an unrelated GHL target untouched", async () => {
  const ghl = sheetsTarget({
    id: "ghl-target",
    adapterKey: "ghl.crm.v1",
    enabled: true,
    isRequired: true,
  });
  const { db, targets } = fakeDb({ targets: [sheetsTarget(), ghl] });
  const result = await deleteGoogleSheetsDestinationForClient(
    "session-tenant",
    sheetsDeps({ db })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(
    targets.map((target) => target.adapterKey),
    ["ghl.crm.v1"]
  );
  assert.equal(targets[0]?.enabled, true);
  assert.equal(targets[0]?.isRequired, true);
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
