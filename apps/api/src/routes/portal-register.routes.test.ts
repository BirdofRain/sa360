import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { CLIENT_PORTAL_KEY_HEADER } from "../lib/client-portal-auth.js";
import { generatePublicClientAccountId } from "../lib/client-account-id.js";
import type { RateLimitConsume } from "../lib/redis-rate-limit.js";
import { portalRegisterBodySchema } from "../schemas/portal-register.schema.js";
import { PORTAL_REGISTER_GENERIC_ERROR } from "../services/portal-register.service.js";
import { clientPortalRoutes } from "./client-portal.js";

const PREFIX = "/client/v1";
const HEADER = CLIENT_PORTAL_KEY_HEADER;

type AccountRow = {
  clientAccountId: string;
  clientDisplayName: string;
  status: string;
  portalEnabled: boolean;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
  portalPasswordHash: string | null;
  portalPasswordSetAt: Date | null;
  portalSessionEpoch: number;
  primaryNicheKeys: unknown;
  primaryProductTypes: unknown;
  notes: string | null;
  ghlDestination: null;
};

function prismaWithCreate(existing: AccountRow[] = []) {
  const store = [...existing];
  return {
    store,
    clientAccount: {
      findFirst: async ({
        where,
      }: {
        where?: { portalLoginEmail?: { equals?: string } };
      }) => {
        const email = where?.portalLoginEmail?.equals?.toLowerCase();
        return store.find((row) => row.portalLoginEmail?.toLowerCase() === email) ?? null;
      },
      findUnique: async ({ where }: { where: { clientAccountId?: string } }) =>
        store.find((row) => row.clientAccountId === where.clientAccountId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row: AccountRow = {
          clientAccountId: String(data.clientAccountId),
          clientDisplayName: String(data.clientDisplayName),
          status: String(data.status),
          portalEnabled: Boolean(data.portalEnabled),
          portalDisplayName: (data.portalDisplayName as string | null) ?? null,
          portalLoginEmail: (data.portalLoginEmail as string | null) ?? null,
          portalPasswordHash: (data.portalPasswordHash as string | null) ?? null,
          portalPasswordSetAt: (data.portalPasswordSetAt as Date | null) ?? null,
          portalSessionEpoch: Number(data.portalSessionEpoch ?? 0),
          primaryNicheKeys: data.primaryNicheKeys,
          primaryProductTypes: data.primaryProductTypes,
          notes: (data.notes as string | null) ?? null,
          ghlDestination: null,
        };
        store.push(row);
        return { ...row };
      },
    },
  };
}

async function buildApp(
  prisma: ReturnType<typeof prismaWithCreate>,
  extras?: {
    consumeRateLimit?: RateLimitConsume;
    origin?: string | null;
  }
) {
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: prisma as never },
    registerDeps: {
      db: prisma as never,
      consumeRateLimit: extras?.consumeRateLimit ?? (async () => ({ allowed: true })),
      origin: extras?.origin === undefined ? "http://localhost:3000" : extras.origin,
      hashPassword: async () => "scrypt$n=16384$r=8$p=1$keylen=32$salt$hash",
      generateId: () => generatePublicClientAccountId(Buffer.alloc(10, 3)),
    },
  });
  return app;
}

test("portalRegisterBodySchema rejects browser-supplied ids and payment fields", () => {
  const parsed = portalRegisterBodySchema.safeParse({
    agencyName: "Hebda",
    email: "a@example.com",
    password: "secure-pass-word",
    clientAccountId: "evil_id",
    status: "active",
  });
  assert.equal(parsed.success, false);
});

