import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { ClientAccount } from "@prisma/client";

import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import type { ClientAccountProfileDto } from "../services/client-account-profile.present.js";
import { clientAccountProfileRoutes } from "./client-account-profile.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;

function accountRow(overrides: Partial<ClientAccount> = {}): ClientAccount & {
  ghlDestination: null;
} {
  return {
    clientAccountId: "acct_a",
    clientDisplayName: "Northwind",
    status: "onboarding",
    portalEnabled: true,
    portalDisplayName: null,
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: [],
    primaryProductTypes: [],
    notes: "internal",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ghlDestination: null,
    ...overrides,
  } as ClientAccount & { ghlDestination: null };
}

function prismaWithPortalAccount(
  overrides: Partial<{ portalEnabled: boolean; clientAccountId: string }> = {}
) {
  const clientAccountId = overrides.clientAccountId ?? "acct_a";
  const row = {
    clientAccountId,
    clientDisplayName: "Northwind",
    portalEnabled: overrides.portalEnabled ?? true,
    portalDisplayName: null,
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: [],
    primaryProductTypes: [],
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

async function buildApp(
  prisma = prismaWithPortalAccount(),
  row: ClientAccount & { ghlDestination: null } = accountRow()
) {
  const app = Fastify({ logger: false });
  await app.register(clientAccountProfileRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: prisma },
    accountProfileDeps: {
      findClientAccountByIdImpl: async (id) => (id === row.clientAccountId ? row : null),
      updateClientAccountImpl: async (id, data) => {
        if (id !== row.clientAccountId) {
          throw new Error("update targeted a different tenant");
        }
        return {
          ...row,
          clientDisplayName:
            data.clientDisplayName !== undefined
              ? String(data.clientDisplayName)
              : row.clientDisplayName,
          portalDisplayName:
            data.portalDisplayName !== undefined
              ? (data.portalDisplayName as string | null)
              : row.portalDisplayName,
          primaryNicheKeys:
            data.primaryNicheKeys !== undefined ? data.primaryNicheKeys : row.primaryNicheKeys,
          primaryProductTypes:
            data.primaryProductTypes !== undefined
              ? data.primaryProductTypes
              : row.primaryProductTypes,
          status: (data.status as ClientAccount["status"] | undefined) ?? row.status,
        } as typeof row;
      },
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

test("GET /client/v1/account returns the resolved tenant profile", async () => {
  await withPortalKey(async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `${PREFIX}/account?clientAccountId=acct_a`,
      headers: { [HEADER]: "portal-secret" },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { ok: boolean; account: ClientAccountProfileDto };
    assert.equal(body.ok, true);
    assert.equal(body.account.clientDisplayName, "Northwind");
    assert.equal(body.account.status, "onboarding");
    assert.equal("notes" in body.account, false);
    await app.close();
  });
});

test("PATCH /client/v1/account writes allowed fields and rejects internal fields", async () => {
  await withPortalKey(async () => {
    const app = await buildApp();
    const allowed = await app.inject({
      method: "PATCH",
      url: `${PREFIX}/account?clientAccountId=acct_a`,
      headers: { [HEADER]: "portal-secret" },
      payload: {
        clientDisplayName: "Northwind Benefits",
        primaryNicheKeys: ["vet"],
        primaryProductTypes: ["aged"],
      },
    });
    assert.equal(allowed.statusCode, 200, allowed.body);
    const saved = allowed.json() as { account: ClientAccountProfileDto };
    assert.equal(saved.account.clientDisplayName, "Northwind Benefits");
    assert.equal(saved.account.status, "onboarding");

    const forbidden = await app.inject({
      method: "PATCH",
      url: `${PREFIX}/account?clientAccountId=acct_a`,
      headers: { [HEADER]: "portal-secret" },
      payload: {
        status: "active",
        portalEnabled: true,
        notes: "hack",
        clientAccountId: "acct_other",
      },
    });
    assert.equal(forbidden.statusCode, 400);
    await app.close();
  });
});

test("POST complete-onboarding stays onboarding when required fields are missing", async () => {
  await withPortalKey(async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `${PREFIX}/account/complete-onboarding?clientAccountId=acct_a`,
      headers: { [HEADER]: "portal-secret" },
      payload: { portalDisplayName: "Northwind" },
    });
    assert.equal(res.statusCode, 400, res.body);
    const body = res.json() as { code?: string; account?: ClientAccountProfileDto };
    assert.equal(body.code, "PROFILE_INCOMPLETE");
    assert.equal(body.account?.status, "onboarding");
    await app.close();
  });
});

test("POST complete-onboarding promotes a valid onboarding profile to active", async () => {
  await withPortalKey(async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: `${PREFIX}/account/complete-onboarding?clientAccountId=acct_a`,
      headers: { [HEADER]: "portal-secret" },
      payload: {
        primaryNicheKeys: ["vet"],
        primaryProductTypes: ["aged"],
      },
    });
    assert.equal(res.statusCode, 200, res.body);
    const body = res.json() as { account: ClientAccountProfileDto };
    assert.equal(body.account.status, "active");
    assert.equal(body.account.readyToOrder, true);
    await app.close();
  });
});

test("another tenant query cannot update a different stored account", async () => {
  await withPortalKey(async () => {
    const app = await buildApp(prismaWithPortalAccount({ clientAccountId: "acct_a" }));
    const res = await app.inject({
      method: "PATCH",
      url: `${PREFIX}/account?clientAccountId=acct_other`,
      headers: { [HEADER]: "portal-secret" },
      payload: { clientDisplayName: "Hijack" },
    });
    assert.equal(res.statusCode, 404);
    await app.close();
  });
});

test("GET /client/v1/account → 403 when portal is disabled", async () => {
  await withPortalKey(async () => {
    const app = await buildApp(prismaWithPortalAccount({ portalEnabled: false }));
    const res = await app.inject({
      method: "GET",
      url: `${PREFIX}/account?clientAccountId=acct_a`,
      headers: { [HEADER]: "portal-secret" },
    });
    assert.equal(res.statusCode, 403);
    await app.close();
  });
});
