import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { adminCompanySheetsDeliveryRoutes } from "./company-sheets-delivery.js";

test("sheets history routes require the admin key and do not read a client first", async () => {
  const previous = process.env.ADMIN_API_KEY;
  const previousSheets = process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED;
  process.env.ADMIN_API_KEY = "history-admin-key";
  process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED = "false";
  const app = Fastify();
  await app.register(adminCompanySheetsDeliveryRoutes, { prefix: "/admin/v1" });
  try {
    for (const [method, url] of [
      ["GET", "/admin/v1/clients/client_a/google-sheets/history"],
      ["POST", "/admin/v1/clients/client_a/google-sheets/history/prepare"],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: { "x-sa360-client-portal-key": "portal-key" },
        payload: method === "POST" ? {} : undefined,
      });
      assert.equal(response.statusCode, 401, `${method} ${url}`);
      assert.equal(response.json().error, "Unauthorized");
    }
  } finally {
    await app.close();
    if (previous === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = previous;
    if (previousSheets === undefined) delete process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED;
    else process.env.SA360_COMPANY_GOOGLE_SHEETS_ENABLED = previousSheets;
  }
});
