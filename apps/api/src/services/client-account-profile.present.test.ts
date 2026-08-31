import assert from "node:assert/strict";
import test from "node:test";
import type { ClientAccount } from "@prisma/client";

import {
  evaluateClientProfileCompleteness,
  isClientAccountReadyToOrder,
  presentClientAccountProfile,
} from "./client-account-profile.present.js";

function account(overrides: Partial<ClientAccount> = {}): ClientAccount {
  return {
    clientAccountId: "acct_a",
    clientDisplayName: "Northwind",
    status: "onboarding",
    portalEnabled: true,
    portalDisplayName: null,
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["final_expense"],
    notes: "internal only",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    portalPasswordHash: "scrypt$should-never-appear",
    portalPasswordSetAt: new Date("2026-08-01T00:00:00.000Z"),
    portalSessionEpoch: 4,
    ...overrides,
  } as ClientAccount;
}

test("completeness requires display name, at least one niche, and one product type", () => {
  const missingName = evaluateClientProfileCompleteness({
    clientDisplayName: "  ",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged"],
  });
  assert.deepEqual(missingName.missingFields, ["clientDisplayName"]);
  assert.equal(missingName.complete, false);

  const missingLists = evaluateClientProfileCompleteness({
    clientDisplayName: "Northwind",
    primaryNicheKeys: [],
    primaryProductTypes: [],
  });
  assert.deepEqual(missingLists.missingFields, ["primaryNicheKeys", "primaryProductTypes"]);
  assert.equal(missingLists.complete, false);

  const complete = evaluateClientProfileCompleteness({
    clientDisplayName: "Northwind",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged"],
  });
  assert.deepEqual(complete.missingFields, []);
  assert.equal(complete.complete, true);
});

test("presenter is customer-safe and does not expose notes or portalEnabled", () => {
  const dto = presentClientAccountProfile(account({ status: "onboarding" }));
  assert.equal(dto.clientDisplayName, "Northwind");
  assert.equal(dto.portalLoginEmail, "alex@example.com");
  assert.deepEqual(dto.primaryNicheKeys, ["vet"]);
  assert.deepEqual(dto.primaryProductTypes, ["final_expense"]);
  assert.equal(dto.profileComplete, true);
  assert.equal(dto.readyToOrder, false);
  assert.equal("notes" in dto, false);
  assert.equal("portalEnabled" in dto, false);
  assert.equal("clientAccountId" in dto, false);
  assert.equal("portalPasswordHash" in dto, false);
  assert.equal("portalPasswordSetAt" in dto, false);
  assert.equal("portalSessionEpoch" in dto, false);
  assert.equal(JSON.stringify(dto).includes("scrypt$should-never-appear"), false);
});

test("readyToOrder is true only when status is active", () => {
  assert.equal(presentClientAccountProfile(account({ status: "active" })).readyToOrder, true);
  assert.equal(presentClientAccountProfile(account({ status: "paused" })).readyToOrder, false);
  assert.equal(presentClientAccountProfile(account({ status: "archived" })).readyToOrder, false);
  assert.equal(isClientAccountReadyToOrder("active"), true);
  assert.equal(isClientAccountReadyToOrder("onboarding"), false);
  assert.equal(isClientAccountReadyToOrder("paused"), false);
  assert.equal(isClientAccountReadyToOrder("archived"), false);
});
