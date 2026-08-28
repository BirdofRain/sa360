import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";

import type { SendTransactionalEmailInput, SendTransactionalEmailResult } from "../../lib/transactional-email.js";
import {
  CUSTOMER_RELEASE_NOTIFY_STATUS,
  CUSTOMER_RELEASE_NOTIFY_STALE_CLAIM_MS,
  buildDeliveryReleasedEmail,
  customerReleaseNotifyClaimWhere,
  isValidCustomerPortalEmail,
  notifyCustomerDeliveryReleased,
  resolvePortalOrderPath,
  resolvePortalOrderUrl,
} from "./delivery-release-notify.service.js";

type PackageState = {
  id: string;
  leadOrderId: string;
  clientAccountId: string;
  spreadsheetDeliveredAt: Date | null;
  customerReleaseNotifyStatus: string | null;
  customerReleaseNotifyClaimedAt: Date | null;
  customerReleaseNotifiedAt: Date | null;
  customerReleaseNotifyError: string | null;
  customerReleaseNotifyProviderId: string | null;
};

type AccountState = {
  clientAccountId: string;
  clientDisplayName: string;
  portalDisplayName: string | null;
  portalLoginEmail: string | null;
};

function matchesClaim(
  pkg: PackageState,
  where: ReturnType<typeof customerReleaseNotifyClaimWhere>,
  now: Date
): boolean {
  if (pkg.id !== where.id) return false;
  if (!pkg.spreadsheetDeliveredAt) return false;
  const staleBefore = new Date(now.getTime() - CUSTOMER_RELEASE_NOTIFY_STALE_CLAIM_MS);
  const status = pkg.customerReleaseNotifyStatus;
  if (status == null) return true;
  if (status === "pending" || status === "failed" || status === "skipped") return true;
  if (status === "sending" && pkg.customerReleaseNotifyClaimedAt && pkg.customerReleaseNotifyClaimedAt < staleBefore) {
    return true;
  }
  return false;
}

function createNotifyDb(input: {
  pkg: PackageState;
  accounts: AccountState[];
  orderNumber?: string;
  orderClientAccountId?: string;
}) {
  const pkg = { ...input.pkg };
  const accounts = new Map(input.accounts.map((row) => [row.clientAccountId, { ...row }]));
  const updates: unknown[] = [];

  const db = {
    leadDeliveryExportPackage: {
      updateMany: async ({
        where,
        data,
      }: {
        where: ReturnType<typeof customerReleaseNotifyClaimWhere>;
        data: Partial<PackageState>;
      }) => {
        const now = data.customerReleaseNotifyClaimedAt ?? new Date();
        if (!matchesClaim(pkg, where, now instanceof Date ? now : new Date())) {
          return { count: 0 };
        }
        Object.assign(pkg, data);
        updates.push({ op: "claim", data });
        return { count: 1 };
      },
      findUnique: async () => ({
        ...pkg,
        leadOrder: {
          orderNumber: input.orderNumber ?? "LO-1001",
          clientDisplayName: "Valley Vet",
          clientAccountId: input.orderClientAccountId ?? pkg.clientAccountId,
        },
      }),
      update: async ({ data }: { data: Partial<PackageState> }) => {
        Object.assign(pkg, data);
        updates.push({ op: "update", data });
        return pkg;
      },
    },
    clientAccount: {
      findUnique: async ({ where }: { where: { clientAccountId: string } }) =>
        accounts.get(where.clientAccountId) ?? null,
    },
  };

  return { db: db as unknown as PrismaClient, pkg, accounts, updates };
}

function releasedPackage(overrides: Partial<PackageState> = {}): PackageState {
  return {
    id: "pkg_1",
    leadOrderId: "ord_1",
    clientAccountId: "acct_owner",
    spreadsheetDeliveredAt: new Date("2026-08-20T15:00:00.000Z"),
    customerReleaseNotifyStatus: "pending",
    customerReleaseNotifyClaimedAt: null,
    customerReleaseNotifiedAt: null,
    customerReleaseNotifyError: null,
    customerReleaseNotifyProviderId: null,
    ...overrides,
  };
}

function ownerAccount(overrides: Partial<AccountState> = {}): AccountState {
  return {
    clientAccountId: "acct_owner",
    clientDisplayName: "Valley Vet",
    portalDisplayName: "Valley Vet Portal",
    portalLoginEmail: "owner@valleyvet.example",
    ...overrides,
  };
}

describe("delivery-release email content", () => {
  it("includes portal order link and never mentions CSV or internals", () => {
    const email = buildDeliveryReleasedEmail({
      accountDisplayName: "Valley Vet",
      orderNumber: "LO-1001",
      orderId: "ord_1",
      portalBaseUrl: "https://app.example.com",
    });
    assert.equal(email.subject, "Your SA360 order is ready");
    assert.match(email.text, /Your spreadsheet delivery is ready/);
    assert.match(email.text, /Order LO-1001/);
    assert.match(email.text, /https:\/\/app\.example\.com\/portal\/orders\/ord_1/);
    assert.equal(email.portalUrl, "https://app.example.com/portal/orders/ord_1");
    assert.doesNotMatch(email.text, /csv|allocation|exportId|storage|Alex|fulfillment/i);
    assert.doesNotMatch(email.html, /csv|attachment|allocation/i);
    assert.equal(resolvePortalOrderPath("ord_1"), "/portal/orders/ord_1");
    assert.equal(resolvePortalOrderUrl("ord_1"), "/portal/orders/ord_1");
  });

  it("accepts only syntactically valid portal emails", () => {
    assert.equal(isValidCustomerPortalEmail("owner@valleyvet.example"), true);
    assert.equal(isValidCustomerPortalEmail("  "), false);
    assert.equal(isValidCustomerPortalEmail("not-an-email"), false);
    assert.equal(isValidCustomerPortalEmail(null), false);
  });
});

