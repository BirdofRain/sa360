import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";

import { PORTAL_PASSWORD_POLICY_COPY } from "@sa360/shared";

import { generatePublicClientAccountId } from "../lib/client-account-id.js";
import type { RateLimitConsume } from "../lib/redis-rate-limit.js";
import {
  PORTAL_REGISTER_GENERIC_ERROR,
  PORTAL_REGISTER_ORIGIN_DENIED,
  PORTAL_REGISTER_RATE_LIMITED,
  registerPublicPortalAccount,
} from "./portal-register.service.js";

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

function allowAll(): RateLimitConsume {
  return async () => ({ allowed: true });
}

function prismaStore(existing: AccountRow[] = []) {
  const store = [...existing];
  let createShouldFail: Error | null = null;
  return {
    store,
    failNextCreate(err: Error) {
      createShouldFail = err;
    },
    clientAccount: {
      findFirst: async ({
        where,
      }: {
        where?: { portalLoginEmail?: { equals?: string } };
      }) => {
        const email = where?.portalLoginEmail?.equals?.toLowerCase();
        return store.find((row) => row.portalLoginEmail?.toLowerCase() === email) ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (createShouldFail) {
          const err = createShouldFail;
          createShouldFail = null;
          throw err;
        }
        if (
          store.some(
            (row) =>
              row.portalLoginEmail &&
              row.portalLoginEmail.toLowerCase() === String(data.portalLoginEmail).toLowerCase()
          )
        ) {
          throw new Prisma.PrismaClientKnownRequestError("unique", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["portalLoginEmail"] },
          });
        }
        if (store.some((row) => row.clientAccountId === data.clientAccountId)) {
          throw new Prisma.PrismaClientKnownRequestError("unique", {
            code: "P2002",
            clientVersion: "test",
            meta: { target: ["clientAccountId"] },
          });
        }
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

const originOk = {
  origin: "http://localhost:3000",
  env: {} as NodeJS.ProcessEnv,
  consumeRateLimit: allowAll(),
};

test("creates an onboarding portal-enabled tenant with server id and no secrets in context", async () => {
  const db = prismaStore();
  const result = await registerPublicPortalAccount(
    {
      agencyName: "Hebda Insurance",
      email: "Agent@Example.COM",
      password: "secure-pass-word",
    },
    {
      ...originOk,
      db: db as never,
      generateId: () => generatePublicClientAccountId(Buffer.alloc(10, 2)),
      hashPassword: async () => "scrypt$n=16384$r=8$p=1$keylen=32$salt$hash",
    }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, "onboarding");
  assert.equal(result.context.portalEnabled, true);
  assert.equal(result.context.clientAccountId, "avl02020202020202020202");
  assert.equal(result.context.portalLoginEmail, "agent@example.com");
  assert.equal(result.context.hasPortalPassword, true);
  assert.equal(result.portalSessionEpoch, 0);
  assert.equal("portalPasswordHash" in result.context, false);
  assert.equal(db.store.length, 1);
  assert.equal(db.store[0]?.status, "onboarding");
  assert.equal(db.store[0]?.portalEnabled, true);
  assert.deepEqual(db.store[0]?.primaryNicheKeys, ["vet"]);
  assert.deepEqual(db.store[0]?.primaryProductTypes, []);
  assert.equal(db.store[0]?.notes, "Public registration (Aged Vet Leads)");
});

test("duplicate email uses generic copy and does not create a second row", async () => {
  const db = prismaStore([
    {
      clientAccountId: "acct_existing",
      clientDisplayName: "Existing",
      status: "active",
      portalEnabled: true,
      portalDisplayName: "Existing",
      portalLoginEmail: "agent@example.com",
      portalPasswordHash: "scrypt$hash",
      portalPasswordSetAt: new Date(),
      portalSessionEpoch: 1,
      primaryNicheKeys: ["vet"],
      primaryProductTypes: ["fe"],
      notes: null,
      ghlDestination: null,
    },
  ]);
  const result = await registerPublicPortalAccount(
    {
      agencyName: "Clone",
      email: "agent@example.com",
      password: "secure-pass-word",
    },
    { ...originOk, db: db as never }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, PORTAL_REGISTER_GENERIC_ERROR);
  assert.equal(result.code, "FAILED");
  assert.equal(db.store.length, 1);
  assert.equal(db.store[0]?.clientAccountId, "acct_existing");
});

test("invalid password returns policy copy and stores nothing", async () => {
  const db = prismaStore();
  const result = await registerPublicPortalAccount(
    { agencyName: "Hebda", email: "a@example.com", password: "short" },
    { ...originOk, db: db as never }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "PASSWORD_INVALID");
  assert.equal(result.error, PORTAL_PASSWORD_POLICY_COPY);
  assert.equal(db.store.length, 0);
});

test("rate limiting returns a generic throttle and does not insert", async () => {
  const db = prismaStore();
  const result = await registerPublicPortalAccount(
    { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" },
    {
      ...originOk,
      db: db as never,
      consumeRateLimit: async () => ({ allowed: false }),
    }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "THROTTLED");
  assert.equal(result.error, PORTAL_REGISTER_RATE_LIMITED);
  assert.equal(db.store.length, 0);
});

test("disallowed origin is rejected before create", async () => {
  const db = prismaStore();
  const result = await registerPublicPortalAccount(
    { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" },
    {
      origin: "https://evil.example",
      env: { SA360_PUBLIC_MARKETING_HOSTS: "preview.example" },
      consumeRateLimit: allowAll(),
      db: db as never,
    }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.code, "ORIGIN_DENIED");
  assert.equal(result.error, PORTAL_REGISTER_ORIGIN_DENIED);
  assert.equal(db.store.length, 0);
});

test("unsuccessful create after hash rolls back — no row", async () => {
  const db = prismaStore();
  db.failNextCreate(new Error("disk_full"));
  const result = await registerPublicPortalAccount(
    { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" },
    {
      ...originOk,
      db: db as never,
      hashPassword: async () => "scrypt$n=16384$r=8$p=1$keylen=32$salt$hash",
    }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.error, PORTAL_REGISTER_GENERIC_ERROR);
  assert.equal(db.store.length, 0);
});

test("register does not create admin, payment, or order fields", async () => {
  const db = prismaStore();
  const result = await registerPublicPortalAccount(
    { agencyName: "Hebda", email: "a@example.com", password: "secure-pass-word" },
    {
      ...originOk,
      db: db as never,
      hashPassword: async () => "scrypt$n=16384$r=8$p=1$keylen=32$salt$hash",
    }
  );
  assert.equal(result.ok, true);
  const row = db.store[0];
  assert.equal(row?.status, "onboarding");
  assert.equal("paymentConfirmationStatus" in (row ?? {}), false);
  assert.equal(row?.ghlDestination, null);
});
