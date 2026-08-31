import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { generatePortalInviteToken, hashPortalInviteToken } from "../lib/portal-invite-token.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { clientPortalRoutes } from "./client-portal.js";
import { adminClientsRoutes } from "./admin-clients.js";
import { portalInviteAcceptBodySchema } from "../schemas/portal-invite.schema.js";
import { PORTAL_INVITE_INVALID } from "../services/portal-invite.service.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;
const ADMIN_HEADER = "x-sa360-admin-key";

type AccountRow = {
  clientAccountId: string;
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  portalEnabled: boolean;
  portalPasswordHash: string | null;
  portalPasswordSetAt: Date | null;
  portalSessionEpoch: number;
  portalInviteTokenHash: string | null;
  portalInviteExpiresAt: Date | null;
  primaryNicheKeys: string[];
  primaryProductTypes: string[];
  ghlDestination: null;
};

function row(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    clientAccountId: "acct_a",
    clientDisplayName: "Client A",
    portalDisplayName: "Portal A",
    portalLoginEmail: "a@example.com",
    portalEnabled: true,
    portalPasswordHash: null,
    portalPasswordSetAt: null,
    portalSessionEpoch: 0,
    portalInviteTokenHash: null,
    portalInviteExpiresAt: null,
    primaryNicheKeys: [],
    primaryProductTypes: [],
    ghlDestination: null,
    ...overrides,
  };
}

function prismaWithAccounts(accounts: AccountRow[]) {
  const store = accounts.map((a) => ({ ...a }));
  const base = createEmptyPrismaMock();

  function matchWhere(where: Record<string, unknown>, item: AccountRow): boolean {
    if (typeof where.clientAccountId === "string" && item.clientAccountId !== where.clientAccountId) {
      return false;
    }
    if (
      typeof where.portalInviteTokenHash === "string" &&
      item.portalInviteTokenHash !== where.portalInviteTokenHash
    ) {
      return false;
    }
    if (where.portalEnabled === true && item.portalEnabled !== true) return false;
    const expires = where.portalInviteExpiresAt as { gt?: Date } | undefined;
    if (expires?.gt) {
      if (!item.portalInviteExpiresAt || item.portalInviteExpiresAt.getTime() <= expires.gt.getTime()) {
        return false;
      }
    }
    return true;
  }

  function applyData(item: AccountRow, data: Record<string, unknown>) {
    for (const [key, value] of Object.entries(data)) {
      if (key === "portalSessionEpoch" && value && typeof value === "object" && "increment" in value) {
        item.portalSessionEpoch += Number((value as { increment: number }).increment);
        continue;
      }
      (item as Record<string, unknown>)[key] = value;
    }
  }

  return {
    ...base,
    store,
    clientAccount: {
      findUnique: async ({
        where,
      }: {
        where: { clientAccountId?: string; portalInviteTokenHash?: string };
      }) =>
        store.find((a) =>
          where.clientAccountId
            ? a.clientAccountId === where.clientAccountId
            : where.portalInviteTokenHash
              ? a.portalInviteTokenHash === where.portalInviteTokenHash
              : false
        ) ?? null,
      findFirst: async ({
        where,
      }: {
        where?: { portalLoginEmail?: { equals?: string } };
      }) => {
        const email = where?.portalLoginEmail?.equals?.toLowerCase();
        return store.find((a) => a.portalLoginEmail?.toLowerCase() === email) ?? null;
      },
      update: async ({
        where,
        data,
      }: {
        where: { clientAccountId: string };
        data: Record<string, unknown>;
      }) => {
        const found = store.find((a) => a.clientAccountId === where.clientAccountId);
        if (!found) throw new Error("not_found");
        applyData(found, data);
        return { ...found };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const item of store) {
          if (!matchWhere(where, item)) continue;
          applyData(item, data);
          count += 1;
        }
        return { count };
      },
    },
  };
}

async function buildPortalApp(prisma: ReturnType<typeof prismaWithAccounts>) {
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: prisma as never },
  });
  return app;
}