test("POST /client/v1/portal-register → 401 without portal key", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const app = await buildApp(prismaWithCreate());
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    payload: { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-register creates onboarding tenant and omits secrets", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithCreate();
  const app = await buildApp(prisma);
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    headers: { [HEADER]: "portal-secret" },
    payload: { agencyName: "Hebda Insurance", email: "A@Example.com", password: "secure-pass-word" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json() as {
    ok: boolean;
    status: string;
    portalSessionEpoch: number;
    context: Record<string, unknown>;
  };
  assert.equal(body.ok, true);
  assert.equal(body.status, "onboarding");
  assert.equal(body.context.portalEnabled, true);
  assert.equal(body.context.clientAccountId, "avl03030303030303030303");
  assert.equal(body.context.portalLoginEmail, "a@example.com");
  assert.equal("portalPasswordHash" in body.context, false);
  assert.equal("portalInviteTokenHash" in body.context, false);
  assert.equal(prisma.store[0]?.status, "onboarding");
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-register duplicate email is non-enumerating", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithCreate();
  const app = await buildApp(prisma);
  const headers = { [HEADER]: "portal-secret" };
  const payload = { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" };
  const first = await app.inject({ method: "POST", url: `${PREFIX}/portal-register`, headers, payload });
  const second = await app.inject({ method: "POST", url: `${PREFIX}/portal-register`, headers, payload });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 400);
  const body = second.json() as { error: string; code: string };
  assert.equal(body.error, PORTAL_REGISTER_GENERIC_ERROR);
  assert.equal(body.error.toLowerCase().includes("email"), false);
  assert.equal(prisma.store.length, 1);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-register rate limit is 429", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithCreate();
  const app = await buildApp(prisma, { consumeRateLimit: async () => ({ allowed: false }) });
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    headers: { [HEADER]: "portal-secret" },
    payload: { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" },
  });
  assert.equal(res.statusCode, 429);
  assert.equal(prisma.store.length, 0);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-register extra keys and invalid email are 400 with no row", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithCreate();
  const app = await buildApp(prisma);
  const headers = { [HEADER]: "portal-secret" };
  const extra = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    headers,
    payload: {
      agencyName: "Hebda",
      email: "a@example.com",
      password: "secure-pass-word",
      clientAccountId: "evil_id",
      status: "active",
    },
  });
  const invalid = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    headers,
    payload: { agencyName: "H", email: "not-an-email", password: "x" },
  });
  assert.equal(extra.statusCode, 400);
  assert.equal(invalid.statusCode, 400);
  assert.equal(prisma.store.length, 0);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-register disallowed origin is 403 with no row", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithCreate();
  const app = await buildApp(prisma, { origin: "https://evil.example" });
  const res = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    headers: { [HEADER]: "portal-secret" },
    payload: { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(prisma.store.length, 0);
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});

test("POST /client/v1/portal-register tenant ids stay isolated across two accounts", async () => {
  const prev = process.env.CLIENT_PORTAL_API_KEY;
  process.env.CLIENT_PORTAL_API_KEY = "portal-secret";
  const prisma = prismaWithCreate();
  let n = 0;
  const app = Fastify({ logger: false });
  await app.register(clientPortalRoutes, {
    prefix: PREFIX,
    tenantDeps: { db: prisma as never },
    registerDeps: {
      db: prisma as never,
      origin: "http://localhost:3000",
      consumeRateLimit: async () => ({ allowed: true }),
      hashPassword: async () => "scrypt$n=16384$r=8$p=1$keylen=32$salt$hash",
      generateId: () => generatePublicClientAccountId(Buffer.alloc(10, ++n)),
    },
  });
  const headers = { [HEADER]: "portal-secret" };
  const a = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    headers,
    payload: { agencyName: "A Agency", email: "a@example.com", password: "secure-pass-word" },
  });
  const b = await app.inject({
    method: "POST",
    url: `${PREFIX}/portal-register`,
    headers,
    payload: { agencyName: "B Agency", email: "b@example.com", password: "other-pass-word" },
  });
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  const idA = (a.json() as { context: { clientAccountId: string } }).context.clientAccountId;
  const idB = (b.json() as { context: { clientAccountId: string } }).context.clientAccountId;
  assert.notEqual(idA, idB);
  assert.equal(prisma.store.length, 2);
  assert.equal(
    prisma.store.find((row) => row.clientAccountId === idA)?.portalLoginEmail,
    "a@example.com"
  );
  assert.equal(
    prisma.store.find((row) => row.clientAccountId === idB)?.portalLoginEmail,
    "b@example.com"
  );
  await app.close();
  if (prev !== undefined) process.env.CLIENT_PORTAL_API_KEY = prev;
  else delete process.env.CLIENT_PORTAL_API_KEY;
});
