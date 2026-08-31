import test from "node:test";
import assert from "node:assert/strict";
import { hashPortalPassword, verifyPortalPassword } from "../lib/portal-password.js";
import { generatePortalInviteToken, hashPortalInviteToken } from "../lib/portal-invite-token.js";
import { PORTAL_PASSWORD_POLICY_COPY } from "@sa360/shared";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import {
  authenticatePortalCustomerLogin,
  getPortalSessionAuthState,
} from "./portal-login.service.js";
import {
  acceptPortalInvite,
  inspectPortalInvite,
  issuePortalInvite,
  PORTAL_INVITE_INVALID,
} from "./portal-invite.service.js";

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

  const clientAccount = {
    findUnique: async ({
      where,
      select,
    }: {
      where: { clientAccountId?: string; portalInviteTokenHash?: string };
      select?: Record<string, boolean>;
    }) => {
      const found =
        store.find((a) =>
          where.clientAccountId
            ? a.clientAccountId === where.clientAccountId
            : where.portalInviteTokenHash
              ? a.portalInviteTokenHash === where.portalInviteTokenHash
              : false
        ) ?? null;
      if (!found) return null;
      if (select) {
        const out: Record<string, unknown> = {};
        for (const [k, on] of Object.entries(select)) {
          if (on) out[k] = (found as Record<string, unknown>)[k];
        }
        return out;
      }
      return { ...found };
    },
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
  };

  return {
    ...base,
    clientAccount,
    store,
  };
}

function assertNoSecrets(payload: unknown, secrets: string[]) {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `leaked ${secret}`);
  }
  assert.equal(serialized.includes("portalPasswordHash"), false);
  assert.equal(serialized.includes("portalInviteTokenHash"), false);
}

test("issuing an invite stores only the token hash, never the raw token", async () => {
  const db = prismaWithAccounts([row()]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const stored = db.store[0];
  assert.ok(stored.portalInviteTokenHash);
  assert.match(stored.portalInviteTokenHash ?? "", /^[0-9a-f]{64}$/);
  const rawFromUrl = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);
  assert.notEqual(stored.portalInviteTokenHash, rawFromUrl);
  assert.equal(stored.portalInviteTokenHash, hashPortalInviteToken(rawFromUrl));
  assert.equal(JSON.stringify(stored).includes(rawFromUrl), false);
  assertNoSecrets(issued, [rawFromUrl, stored.portalInviteTokenHash ?? ""]);
  assert.equal(issued.inviteUrl.includes(rawFromUrl), true);
  assert.equal(issued.inviteUrl.startsWith("/portal/invite/"), true);
  assert.ok(stored.portalInviteExpiresAt);
});

test("returned raw token can be used once; replay fails; invite fields clear; epoch +1", async () => {
  const db = prismaWithAccounts([row({ portalSessionEpoch: 2 })]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const rawToken = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);
  const password = "new-customer-pass";

  const first = await acceptPortalInvite(rawToken, password, { db: db as never });
  assert.equal(first.ok, true);
  assertNoSecrets(first, [rawToken, password, db.store[0].portalPasswordHash ?? ""]);

  const stored = db.store[0];
  assert.ok(stored.portalPasswordHash);
  assert.ok(stored.portalPasswordSetAt);
  assert.equal(stored.portalInviteTokenHash, null);
  assert.equal(stored.portalInviteExpiresAt, null);
  assert.equal(stored.portalSessionEpoch, 3);
  assert.equal(await verifyPortalPassword(password, stored.portalPasswordHash), true);

  const replay = await acceptPortalInvite(rawToken, password, { db: db as never });
  assert.equal(replay.ok, false);
  if (!replay.ok) {
    assert.equal(replay.code, "INVITE_INVALID");
    assert.equal(replay.error, PORTAL_INVITE_INVALID);
  }
  assert.equal(db.store[0].portalSessionEpoch, 3);
});

test("invalid token fails with generic invalid/expired copy", async () => {
  const db = prismaWithAccounts([row()]);
  const result = await acceptPortalInvite("not-a-real-invite-token-value-xxxx", "new-customer-pass", {
    db: db as never,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error, PORTAL_INVITE_INVALID);
    assert.equal(result.code, "INVITE_INVALID");
  }
  assert.equal(db.store[0].portalPasswordHash, null);
  assert.equal(db.store[0].portalSessionEpoch, 0);
});

