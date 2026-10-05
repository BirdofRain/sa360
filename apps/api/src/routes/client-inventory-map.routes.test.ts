import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { CANONICAL_US_STATE_CODES } from "@sa360/shared";

import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import type { ClientStateAvailabilityReadModel } from "../services/lead-inventory/lead-inventory-client-state-availability.service.js";
import { clientInventoryMapRoutes } from "./client-inventory-map.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;
const ROUTE = `${PREFIX}/leads-on-demand/state-availability`;

function prismaWithPortalAccount(
  overrides: Partial<{ portalEnabled: boolean; clientAccountId: string }> = {}
) {
  const clientAccountId = overrides.clientAccountId ?? "acct_a";
  const row = {
    clientAccountId,
    clientDisplayName: "Northwind",
    portalEnabled: overrides.portalEnabled ?? true,
    ghlDestination: null,
  };
  const base = createEmptyPrismaMock();
  return {
    ...base,
    clientAccount: {
      findUnique: async ({ where }: { where: { clientAccountId?: string } }) =>
        where.clientAccountId === clientAccountId ? row : null,
      findFirst: async () => row,
    },
  } as unknown as ReturnType<typeof createEmptyPrismaMock>;
}

function liveModel(nicheKey: string | null): ClientStateAvailabilityReadModel {
  return {
    catalogScope: "global_lal_inventory",
    advisory: true,
    filters: { nicheKey, productType: null },
    evaluatedAt: "2026-10-05T12:00:00.000Z",
    dataStatus: "live",
    states: CANONICAL_US_STATE_CODES.map((stateCode) => ({
      stateCode,
      availabilityLabel: stateCode === "TX" ? "Available" : "Currently unavailable",
    })),
    summary: {
      Available: 1,
      Limited: 0,
      "Currently unavailable": CANONICAL_US_STATE_CODES.length - 1,
    },
  };
}

async function buildApp(opts: {
  prisma?: ReturnType<typeof createEmptyPrismaMock>;
  onBuild?: (filters: { clientAccountId: string; nicheKey?: string; productType?: string }) => void;
} = {}) {
  const app = Fastify({ logger: false });
  await app.register(clientInventoryMapRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: opts.prisma ?? prismaWithPortalAccount() },
    buildStateAvailabilityImpl: async (filters) => {
      opts.onBuild?.(filters);
      return liveModel(filters.nicheKey ?? null);
    },
  });
  return app;
}

async function withPortalKey<T>(fn: () => Promise<T>): Promise<T> {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevA = process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  try {
    return await fn();
  } finally {
    if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
    else delete process.env.CLIENT_PORTAL_API_KEY;
    if (prevA !== undefined) process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID = prevA;
    else delete process.env.CLIENT_PORTAL_CLIENT_ACCOUNT_ID;
  }
}

test("GET state-availability requires the client portal key", async () => {
  await withPortalKey(async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `${ROUTE}?clientAccountId=acct_a` });
    assert.equal(res.statusCode, 401, res.body);
  });
});

test("GET state-availability returns the advisory read model scoped to the resolved tenant", async () => {
  await withPortalKey(async () => {
    let seen: { clientAccountId: string; nicheKey?: string; productType?: string } | null = null;
    const app = await buildApp({ onBuild: (filters) => (seen = filters) });
    const res = await app.inject({
      method: "GET",
      url: `${ROUTE}?clientAccountId=acct_a&nicheKey=vet&productType=exclusive`,
      headers: { [HEADER]: "portal-secret" },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { ok: boolean; availability: ClientStateAvailabilityReadModel };
    assert.equal(body.ok, true);
    assert.equal(body.availability.advisory, true);
    assert.equal(body.availability.dataStatus, "live");
    assert.equal(body.availability.states.length, CANONICAL_US_STATE_CODES.length);
    assert.deepEqual(seen, {
      clientAccountId: "acct_a",
      nicheKey: "vet",
      productType: "exclusive",
    });
  });
});

test("GET state-availability rejects unknown tenants and disabled portals", async () => {
  await withPortalKey(async () => {
    const app = await buildApp();
    const missing = await app.inject({
      method: "GET",
      url: `${ROUTE}?clientAccountId=acct_other`,
      headers: { [HEADER]: "portal-secret" },
    });
    assert.equal(missing.statusCode, 404, missing.body);

    const disabledApp = await buildApp({
      prisma: prismaWithPortalAccount({ portalEnabled: false }),
    });
    const disabled = await disabledApp.inject({
      method: "GET",
      url: `${ROUTE}?clientAccountId=acct_a`,
      headers: { [HEADER]: "portal-secret" },
    });
    assert.equal(disabled.statusCode, 403, disabled.body);
    assert.equal((disabled.json() as { code: string }).code, "PORTAL_DISABLED");
  });
});

test("state-availability exposes no write methods", async () => {
  await withPortalKey(async () => {
    const app = await buildApp();
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await app.inject({
        method,
        url: `${ROUTE}?clientAccountId=acct_a`,
        headers: { [HEADER]: "portal-secret" },
        payload: {},
      });
      assert.equal(res.statusCode, 404, `${method} should not be routable`);
    }
  });
});
