import assert from "node:assert/strict";
import test from "node:test";

import {
  customerAccountErrorCopy,
  formatCommaSeparatedList,
  isPortalAccountSetupComplete,
  parseCommaSeparatedList,
  parsePortalAccountProfile,
  profilePayloadFromForm,
} from "./account-profile.ts";

test("parseCommaSeparatedList trims and drops empties", () => {
  assert.deepEqual(parseCommaSeparatedList(" Veteran, , Trucker "), ["Veteran", "Trucker"]);
  assert.deepEqual(formatCommaSeparatedList(["vet", "trucker"]), "vet, trucker");
});

test("parsePortalAccountProfile keeps customer-safe fields only", () => {
  const profile = parsePortalAccountProfile({
    clientDisplayName: "Northwind",
    portalDisplayName: "Northwind",
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged"],
    status: "onboarding",
    profileComplete: true,
    readyToOrder: false,
    missingFields: [],
    notes: "secret",
    portalEnabled: true,
    clientAccountId: "acct_a",
  });
  assert.ok(profile);
  assert.equal(profile?.clientDisplayName, "Northwind");
  assert.equal(profile?.readyToOrder, false);
  assert.equal(isPortalAccountSetupComplete(profile), false);
  assert.equal(profile && "notes" in profile, false);
  assert.equal(profile && "clientAccountId" in profile, false);
});

test("completed profile is ready to order", () => {
  const profile = parsePortalAccountProfile({
    clientDisplayName: "Northwind",
    portalDisplayName: null,
    portalLoginEmail: "alex@example.com",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged"],
    status: "active",
    profileComplete: true,
    readyToOrder: true,
    missingFields: [],
  });
  assert.equal(isPortalAccountSetupComplete(profile), true);
});

test("profilePayloadFromForm ignores browser-supplied tenant and internal fields", () => {
  const form = new FormData();
  form.set("clientDisplayName", "Northwind");
  form.set("portalDisplayName", "Hi");
  form.set("primaryNicheKeys", "vet");
  form.set("primaryProductTypes", "aged");
  form.set("clientAccountId", "acct_other");
  form.set("status", "active");
  form.set("notes", "hack");
  form.set("portalPasswordHash", "scrypt$steal-me");
  form.set("portalSessionEpoch", "99");
  const payload = profilePayloadFromForm(form);
  assert.deepEqual(payload, {
    clientDisplayName: "Northwind",
    portalDisplayName: "Hi",
    primaryNicheKeys: ["vet"],
    primaryProductTypes: ["aged"],
  });
  assert.equal("clientAccountId" in payload, false);
  assert.equal("status" in payload, false);
  assert.equal("portalPasswordHash" in payload, false);
  assert.equal("portalSessionEpoch" in payload, false);
});

test("customerAccountErrorCopy stays customer-friendly", () => {
  assert.match(customerAccountErrorCopy("PROFILE_INCOMPLETE", 400), /required account details/i);
  assert.match(customerAccountErrorCopy("paused", 409), /paused/i);
  assert.match(customerAccountErrorCopy('{"error":"Invalid body"}', 400), /required account details|SA360 team/i);
});