test("expired token fails generically and does not set a password", async () => {
  const { rawToken, tokenHash } = generatePortalInviteToken();
  const db = prismaWithAccounts([
    row({
      portalInviteTokenHash: tokenHash,
      portalInviteExpiresAt: new Date("2026-01-01T00:00:00.000Z"),
    }),
  ]);
  const result = await acceptPortalInvite(rawToken, "new-customer-pass", {
    db: db as never,
    now: () => new Date("2026-01-02T00:00:00.000Z"),
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, PORTAL_INVITE_INVALID);
  assert.equal(db.store[0].portalPasswordHash, null);
  assert.equal(JSON.stringify(result).includes(rawToken), false);
});

test("reissue invalidates the previous outstanding invite", async () => {
  const db = prismaWithAccounts([row()]);
  const first = await issuePortalInvite("acct_a", { db: db as never });
  const second = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;
  const oldToken = first.inviteUrl.slice(first.inviteUrl.lastIndexOf("/") + 1);
  const newToken = second.inviteUrl.slice(second.inviteUrl.lastIndexOf("/") + 1);
  assert.notEqual(oldToken, newToken);
  assert.equal(db.store[0].portalInviteTokenHash, hashPortalInviteToken(newToken));

  const oldAccept = await acceptPortalInvite(oldToken, "new-customer-pass", { db: db as never });
  assert.equal(oldAccept.ok, false);
  if (!oldAccept.ok) assert.equal(oldAccept.error, PORTAL_INVITE_INVALID);

  const newAccept = await acceptPortalInvite(newToken, "new-customer-pass", { db: db as never });
  assert.equal(newAccept.ok, true);
});

test("invite for Customer A cannot modify Customer B", async () => {
  const db = prismaWithAccounts([
    row(),
    row({
      clientAccountId: "acct_b",
      portalLoginEmail: "b@example.com",
      clientDisplayName: "Client B",
      portalSessionEpoch: 7,
    }),
  ]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const rawToken = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);
  const accepted = await acceptPortalInvite(rawToken, "new-customer-pass", { db: db as never });
  assert.equal(accepted.ok, true);
  const a = db.store.find((s) => s.clientAccountId === "acct_a");
  const b = db.store.find((s) => s.clientAccountId === "acct_b");
  assert.ok(a?.portalPasswordHash);
  assert.equal(a?.portalSessionEpoch, 1);
  assert.equal(b?.portalPasswordHash, null);
  assert.equal(b?.portalSessionEpoch, 7);
  assert.equal(b?.portalInviteTokenHash, null);
});

test("disabled portal cannot issue or accept an invite", async () => {
  const { rawToken, tokenHash } = generatePortalInviteToken();
  const db = prismaWithAccounts([
    row({
      portalEnabled: false,
      portalInviteTokenHash: tokenHash,
      portalInviteExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
    }),
  ]);
  const issued = await issuePortalInvite("acct_a", {
    db: db as never,
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.equal(issued.ok, false);
  if (!issued.ok) assert.equal(issued.code, "PORTAL_DISABLED");

  const accepted = await acceptPortalInvite(rawToken, "new-customer-pass", {
    db: db as never,
    now: () => new Date("2026-08-01T00:00:00.000Z"),
  });
  assert.equal(accepted.ok, false);
  if (!accepted.ok) {
    assert.equal(accepted.code, "INVITE_INVALID");
    assert.equal(accepted.error, PORTAL_INVITE_INVALID);
  }
  assert.equal(db.store[0].portalPasswordHash, null);
});

test("missing portalLoginEmail prevents issuance", async () => {
  const db = prismaWithAccounts([row({ portalLoginEmail: null })]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, false);
  if (!issued.ok) assert.equal(issued.code, "MISSING_PORTAL_LOGIN_EMAIL");
  assert.equal(db.store[0].portalInviteTokenHash, null);
});

test("invalid portalLoginEmail prevents issuance", async () => {
  const db = prismaWithAccounts([row({ portalLoginEmail: "not-an-email" })]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, false);
  if (!issued.ok) assert.equal(issued.code, "MISSING_PORTAL_LOGIN_EMAIL");
});

test("successful acceptance authenticates the new password and rejects the env fallback", async () => {
  const prev = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const db = prismaWithAccounts([row({ portalSessionEpoch: 0 })]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const rawToken = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);
  const password = "converted-customer-pw";
  const accepted = await acceptPortalInvite(rawToken, password, { db: db as never });
  assert.equal(accepted.ok, true);

  const customerOk = await authenticatePortalCustomerLogin("a@example.com", password, {
    db: db as never,
  });
  assert.equal(customerOk.ok, true);
  if (customerOk.ok) {
    assert.equal(customerOk.passwordCheck, "customer");
    assert.equal(customerOk.portalSessionEpoch, 1);
  }

  const envFail = await authenticatePortalCustomerLogin("a@example.com", "shared-env-pass", {
    db: db as never,
  });
  assert.equal(envFail.ok, false);

  const unconverted = prismaWithAccounts([
    row({ clientAccountId: "acct_unconverted", portalLoginEmail: "open@example.com" }),
  ]);
  const fallback = await authenticatePortalCustomerLogin("open@example.com", "shared-env-pass", {
    db: unconverted as never,
  });
  assert.equal(fallback.ok, true);
  if (fallback.ok) assert.equal(fallback.passwordCheck, "env_fallback");

  if (prev !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prev;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("old pre-conversion session epoch is rejected after acceptance", async () => {
  const db = prismaWithAccounts([row({ portalSessionEpoch: 0 })]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const rawToken = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);
  await acceptPortalInvite(rawToken, "new-customer-pass", { db: db as never });
  const state = await getPortalSessionAuthState("acct_a", { db: db as never });
  assert.equal(state?.portalSessionEpoch, 1);
  assert.notEqual(0, state?.portalSessionEpoch);
});

test("password length validation fails safely without leaking the password", async () => {
  const db = prismaWithAccounts([row()]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const rawToken = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);

  const tooShort = await acceptPortalInvite(rawToken, "short", { db: db as never });
  assert.equal(tooShort.ok, false);
  if (!tooShort.ok) {
    assert.equal(tooShort.code, "PASSWORD_INVALID");
    assert.equal(tooShort.error, PORTAL_PASSWORD_POLICY_COPY);
    assert.equal(tooShort.error.includes("short"), false);
  }
  assert.equal(JSON.stringify(tooShort).includes("short"), false);
  assert.equal(db.store[0].portalPasswordHash, null);

  const tooLong = await acceptPortalInvite(rawToken, "x".repeat(129), { db: db as never });
  assert.equal(tooLong.ok, false);
  if (!tooLong.ok) assert.equal(tooLong.code, "PASSWORD_INVALID");
  assert.equal(db.store[0].portalInviteTokenHash, hashPortalInviteToken(rawToken));
});

test("already-used invite inspects and accepts as generic invalid", async () => {
  const db = prismaWithAccounts([row()]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (!issued.ok) return;
  const rawToken = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);
  assert.equal((await inspectPortalInvite(rawToken, { db: db as never })).ok, true);
  await acceptPortalInvite(rawToken, "new-customer-pass", { db: db as never });
  const inspect = await inspectPortalInvite(rawToken, { db: db as never });
  assert.equal(inspect.ok, false);
  if (!inspect.ok) assert.equal(inspect.error, PORTAL_INVITE_INVALID);
});

test("accept function does not take clientAccountId so it cannot retarget tenants", async () => {
  assert.equal(acceptPortalInvite.length, 2);
});

test("issue result omits hashes, env password, and session secrets", async () => {
  const prev = process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
  process.env.CLIENT_PORTAL_LOGIN_PASSWORD = "shared-env-pass";
  const db = prismaWithAccounts([row()]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  assertNoSecrets(issued, ["shared-env-pass", db.store[0].portalInviteTokenHash ?? ""]);
  if (prev !== undefined) process.env.CLIENT_PORTAL_LOGIN_PASSWORD = prev;
  else delete process.env.CLIENT_PORTAL_LOGIN_PASSWORD;
});

test("issue uses existing public base URL env and does not invent a hostname", async () => {
  const prevP = process.env.SA360_PORTAL_PUBLIC_BASE_URL;
  process.env.SA360_PORTAL_PUBLIC_BASE_URL = "https://portal.test.example/";
  const db = prismaWithAccounts([row()]);
  const issued = await issuePortalInvite("acct_a", { db: db as never });
  assert.equal(issued.ok, true);
  if (issued.ok) {
    assert.equal(issued.inviteUrl.startsWith("https://portal.test.example/portal/invite/"), true);
    assert.equal(issued.inviteUrl.includes("sa360.com"), false);
  }
  if (prevP !== undefined) process.env.SA360_PORTAL_PUBLIC_BASE_URL = prevP;
  else delete process.env.SA360_PORTAL_PUBLIC_BASE_URL;
});
