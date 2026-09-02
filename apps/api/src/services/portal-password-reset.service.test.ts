import test from "node:test";
import assert from "node:assert/strict";
import { PORTAL_PASSWORD_RESET_GENERIC_SUCCESS } from "@sa360/shared";
import { hashPortalPassword, verifyPortalPassword } from "../lib/portal-password.js";
import {
  generatePortalInviteToken,
  hashPortalInviteToken,
  PORTAL_PASSWORD_RESET_TTL_MS,
} from "../lib/portal-invite-token.js";
import { createEmptyPrismaMock } from "../test/empty-prisma-mock.js";
import { authenticatePortalCustomerLogin } from "./portal-login.service.js";
import { acceptPortalInvite, issuePortalInvite } from "./portal-invite.service.js";
import {
  canDeliverPortalPasswordResetEmail,
  isEligibleForSelfServicePortalReset,
  PORTAL_PASSWORD_RESET_EMAIL_LIMIT,
  PORTAL_PASSWORD_RESET_GENERIC,
  requestPortalPasswordReset,
} from "./portal-password-reset.service.js";
import type { SendTransactionalEmailInput } from "../lib/transactional-email.js";
import type { RateLimitConsume } from "../lib/redis-rate-limit.js";

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

function unlimitedLimiter(): RateLimitConsume {
  return async () => ({ allowed: true });
}

function countingLimiter(limit: number): RateLimitConsume & { counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const consume: RateLimitConsume = async (bucket) => {
    const n = (counts.get(bucket) ?? 0) + 1;
    counts.set(bucket, n);
    return { allowed: n <= limit };
  };
  return Object.assign(consume, { counts });
}

function captureSend() {
  const sent: SendTransactionalEmailInput[] = [];
  return {
    sent,
    sendEmail: async (input: SendTransactionalEmailInput) => {
      sent.push(input);
      return { ok: true as const, id: "email_test" };
    },
  };
}

async function convertedRow(overrides: Partial<AccountRow> = {}): Promise<AccountRow> {
  return row({
    portalPasswordHash: await hashPortalPassword("current-customer-pw"),
    portalPasswordSetAt: new Date("2026-08-01T00:00:00.000Z"),
    portalSessionEpoch: 1,
    ...overrides,
  });
}

async function withPublicUrl<T>(fn: () => Promise<T> | T): Promise<T> {
  const prev = process.env.SA360_PORTAL_PUBLIC_BASE_URL;
  process.env.SA360_PORTAL_PUBLIC_BASE_URL = "https://portal.example.test";
  try {
    return await fn();
  } finally {
    if (prev !== undefined) process.env.SA360_PORTAL_PUBLIC_BASE_URL = prev;
    else delete process.env.SA360_PORTAL_PUBLIC_BASE_URL;
  }
}

test("eligibility requires enabled portal, matching email, and an existing password hash", async () => {
  assert.equal(
    isEligibleForSelfServicePortalReset({
      portalEnabled: true,
      portalLoginEmail: "a@example.com",
      portalPasswordHash: "scrypt$n=1",
    }),
    true
  );
  assert.equal(
    isEligibleForSelfServicePortalReset({
      portalEnabled: true,
      portalLoginEmail: "a@example.com",
      portalPasswordHash: null,
    }),
    false
  );
  assert.equal(
    isEligibleForSelfServicePortalReset({
      portalEnabled: false,
      portalLoginEmail: "a@example.com",
      portalPasswordHash: "scrypt$n=1",
    }),
    false
  );
});

test("unknown email, unconverted, and disabled accounts return the same generic success and issue nothing", async () => {
  await withPublicUrl(async () => {
    const hash = await hashPortalPassword("current-customer-pw");
    const db = prismaWithAccounts([
      row(),
      row({
        clientAccountId: "acct_disabled",
        portalLoginEmail: "disabled@example.com",
        portalEnabled: false,
        portalPasswordHash: hash,
        portalSessionEpoch: 3,
      }),
    ]);
    const capture = captureSend();
    const limiter = unlimitedLimiter();

    const unknown = await requestPortalPasswordReset("missing@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: limiter,
      clientIp: "203.0.113.10",
    });
    const unconverted = await requestPortalPasswordReset("a@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: limiter,
      clientIp: "203.0.113.10",
    });
    const disabled = await requestPortalPasswordReset("disabled@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: limiter,
      clientIp: "203.0.113.10",
    });

    for (const result of [unknown, unconverted, disabled]) {
      assert.equal(result.ok, true);
      assert.equal(result.message, PORTAL_PASSWORD_RESET_GENERIC_SUCCESS);
      assert.equal(result.outcome, "ineligible");
      assert.equal(JSON.stringify(result).includes("acct_"), false);
    }
    assert.equal(unknown.message, unconverted.message);
    assert.equal(unconverted.message, disabled.message);
    assert.equal(capture.sent.length, 0);
    assert.equal(db.store[0].portalInviteTokenHash, null);
    assert.equal(db.store[1].portalInviteTokenHash, null);
  });
});

