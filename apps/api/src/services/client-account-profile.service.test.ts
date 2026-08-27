import assert from "node:assert/strict";
import test from "node:test";
import type { ClientAccount } from "@prisma/client";

import {
  completeClientAccountOnboarding,
  getClientAccountProfile,
  patchClientAccountProfile,
} from "./client-account-profile.service.js";

type AccountRow = ClientAccount & { ghlDestination: null };

function account(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    clientAccountId: "acct_a",
    clientDisplayName: "Northwind",
    status: "onboarding",
    portalEnabled: true,
    portalDisplayName: null,
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: [],
    primaryProductTypes: [],
    notes: "do not leak",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    ghlDestination: null,
    ...overrides,
  } as AccountRow;
}

test("getClientAccountProfile is tenant-scoped and returns the stored account", async () => {
  const row = account({ clientAccountId: "acct_a" });
  const result = await getClientAccountProfile("acct_a", {
    findClientAccountByIdImpl: async (id) => (id === "acct_a" ? row : null),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.account.clientDisplayName, "Northwind");
  assert.equal(result.account.profileComplete, false);

  const missing = await getClientAccountProfile("acct_b", {
    findClientAccountByIdImpl: async (id) => (id === "acct_a" ? row : null),
  });
  assert.deepEqual(missing, { ok: false, notFound: true });
});

test("patch writes only allowed profile fields and never changes status", async () => {
  const existing = account({ status: "onboarding", notes: "secret" });
  const saved: Record<string, unknown> = {};
  const result = await patchClientAccountProfile(
    "acct_a",
    {
      clientDisplayName: "Northwind Benefits",
      portalDisplayName: "Northwind",
      primaryNicheKeys: ["vet"],
      primaryProductTypes: ["aged"],
    },
    {
      findClientAccountByIdImpl: async () => existing,
      updateClientAccountImpl: async (_id, data) => {
        Object.assign(saved, data);
        return account({
          ...existing,
          clientDisplayName: "Northwind Benefits",
          portalDisplayName: "Northwind",
          primaryNicheKeys: ["vet"],
          primaryProductTypes: ["aged"],
        });
      },
    }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.account.clientDisplayName, "Northwind Benefits");
  assert.equal(result.account.profileComplete, true);
  assert.equal(result.account.status, "onboarding");
  assert.equal(saved?.status, undefined);
  assert.equal(saved?.notes, undefined);
  assert.equal(saved?.portalEnabled, undefined);
  assert.equal(saved?.portalLoginEmail, undefined);
});

test("incomplete completion stays onboarding and reports missing fields", async () => {
  const existing = account({ status: "onboarding" });
  const result = await completeClientAccountOnboarding(
    "acct_a",
    { portalDisplayName: "Northwind" },
    {
      findClientAccountByIdImpl: async () => existing,
      updateClientAccountImpl: async (_id, data) =>
        account({
          ...existing,
          portalDisplayName: String(data.portalDisplayName ?? "Northwind"),
        }),
    }
  );
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal("code" in result && result.code === "PROFILE_INCOMPLETE", true);
  if (!("code" in result) || result.code !== "PROFILE_INCOMPLETE") return;
  assert.equal(result.account.status, "onboarding");
  assert.ok(result.missingFields.includes("primaryNicheKeys"));
  assert.ok(result.missingFields.includes("primaryProductTypes"));
});

test("valid completion promotes onboarding to active", async () => {
  const existing = account({ status: "onboarding" });
  const saved: Record<string, unknown> = {};
  const result = await completeClientAccountOnboarding(
    "acct_a",
    { primaryNicheKeys: ["vet"], primaryProductTypes: ["aged"] },
    {
      findClientAccountByIdImpl: async () => existing,
      updateClientAccountImpl: async (_id, data) => {
        Object.assign(saved, data);
        return account({
          ...existing,
          status: "active",
          primaryNicheKeys: ["vet"],
          primaryProductTypes: ["aged"],
        });
      },
    }
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.account.status, "active");
  assert.equal(result.account.readyToOrder, true);
  assert.equal(saved?.status, "active");
});

test("existing active account stays active after complete and after profile patch", async () => {
  const existing = account({
    status: "active",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged"],
  });
  const complete = await completeClientAccountOnboarding(
    "acct_a",
    { portalDisplayName: "Same" },
    {
      findClientAccountByIdImpl: async () => existing,
      updateClientAccountImpl: async (_id, data) => {
        assert.equal(data.status, undefined);
        return account({ ...existing, portalDisplayName: "Same" });
      },
    }
  );
  assert.equal(complete.ok, true);
  if (!complete.ok) return;
  assert.equal(complete.account.status, "active");

  const patched = await patchClientAccountProfile(
    "acct_a",
    { primaryNicheKeys: [] },
    {
      findClientAccountByIdImpl: async () => existing,
      updateClientAccountImpl: async (_id, data) => {
        assert.equal(data.status, undefined);
        return account({ ...existing, primaryNicheKeys: [] });
      },
    }
  );
  assert.equal(patched.ok, true);
  if (!patched.ok) return;
  assert.equal(patched.account.status, "active");
  assert.equal(patched.account.readyToOrder, true);
  assert.equal(patched.account.profileComplete, false);
});

test("paused and archived accounts cannot self-activate", async () => {
  for (const status of ["paused", "archived"] as const) {
    const result = await completeClientAccountOnboarding(
      "acct_a",
      { primaryNicheKeys: ["vet"], primaryProductTypes: ["aged"] },
      {
        findClientAccountByIdImpl: async () => account({ status }),
        updateClientAccountImpl: async () => {
          throw new Error("should not write");
        },
      }
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal("code" in result && result.code === "ACCOUNT_NOT_ELIGIBLE", true);
  }
});

test("another tenant id cannot be used to update this account", async () => {
  const tenantA = account({ clientAccountId: "acct_a" });
  const result = await patchClientAccountProfile(
    "acct_b",
    { clientDisplayName: "Hijack" },
    {
      findClientAccountByIdImpl: async (id) => (id === "acct_a" ? tenantA : null),
      updateClientAccountImpl: async () => {
        throw new Error("must not update missing tenant");
      },
    }
  );
  assert.deepEqual(result, { ok: false, notFound: true });
});
