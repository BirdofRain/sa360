import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNT_SETUP_NICHE_PLACEHOLDER,
  ACCOUNT_SETUP_PRODUCT_PLACEHOLDER,
} from "./account-profile.ts";
import {
  parsePortalAccountPreviewScenario,
  portalAccountPreviewAccount,
  PORTAL_ACCOUNT_PREVIEW_SCENARIOS,
  previewCompletePortalAccount,
} from "./portal-account-fixtures.ts";

test("preview fixtures cover incomplete setup and completed customer-safe account", () => {
  assert.deepEqual([...PORTAL_ACCOUNT_PREVIEW_SCENARIOS], ["incomplete", "complete"]);
  const incomplete = portalAccountPreviewAccount("incomplete");
  assert.equal(incomplete.readyToOrder, false);
  assert.deepEqual(incomplete.primaryNicheKeys, []);
  assert.deepEqual(incomplete.primaryProductTypes, []);
  assert.notEqual(incomplete.primaryNicheKeys.join(", "), ACCOUNT_SETUP_NICHE_PLACEHOLDER);
  assert.notEqual(incomplete.primaryProductTypes.join(", "), ACCOUNT_SETUP_PRODUCT_PLACEHOLDER);
  const complete = portalAccountPreviewAccount("complete");
  assert.equal(complete.readyToOrder, true);
  assert.equal(parsePortalAccountPreviewScenario("complete"), "complete");
  assert.equal(parsePortalAccountPreviewScenario("nope"), "incomplete");
});

test("preview complete action treats empty placeholders as required-field errors", async () => {
  const form = new FormData();
  form.set("clientDisplayName", "Northwind");
  form.set("primaryNicheKeys", "");
  form.set("primaryProductTypes", "");
  const result = await previewCompletePortalAccount(undefined, form);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /required account details/i);
  assert.deepEqual(result.missingFields, ["primaryNicheKeys", "primaryProductTypes"]);
});

test("preview complete action accepts typed customer values", async () => {
  const form = new FormData();
  form.set("clientDisplayName", "Northwind");
  form.set("primaryNicheKeys", "Veteran");
  form.set("primaryProductTypes", "Aged");
  const result = await previewCompletePortalAccount(undefined, form);
  assert.equal(result.ok, true);
  assert.equal(result.account?.readyToOrder, true);
  assert.deepEqual(result.account?.primaryNicheKeys, ["Veteran"]);
  assert.deepEqual(result.account?.primaryProductTypes, ["Aged"]);
});