test("converted eligible account issues a hashed 60-minute token and one safe reset email", async () => {
  await withPublicUrl(async () => {
    const db = prismaWithAccounts([await convertedRow({ portalSessionEpoch: 1 })]);
    const capture = captureSend();
    const now = new Date("2026-09-02T12:00:00.000Z");
    const result = await requestPortalPasswordReset("A@Example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: unlimitedLimiter(),
      clientIp: "203.0.113.10",
      now: () => now,
    });
    assert.equal(result.ok, true);
    assert.equal(result.message, PORTAL_PASSWORD_RESET_GENERIC);
    assert.equal(result.outcome, "issued");
    assert.equal(JSON.stringify(result).includes("/portal/invite/"), false);
    assert.equal(capture.sent.length, 1);
    const message = capture.sent[0];
    assert.equal(message?.to, "a@example.com");
    assert.ok(typeof message?.text === "string");
    const match = message?.text.match(/https:\/\/portal\.example\.test\/portal\/invite\/([A-Za-z0-9_-]+)/);
    assert.ok(match);
    const rawToken = match[1]!;
    assert.equal(db.store[0].portalInviteTokenHash, hashPortalInviteToken(rawToken));
    assert.equal(JSON.stringify(db.store[0]).includes(rawToken), false);
    assert.equal(message?.text.includes(rawToken), true);
    assert.equal((message?.text.match(/https:\/\//g) ?? []).length, 1);
    assert.equal(message?.text.toLowerCase().includes("if you did not request this"), true);
    assert.equal(message?.text.includes("current-customer-pw"), false);
    assert.equal(message?.html?.includes("Client A"), false);
    assert.equal(
      db.store[0].portalInviteExpiresAt?.getTime(),
      now.getTime() + PORTAL_PASSWORD_RESET_TTL_MS
    );
    assert.equal(db.store[0].portalSessionEpoch, 1);
  });
});

test("reissue invalidates the prior outstanding reset token", async () => {
  await withPublicUrl(async () => {
    const db = prismaWithAccounts([await convertedRow()]);
    const capture = captureSend();
    const deps = {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: unlimitedLimiter(),
      clientIp: "203.0.113.10",
    };
    await requestPortalPasswordReset("a@example.com", deps);
    const firstUrl = String(capture.sent[0]?.text.match(/https:\/\/[^\s]+/)?.[0]);
    const firstToken = firstUrl.slice(firstUrl.lastIndexOf("/") + 1);
    await requestPortalPasswordReset("a@example.com", deps);
    const secondUrl = String(capture.sent[1]?.text.match(/https:\/\/[^\s]+/)?.[0]);
    const secondToken = secondUrl.slice(secondUrl.lastIndexOf("/") + 1);
    assert.notEqual(firstToken, secondToken);
    assert.equal(db.store[0].portalInviteTokenHash, hashPortalInviteToken(secondToken));
    const oldAccept = await acceptPortalInvite(firstToken, "replacement-password", {
      db: db as never,
    });
    assert.equal(oldAccept.ok, false);
    const newAccept = await acceptPortalInvite(secondToken, "replacement-password", {
      db: db as never,
    });
    assert.equal(newAccept.ok, true);
  });
});

test("accepting a self-service reset consumes the token, increments epoch, and switches passwords", async () => {
  await withPublicUrl(async () => {
    const oldPassword = "current-customer-pw";
    const newPassword = "replacement-password";
    const db = prismaWithAccounts([
      await convertedRow({
        portalPasswordHash: await hashPortalPassword(oldPassword),
        portalSessionEpoch: 4,
      }),
    ]);
    const capture = captureSend();
    await requestPortalPasswordReset("a@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: unlimitedLimiter(),
      clientIp: "203.0.113.10",
    });
    const rawToken = String(capture.sent[0]?.text.match(/\/portal\/invite\/([A-Za-z0-9_-]+)/)?.[1]);
    const accepted = await acceptPortalInvite(rawToken, newPassword, { db: db as never });
    assert.equal(accepted.ok, true);
    assert.equal(db.store[0].portalInviteTokenHash, null);
    assert.equal(db.store[0].portalSessionEpoch, 5);
    assert.equal(await verifyPortalPassword(newPassword, db.store[0].portalPasswordHash), true);
    assert.equal(await verifyPortalPassword(oldPassword, db.store[0].portalPasswordHash), false);

    const oldLogin = await authenticatePortalCustomerLogin("a@example.com", oldPassword, {
      db: db as never,
    });
    assert.equal(oldLogin.ok, false);
    const newLogin = await authenticatePortalCustomerLogin("a@example.com", newPassword, {
      db: db as never,
    });
    assert.equal(newLogin.ok, true);
    if (newLogin.ok) {
      assert.equal(newLogin.passwordCheck, "customer");
      assert.equal(newLogin.portalSessionEpoch, 5);
    }

    const replay = await acceptPortalInvite(rawToken, newPassword, { db: db as never });
    assert.equal(replay.ok, false);
  });
});

test("self-service reset cannot retarget another tenant", async () => {
  await withPublicUrl(async () => {
    const db = prismaWithAccounts([
      await convertedRow(),
      await convertedRow({
        clientAccountId: "acct_b",
        portalLoginEmail: "b@example.com",
        portalSessionEpoch: 9,
        portalPasswordHash: await hashPortalPassword("other-customer-pw"),
      }),
    ]);
    const capture = captureSend();
    await requestPortalPasswordReset("a@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: unlimitedLimiter(),
      clientIp: "203.0.113.10",
    });
    const rawToken = String(capture.sent[0]?.text.match(/\/portal\/invite\/([A-Za-z0-9_-]+)/)?.[1]);
    await acceptPortalInvite(rawToken, "replacement-password", { db: db as never });
    const a = db.store.find((s) => s.clientAccountId === "acct_a");
    const b = db.store.find((s) => s.clientAccountId === "acct_b");
    assert.equal(a?.portalSessionEpoch, 2);
    assert.equal(b?.portalSessionEpoch, 9);
    assert.equal(b?.portalInviteTokenHash, null);
    assert.equal(await verifyPortalPassword("other-customer-pw", b?.portalPasswordHash ?? null), true);
  });
});