describe("notifyCustomerDeliveryReleased", () => {
  it("does not send when the package is unreleased", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const { db, pkg } = createNotifyDb({
      pkg: releasedPackage({ spreadsheetDeliveredAt: null, customerReleaseNotifyStatus: null }),
      accounts: [ownerAccount()],
    });
    const result = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "email_1" };
      },
    });
    assert.equal(result.outcome, "not_released");
    assert.equal(sendCalls.length, 0);
    assert.equal(pkg.customerReleaseNotifyStatus, null);
  });

  it("sends one email from the owning ClientAccount portalLoginEmail", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const { db, pkg } = createNotifyDb({
      pkg: releasedPackage(),
      accounts: [
        ownerAccount(),
        {
          clientAccountId: "acct_other",
          clientDisplayName: "Other Buyer",
          portalDisplayName: null,
          portalLoginEmail: "other@foreign.example",
        },
      ],
    });
    const result = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "email_1" };
      },
    });
    assert.equal(result.outcome, "sent");
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0]?.to, "owner@valleyvet.example");
    assert.equal(sendCalls[0]?.idempotencyKey, "delivery-release:pkg_1");
    assert.equal(Object.hasOwn(sendCalls[0] ?? {}, "attachments"), false);
    assert.match(String(sendCalls[0]?.text), /\/portal\/orders\/ord_1/);
    assert.doesNotMatch(String(sendCalls[0]?.text), /csv/i);
    assert.equal(pkg.customerReleaseNotifyStatus, CUSTOMER_RELEASE_NOTIFY_STATUS.sent);
    assert.equal(pkg.customerReleaseNotifyProviderId, "email_1");
  });

  it("does not look up another tenant's portalLoginEmail as the recipient", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const lookups: string[] = [];
    const { db } = createNotifyDb({
      pkg: releasedPackage({ clientAccountId: "acct_owner" }),
      accounts: [ownerAccount({ portalLoginEmail: "owner@valleyvet.example" })],
    });
    const wrapped = {
      ...db,
      clientAccount: {
        findUnique: async ({ where }: { where: { clientAccountId: string } }) => {
          lookups.push(where.clientAccountId);
          return db.clientAccount.findUnique({ where });
        },
      },
    } as unknown as PrismaClient;

    await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, wrapped, {
      send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "email_1" };
      },
    });
    assert.deepEqual(lookups, ["acct_owner"]);
    assert.equal(sendCalls[0]?.to, "owner@valleyvet.example");
  });

  it("skips when the owning account has no portalLoginEmail", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const { db, pkg } = createNotifyDb({
      pkg: releasedPackage(),
      accounts: [ownerAccount({ portalLoginEmail: null })],
    });
    const result = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "should_not_send" };
      },
    });
    assert.equal(result.outcome, "skipped");
    if (result.outcome === "skipped") {
      assert.equal(result.reason, "missing_portal_login_email");
    }
    assert.equal(sendCalls.length, 0);
    assert.equal(pkg.customerReleaseNotifyStatus, CUSTOMER_RELEASE_NOTIFY_STATUS.skipped);
  });

  it("records provider failure as retryable and does not mark sent", async () => {
    const { db, pkg } = createNotifyDb({
      pkg: releasedPackage(),
      accounts: [ownerAccount()],
    });
    const result = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async () => ({ ok: false, error: "Resend 503: unavailable" }),
    });
    assert.equal(result.outcome, "failed");
    assert.equal(pkg.customerReleaseNotifyStatus, CUSTOMER_RELEASE_NOTIFY_STATUS.failed);
    assert.equal(pkg.customerReleaseNotifiedAt, null);
  });

  it("does not send a second email after a successful send", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const send = async (input: SendTransactionalEmailInput): Promise<SendTransactionalEmailResult> => {
      sendCalls.push(input);
      return { ok: true, id: `email_${sendCalls.length}` };
    };
    const { db } = createNotifyDb({
      pkg: releasedPackage(),
      accounts: [ownerAccount()],
    });
    const first = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, { send });
    const second = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, { send });
    assert.equal(first.outcome, "sent");
    assert.equal(second.outcome, "already_sent");
    assert.equal(sendCalls.length, 1);
  });

  it("retries a failed notification exactly once after the provider recovers", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const { db } = createNotifyDb({
      pkg: releasedPackage(),
      accounts: [ownerAccount()],
    });
    const fail = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async () => ({ ok: false, error: "timeout" }),
    });
    const recover = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "email_recovered" };
      },
    });
    const replay = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "email_dup" };
      },
    });
    assert.equal(fail.outcome, "failed");
    assert.equal(recover.outcome, "sent");
    assert.equal(replay.outcome, "already_sent");
    assert.equal(sendCalls.length, 1);
  });

  it("does not send while another attempt holds a fresh claim", async () => {
    const sendCalls: SendTransactionalEmailInput[] = [];
    const { db } = createNotifyDb({
      pkg: releasedPackage({
        customerReleaseNotifyStatus: "sending",
        customerReleaseNotifyClaimedAt: new Date(),
      }),
      accounts: [ownerAccount()],
    });
    const result = await notifyCustomerDeliveryReleased({ exportId: "pkg_1" }, db, {
      send: async (input) => {
        sendCalls.push(input);
        return { ok: true, id: "email_race" };
      },
    });
    assert.equal(result.outcome, "in_progress");
    assert.equal(sendCalls.length, 0);
  });
});
