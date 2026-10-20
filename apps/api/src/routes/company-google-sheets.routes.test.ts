import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import {
  adminCompanyGoogleSheetsRoutes,
  clientCompanySheetsReadRoutes,
} from "./company-google-sheets.js";

test("company Google admin mutations require the admin key", async () => {
  const previous = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "company-admin-key";
  const app = Fastify();
  await app.register(adminCompanyGoogleSheetsRoutes, { prefix: "/admin/v1" });
  try {
    for (const [method, url] of [
      ["GET", "/admin/v1/integrations/google/company"],
      ["GET", "/admin/v1/integrations/google/company/oauth/start"],
      ["POST", "/admin/v1/integrations/google/company/disconnect"],
      ["PUT", "/admin/v1/integrations/google/company/folder"],
      ["POST", "/admin/v1/clients/client_a/google-sheets/resolve"],
      ["PUT", "/admin/v1/clients/client_a/google-sheets/destination"],
      ["DELETE", "/admin/v1/clients/client_a/google-sheets/destination"],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { "x-sa360-client-portal-key": "portal-key" },
        payload: method === "GET" ? undefined : {},
      });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
    }
    const authed = await app.inject({
      method: "GET",
      url: "/admin/v1/integrations/google/company",
      headers: { "x-sa360-admin-key": "company-admin-key" },
    });
    assert.equal(authed.statusCode, 200);
    const body = authed.json();
    assert.equal(body.connection.liveDeliveryEnabled, false);
    assert.equal(JSON.stringify(body).includes("accessToken"), false);
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
  }
});

test("portal company sheets read uses the session tenant and rejects overrides", async () => {
  const seen: string[] = [];
  const app = Fastify();
  await app.register(clientCompanySheetsReadRoutes, {
    prefix: "/client/v1",
    requirePortalTenant: async () => ({ clientAccountId: "session-tenant" }),
    sheetsDeps: {
      db: {
        companySheetsDestination: {
          findUnique: async ({ where }: { where: { clientAccountId: string } }) => {
            seen.push(where.clientAccountId);
            if (where.clientAccountId !== "session-tenant") return null;
            return {
              id: "dest",
              clientAccountId: "session-tenant",
              companyConnectionId: "company",
              spreadsheetId: "sheet",
              spreadsheetTitle: "Session Leads",
              spreadsheetUrl: "https://docs.google.com/spreadsheets/d/sheet",
              worksheetId: 0,
              worksheetTitle: "Leads",
              controlBasis: "company_created",
              companySpreadsheetCreationId: null,
              accessStatus: "readable",
              accessCheckedAt: new Date("2026-10-20T00:00:00.000Z"),
              writeReadiness: "not_verified",
              deliveryExecution: "disabled",
              sharingStatus: "missing_recipient",
              intendedRecipientEmail: null,
              enabled: false,
              createdByActor: "admin_api",
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        },
        companyGoogleConnection: {
          findUnique: async () => ({
            id: "company",
            status: "connected",
            googleEmail: "sheets@lifeagentlaunch.test",
          }),
        },
      } as never,
    },
  });
  try {
    const ok = await app.inject({ method: "GET", url: "/client/v1/integrations/google/company-sheets" });
    assert.equal(ok.statusCode, 200);
    const body = ok.json();
    assert.equal(body.destination.clientAccountId, "session-tenant");
    assert.equal(body.destination.deliveryExecution, "disabled");
    assert.equal(body.destination.orderDelivery.automatedWritesEnabled, false);
    assert.equal(JSON.stringify(body).includes("sheets@lifeagentlaunch.test"), false);
    assert.deepEqual(seen, ["session-tenant"]);

    const override = await app.inject({
      method: "GET",
      url: "/client/v1/integrations/google/company-sheets?clientAccountId=other-tenant",
    });
    assert.equal(override.statusCode, 400);

    const write = await app.inject({
      method: "PUT",
      url: "/client/v1/integrations/google/company-sheets",
      payload: { spreadsheetId: "sheet", worksheetId: 0 },
    });
    assert.equal(write.statusCode, 404);
  } finally {
    await app.close();
  }
});

test("company OAuth start stays disabled unless the company flag is exactly true", async () => {
  const previousAdmin = process.env.ADMIN_API_KEY;
  const previousFlag = process.env.SA360_COMPANY_GOOGLE_OAUTH_ENABLED;
  process.env.ADMIN_API_KEY = "company-admin-key";
  delete process.env.SA360_COMPANY_GOOGLE_OAUTH_ENABLED;
  const app = Fastify();
  await app.register(adminCompanyGoogleSheetsRoutes, { prefix: "/admin/v1" });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/admin/v1/integrations/google/company/oauth/start?returnTo=/clients/acme/google-sheets",
      headers: { "x-sa360-admin-key": "company-admin-key" },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error, "oauth_disabled");
  } finally {
    await app.close();
    if (previousAdmin === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previousAdmin;
    if (previousFlag === undefined) delete process.env.SA360_COMPANY_GOOGLE_OAUTH_ENABLED;
    else process.env.SA360_COMPANY_GOOGLE_OAUTH_ENABLED = previousFlag;
  }
});
