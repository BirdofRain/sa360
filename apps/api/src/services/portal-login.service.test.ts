import test from "node:test";
import assert from "node:assert/strict";
import { hashPortalPassword } from "../lib/portal-password.js";
import {
  authenticatePortalCustomerLogin,
  getPortalSessionAuthState,
  PORTAL_LOGIN_DISABLED,
  PORTAL_LOGIN_INVALID_CREDENTIALS,
} from "./portal-login.service.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";

type AccountRow = {
  clientAccountId: string;
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string;
  portalEnabled: boolean;
  portalPasswordHash: string | null;
  portalPasswordSetAt: Date | null;
  portalSessionEpoch: number;
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
    primaryNicheKeys: [],
    primaryProductTypes: [],
    ghlDestination: null,
    ...overrides,
  };
}

function prismaWithAccounts(accounts: AccountRow[]) {
  const byId = new Map(accounts.map((a) => [a.clientAccountId, a]));
  const byEmail = new Map(accounts.map((a) => [a.portalLoginEmail.toLowerCase(), a]));
  const base = createEmptyPrismaMock();
  return {
    ...base,
    clientAccount: {
      findUnique: async ({ where }: { where: { clientAccountId?: string } }) =>
        (where.clientAccountId ? byId.get(where.clientAccountId) : null) ?? null,
      findFirst: async ({
        where,
      }: {
        where?: { portalLoginEmail?: { equals?: string } };
      }) => {
        const email = where?.portalLoginEmail?.equals?.toLowerCase();
        return (email ? byEmail.get(email) : null) ?? null;
      },
    },
  };
}

function assertNoSecrets(payload: unknown, secrets: string[]) {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(serialized.includes("portalPasswordHash"), false);
}

test("null-hash customer: env password still works", async () => {
  const prev = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const result = await authenticatePortalCustomerLogin(
    "a@example.com",
    "shared-env-pass",
    { db: prismaWithAccounts([row()]) as never }
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.passwordCheck, "env_fallback");
    assert.equal(result.portalSessionEpoch, 0);
    assert.equal(result.context.hasPortalPassword, false);
  }
  assertNoSecrets(result, ["shared-env-pass"]);
  if (prev !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prev;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("customer with password hash: correct customer password works", async () => {
  const prev = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const customerPassword = "acct-a-unique-pass";
  const hash = await hashPortalPassword(customerPassword);
  const result = await authenticatePortalCustomerLogin("a@example.com", customerPassword, {
    db: prismaWithAccounts([row({ portalPasswordHash: hash, portalSessionEpoch: 3 })]) as never,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.passwordCheck, "customer");
    assert.equal(result.portalSessionEpoch, 3);
    assert.equal(result.context.hasPortalPassword, true);
    assert.equal(result.context.clientAccountId, "acct_a");
  }
  assertNoSecrets(result, [customerPassword, "shared-env-pass", hash]);
  if (prev !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prev;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("customer with password hash: global env password FAILS", async () => {
  const prev = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const hash = await hashPortalPassword("acct-a-unique-pass");
  const result = await authenticatePortalCustomerLogin("a@example.com", "shared-env-pass", {
    db: prismaWithAccounts([row({ portalPasswordHash: hash })]) as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "INVALID");
    assert.equal(result.error, PORTAL_LOGIN_INVALID_CREDENTIALS);
  }
  assertNoSecrets(result, ["shared-env-pass", hash, "acct-a-unique-pass"]);
  if (prev !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prev;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("Customer A password cannot authenticate Customer B", async () => {
  const passA = "alpha-customer-pass";
  const passB = "bravo-customer-pass";
  const hashA = await hashPortalPassword(passA);
  const hashB = await hashPortalPassword(passB);
  const db = prismaWithAccounts([
    row({
      clientAccountId: "acct_a",
      portalLoginEmail: "a@example.com",
      portalPasswordHash: hashA,
    }),
    row({
      clientAccountId: "acct_b",
      portalLoginEmail: "b@example.com",
      portalPasswordHash: hashB,
      clientDisplayName: "Client B",
    }),
  ]);
  const asB = await authenticatePortalCustomerLogin("b@example.com", passA, { db: db as never });
  assert.equal(asB.ok, false);
  if (!asB.ok) assert.equal(asB.error, PORTAL_LOGIN_INVALID_CREDENTIALS);

  const asA = await authenticatePortalCustomerLogin("a@example.com", passB, { db: db as never });
  assert.equal(asA.ok, false);

  const okA = await authenticatePortalCustomerLogin("a@example.com", passA, { db: db as never });
  assert.equal(okA.ok, true);
  if (okA.ok) assert.equal(okA.context.clientAccountId, "acct_a");
});

test("wrong password returns generic invalid-credential response", async () => {
  const prev = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const result = await authenticatePortalCustomerLogin("a@example.com", "nope", {
    db: prismaWithAccounts([row()]) as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, PORTAL_LOGIN_INVALID_CREDENTIALS);
    assert.equal(result.code, "INVALID");
  }
  if (prev !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prev;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("malformed stored hash fails closed", async () => {
  const prev = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const result = await authenticatePortalCustomerLogin("a@example.com", "shared-env-pass", {
    db: prismaWithAccounts([row({ portalPasswordHash: "sha256$not-a-real-hash" })]) as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "INVALID");
  if (prev !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prev;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("disabled portal remains inaccessible after a correct customer password", async () => {
  const customerPassword = "acct-a-unique-pass";
  const hash = await hashPortalPassword(customerPassword);
  const result = await authenticatePortalCustomerLogin("a@example.com", customerPassword, {
    db: prismaWithAccounts([row({ portalPasswordHash: hash, portalEnabled: false })]) as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "PORTAL_DISABLED");
    assert.equal(result.error, PORTAL_LOGIN_DISABLED);
  }
});

test("unknown email is not found (generic, no hash leak)", async () => {
  const result = await authenticatePortalCustomerLogin("missing@example.com", "whatever", {
    db: prismaWithAccounts([]) as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "NOT_FOUND");
    assert.equal(result.error, PORTAL_LOGIN_INVALID_CREDENTIALS);
  }
  assertNoSecrets(result, ["whatever"]);
});

test("getPortalSessionAuthState returns epoch without hash fields", async () => {
  const hash = await hashPortalPassword("acct-a-unique-pass");
  const state = await getPortalSessionAuthState("acct_a", {
    db: prismaWithAccounts([
      row({ portalPasswordHash: hash, portalSessionEpoch: 4, portalEnabled: true }),
    ]) as never,
  });
  assert.ok(state);
  assert.equal(state?.portalSessionEpoch, 4);
  assert.equal(state?.portalEnabled, true);
  assertNoSecrets(state, [hash, "acct-a-unique-pass"]);
});
