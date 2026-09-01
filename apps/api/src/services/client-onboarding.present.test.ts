import assert from "node:assert/strict";
import test from "node:test";
import type { ClientAccount, ClientGhlDestination } from "@prisma/client";

import {
  hasOutstandingPortalInvite,
  presentClientAccountDetail,
} from "./client-onboarding.present.js";

/** Same include shape `presentClientAccountDetail` requires (`ghlDestination` may be null). */
type AccountWithDestination = ClientAccount & {
  ghlDestination: ClientGhlDestination | null;
};

function account(overrides: Partial<AccountWithDestination> = {}): AccountWithDestination {
  return {
    clientAccountId: "acct_a",
    clientDisplayName: "Northwind",
    status: "onboarding",
    portalEnabled: true,
    portalDisplayName: "Northwind Portal",
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["final_expense"],
    notes: "internal only",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    portalPasswordHash: null,
    portalPasswordSetAt: null,
    portalSessionEpoch: 0,
    portalInviteTokenHash: null,
    portalInviteExpiresAt: null,
    ghlDestination: null,
    ...overrides,
  };
}

test("admin detail DTO exposes hasPortalPassword without the hash", () => {
  const unset = presentClientAccountDetail(account(), [], null);
  assert.equal(unset.hasPortalPassword, false);
  assert.equal("portalPasswordHash" in unset, false);

  const set = presentClientAccountDetail(
    account({ portalPasswordHash: "scrypt$should-never-appear" }),
    [],
    null
  );
  assert.equal(set.hasPortalPassword, true);
  assert.equal("portalPasswordHash" in set, false);
  assert.equal(JSON.stringify(set).includes("scrypt$should-never-appear"), false);
});

test("admin detail DTO exposes outstanding-invite boolean without token hash", () => {
  const now = new Date("2026-09-01T12:00:00.000Z");
  const none = presentClientAccountDetail(account(), [], null);
  assert.equal(none.hasOutstandingPortalInvite, false);
  assert.equal("portalInviteTokenHash" in none, false);
  assert.equal("portalInviteExpiresAt" in none, false);

  const outstanding = hasOutstandingPortalInvite(
    account({
      portalInviteTokenHash: "deadbeefinvitehash",
      portalInviteExpiresAt: new Date("2026-09-02T12:00:00.000Z"),
    }),
    now
  );
  assert.equal(outstanding, true);

  const expired = hasOutstandingPortalInvite(
    account({
      portalInviteTokenHash: "deadbeefinvitehash",
      portalInviteExpiresAt: new Date("2026-08-31T12:00:00.000Z"),
    }),
    now
  );
  assert.equal(expired, false);

  const dto = presentClientAccountDetail(
    account({
      portalInviteTokenHash: "deadbeefinvitehash",
      portalInviteExpiresAt: new Date(Date.now() + 60_000),
    }),
    [],
    null
  );
  assert.equal(dto.hasOutstandingPortalInvite, true);
  assert.equal("portalInviteTokenHash" in dto, false);
  assert.equal("portalSessionEpoch" in dto, false);
  assert.equal(JSON.stringify(dto).includes("deadbeefinvitehash"), false);
});