test("POST /client/v1/portal-invite/accept → 401 without portal key", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildPortalApp(prismaWithAccounts([row()]));
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-invite/accept`,
    payload: { token: "a".repeat(43), password: "new-customer-pass" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-invite/accept rejects clientAccountId retarget and extra fields", async () => {
  const parsed = portalInviteAcceptBodySchema.safeParse({
    token: "a".repeat(43),
    password: "new-customer-pass",
    clientAccountId: "acct_b",
  });
  assert.equal(parsed.success, false);

  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const { rawToken, tokenHash } = generatePortalInviteToken();
  const prisma = prismaWithAccounts([
    row({
      portalInviteTokenHash: tokenHash,
      portalInviteExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    }),
    row({
      clientAccountId: "acct_b",
      portalLoginEmail: "b@example.com",
      portalSessionEpoch: 4,
    }),
  ]);
  const app = await buildPortalApp(prisma);
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-invite/accept`,
    headers: { [HEADER]: "portal-secret", "content-type": "application/json" },
    payload: {
      token: rawToken,
      password: "new-customer-pass",
      clientAccountId: "acct_b",
    },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "Invalid body");
  assert.equal(prisma.store.find((s) => s.clientAccountId === "acct_b")?.portalPasswordHash, null);
  assert.equal(prisma.store.find((s) => s.clientAccountId === "acct_a")?.portalPasswordHash, null);
  assert.equal(res.body.includes(rawToken), false);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-invite/accept succeeds once and omits secrets", async () => {
  const prevK = process.env.CLIENT_PORTAL_API_KEY;
  const prevP = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const { rawToken, tokenHash } = generatePortalInviteToken();
  const prisma = prismaWithAccounts([
    row({
      portalInviteTokenHash: tokenHash,
      portalInviteExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    }),
  ]);
  const app = await buildPortalApp(prisma);
  const password = "new-customer-pass";
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-invite/accept`,
    headers: { [HEADER]: "portal-secret", "content-type": "application/json" },
    payload: { token: rawToken, password },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as Record<string, unknown>;
  assert.equal(body.ok, true);
  assert.equal("portalPasswordHash" in body, false);
  assert.equal("portalInviteTokenHash" in body, false);
  assert.equal("inviteUrl" in body, false);
  assert.equal(res.body.includes(rawToken), false);
  assert.equal(res.body.includes(password), false);
  assert.equal(res.body.includes("shared-env-pass"), false);
  assert.equal(res.body.includes(tokenHash), false);
  assert.ok(prisma.store[0].portalPasswordHash);
  assert.equal(prisma.store[0].portalInviteTokenHash, null);
  assert.equal(prisma.store[0].portalSessionEpoch, 1);

  const replay = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-invite/accept`,
    headers: { [HEADER]: "portal-secret", "content-type": "application/json" },
    payload: { token: rawToken, password },
  });
  assert.equal(replay.statusCode, 400);
  assert.equal(replay.json().error, PORTAL_INVITE_INVALID);
  assert.equal(replay.body.includes(rawToken), false);

  await app.close();
  if (prevK !== undefined) process.env.CLIENT_PORTAL_API_KEY = prevK;
  else delete process.env.CLIENT_PORTAL_API_KEY;
  if (prevP !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prevP;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("POST /client/v1/portal-invite/inspect is generic for unknown tokens", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildPortalApp(prismaWithAccounts([row()]));
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-invite/inspect`,
    headers: { [HEADER]: "portal-secret", "content-type": "application/json" },
    payload: { token: "b".repeat(43) },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, PORTAL_INVITE_INVALID);
  assert.equal(res.body.includes("acct_a"), false);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /admin/v1/clients/:id/portal-invite → 401 without admin key", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const app = Fastify({ logger: false });
  await app.register(adminClientsRoutes, { prefix: "/admin/v1" });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/acct_a/portal-invite",
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});

test("POST /admin/v1/clients/:id/portal-invite returns inviteUrl and omits hashes", async () => {
  const prev = process.env.ADMIN_API_KEY;
  process.env.ADMIN_API_KEY = "admin-secret";
  const prisma = prismaWithAccounts([row()]);
  const app = Fastify({ logger: false });
  await app.register(adminClientsRoutes, {
    prefix: "/admin/v1",
    inviteDeps: { db: prisma as never },
  });
  const res = await app.inject({
    method: "POST",
    url: "/admin/v1/clients/acct_a/portal-invite",
    headers: { [ADMIN_HEADER]: "admin-secret" },
  });
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json() as { ok: boolean; inviteUrl: string; expiresAt: string };
  assert.equal(body.ok, true);
  assert.equal(body.inviteUrl.startsWith("/portal/invite/"), true);
  const rawToken = body.inviteUrl.slice(body.inviteUrl.lastIndexOf("/") + 1);
  assert.equal(prisma.store[0].portalInviteTokenHash, hashPortalInviteToken(rawToken));
  assert.equal(res.body.includes(prisma.store[0].portalInviteTokenHash ?? "nope"), false);
  assert.equal("portalPasswordHash" in body, false);
  assert.equal("portalInviteTokenHash" in body, false);
  await app.close();
  if (prev !== undefined) process.env.ADMIN_API_KEY = prev;
  else delete process.env.ADMIN_API_KEY;
});