test("rate limiting returns the generic message and does not issue a token or email", async () => {
  await withPublicUrl(async () => {
    const db = prismaWithAccounts([await convertedRow()]);
    const capture = captureSend();
    const limiter = countingLimiter(1);
    const first = await requestPortalPasswordReset("a@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: limiter,
      clientIp: "203.0.113.10",
    });
    const second = await requestPortalPasswordReset("a@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: limiter,
      clientIp: "203.0.113.10",
    });
    assert.equal(first.outcome, "issued");
    assert.equal(second.ok, true);
    assert.equal(second.message, first.message);
    assert.equal(second.outcome, "throttled");
    assert.equal(capture.sent.length, 1);
    assert.equal(PORTAL_PASSWORD_RESET_EMAIL_LIMIT, 5);
  });
});

test("missing public base URL or email transport does not issue a token", async () => {
  const prev = process.env.SA360_PORTAL_PUBLIC_BASE_URL;
  const prevAdmin = process.env.ADMIN_COC_BASE_URL;
  delete process.env.SA360_PORTAL_PUBLIC_BASE_URL;
  delete process.env.ADMIN_COC_BASE_URL;
  const db = prismaWithAccounts([await convertedRow()]);
  const capture = captureSend();
  const result = await requestPortalPasswordReset("a@example.com", {
    db: db as never,
    sendEmail: capture.sendEmail,
    consumeRateLimit: unlimitedLimiter(),
    clientIp: "203.0.113.10",
    env: {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "not_configured");
  assert.equal(result.message, PORTAL_PASSWORD_RESET_GENERIC);
  assert.equal(db.store[0].portalInviteTokenHash, null);
  assert.equal(capture.sent.length, 0);
  assert.equal(canDeliverPortalPasswordResetEmail({ env: {}, sendEmail: capture.sendEmail }), false);
  if (prev !== undefined) process.env.SA360_PORTAL_PUBLIC_BASE_URL = prev;
  if (prevAdmin !== undefined) process.env.ADMIN_COC_BASE_URL = prevAdmin;
});

test("operator invite still works for an unconverted account after a no-op self-service request", async () => {
  await withPublicUrl(async () => {
    const db = prismaWithAccounts([row()]);
    const capture = captureSend();
    const reset = await requestPortalPasswordReset("a@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: unlimitedLimiter(),
      clientIp: "203.0.113.10",
    });
    assert.equal(reset.outcome, "ineligible");
    const issued = await issuePortalInvite("acct_a", { db: db as never });
    assert.equal(issued.ok, true);
    if (!issued.ok) return;
    const rawToken = issued.inviteUrl.slice(issued.inviteUrl.lastIndexOf("/") + 1);
    const accepted = await acceptPortalInvite(rawToken, "first-customer-pw", { db: db as never });
    assert.equal(accepted.ok, true);
    assert.equal(db.store[0].portalSessionEpoch, 1);
  });
});

test("outstanding operator invite is not overwritten when the submitted email is unknown", async () => {
  await withPublicUrl(async () => {
    const { rawToken, tokenHash } = generatePortalInviteToken();
    const db = prismaWithAccounts([
      await convertedRow({
        portalInviteTokenHash: tokenHash,
        portalInviteExpiresAt: new Date("2026-12-01T00:00:00.000Z"),
      }),
    ]);
    const capture = captureSend();
    await requestPortalPasswordReset("unknown@example.com", {
      db: db as never,
      sendEmail: capture.sendEmail,
      consumeRateLimit: unlimitedLimiter(),
      clientIp: "203.0.113.10",
    });
    assert.equal(db.store[0].portalInviteTokenHash, tokenHash);
    assert.equal(capture.sent.length, 0);
    assert.equal(rawToken.length > 0, true);
  });
});
