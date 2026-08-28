import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import type { LeadOrderReleasedDeliveriesServiceDeps } from "../services/lead-order/lead-order-released-deliveries.service.js";
import type { ReleasedLeadDeliveryExportPackageRow } from "../repositories/lead-delivery-export-package.repository.js";
import { clientPortalRoutes } from "./client-portal.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;
const CSV = "first_name,last_name\nAda,Lovelace\n";

const ownerOrder = {
  id: "ord_1",
  clientAccountId: "acct_a",
  orderNumber: "LO-1001",
};

function releasedRow(
  overrides: Partial<ReleasedLeadDeliveryExportPackageRow> = {}
): ReleasedLeadDeliveryExportPackageRow {
  return {
    id: "pkg_released",
    leadOrderId: "ord_1",
    clientAccountId: "acct_a",
    rowCount: 3,
    csvContent: CSV,
    spreadsheetDeliveredAt: new Date("2026-08-20T15:00:00.000Z"),
    createdAt: new Date("2026-08-19T12:00:00.000Z"),
    metadataJson: { niche: "vet", commerceAgeBucketKey: "COMMERCE_3_6_MO" },
    leadOrder: {
      orderNumber: "LO-1001",
      clientDisplayName: "Valley Vet",
      nicheKey: "vet",
      statesJson: ["TX"],
    },
    ...overrides,
  };
}

function prismaWithPortalAccount(clientAccountId = "acct_a") {
  const row = {
    clientAccountId,
    clientDisplayName: "Valley Vet",
    portalEnabled: true,
    portalDisplayName: "Valley",
    portalLoginEmail: "portal@example.com",
    primaryNicheKeys: [],
    primaryProductTypes: [],
    ghlDestination: null,
  };
  const base = createEmptyPrismaMock();
  return {
    ...base,
    clientAccount: {
      findUnique: async () => row,
      findFirst: async () => row,
    },
  } as unknown as ReturnType<typeof createEmptyPrismaMock>;
}

async function buildApp(deps: LeadOrderReleasedDeliveriesServiceDeps) {
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: prismaWithPortalAccount() },
    leadOrderDeps: deps,
  });
  return app;
}

function authHeaders() {
  return { [HEADER]: process.env.CLIENT_PORTAL_API_KEY ?? "portal-secret" };
}

test("generated/unreleased packages are invisible on the client list", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildApp({
    findLeadOrderByIdImpl: async () => ownerOrder as never,
    listReleasedLeadDeliveryExportPackagesForOrderImpl: async () => [],
  });

  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.deepEqual(body.items, []);
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  await app.close();
});

test("released packages are visible and multiple released batches are preserved", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildApp({
    findLeadOrderByIdImpl: async () => ownerOrder as never,
    listReleasedLeadDeliveryExportPackagesForOrderImpl: async () => [
      releasedRow({ id: "pkg_a", rowCount: 10 }),
      releasedRow({
        id: "pkg_b",
        rowCount: 15,
        spreadsheetDeliveredAt: new Date("2026-08-21T15:00:00.000Z"),
      }),
    ],
  });

  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.items.length, 2);
  assert.deepEqual(
    body.items.map((item: { id: string; leadCount: number }) => ({
      id: item.id,
      leadCount: item.leadCount,
    })),
    [
      { id: "pkg_a", leadCount: 10 },
      { id: "pkg_b", leadCount: 15 },
    ]
  );
  for (const item of body.items) {
    assert.equal(item.downloadAvailable, true);
    assert.equal(item.orderId, "ord_1");
    assert.equal(Object.hasOwn(item, "allocationIds"), false);
    assert.equal(Object.hasOwn(item, "csvContent"), false);
    assert.equal(Object.hasOwn(item, "idempotencyKey"), false);
    assert.equal(Object.hasOwn(item, "createdBy"), false);
    assert.equal(Object.hasOwn(item, "spreadsheetDeliveredBy"), false);
    assert.equal(Object.hasOwn(item, "metadataJson"), false);
  }
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  await app.close();
});

test("owner can download a released package with safe CSV headers", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildApp({
    findLeadOrderByIdImpl: async () => ownerOrder as never,
    findReleasedLeadDeliveryExportPackageForClientImpl: async () => releasedRow(),
  });

  const meta = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports/pkg_released?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(meta.statusCode, 200);
  assert.equal(meta.json().item.id, "pkg_released");

  const res = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports/pkg_released/download?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"] ?? "", /text\/csv/);
  assert.match(String(res.headers["content-disposition"] ?? ""), /attachment; filename="/);
  assert.match(String(res.headers["content-disposition"] ?? ""), /\.csv"/);
  assert.doesNotMatch(String(res.headers["content-disposition"] ?? ""), /\//);
  assert.equal(res.body, CSV);
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  await app.close();
});

test("another tenant, missing package, and unreleased download all return the same 404", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildApp({
    findLeadOrderByIdImpl: async (id: string) =>
      id === "ord_1" ? (ownerOrder as never) : null,
    findReleasedLeadDeliveryExportPackageForClientImpl: async () => null,
    listReleasedLeadDeliveryExportPackagesForOrderImpl: async () => [],
  });

  const foreignOrder = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_other/exports?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(foreignOrder.statusCode, 404);
  assert.equal(foreignOrder.json().error, "Lead order not found");

  const missing = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports/pkg_missing/download?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  const unreleased = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports/pkg_unreleased/download?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(unreleased.statusCode, 404);
  assert.deepEqual(missing.json(), unreleased.json());
  assert.equal(missing.json().error, "Delivery not found");
  assert.equal(Object.hasOwn(missing.json(), "spreadsheetDeliveredAt"), false);

  const pathProbe = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports/../secret/download?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.ok(pathProbe.statusCode === 400 || pathProbe.statusCode === 404);
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  await app.close();
});

test("release failure leaves the package invisible to customer download", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  let released = false;
  const app = await buildApp({
    findLeadOrderByIdImpl: async () => ownerOrder as never,
    listReleasedLeadDeliveryExportPackagesForOrderImpl: async () =>
      released ? [releasedRow()] : [],
    findReleasedLeadDeliveryExportPackageForClientImpl: async () =>
      released ? releasedRow() : null,
  });

  const before = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports/pkg_released/download?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(before.statusCode, 404);

  released = true;
  const after = await app.inject({
    method: "GET",
    url: `${PREFIX}/lead-orders/ord_1/exports/pkg_released/download?clientAccountId=acct_a`,
    headers: authHeaders(),
  });
  assert.equal(after.statusCode, 200);
  assert.equal(after.body, CSV);
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  await app.close();
});
