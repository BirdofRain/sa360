import test from "node:test";
import assert from "node:assert/strict";
import {
  UNKNOWN_LEAD,
  webhookIdentityOverrideFromDetail,
  webhookRowLeadName,
} from "./webhook-monitor-identity.ts";

test("webhookRowLeadName uses list value when present", () => {
  assert.equal(webhookRowLeadName({ leadName: "Don Bailey" }), "Don Bailey");
});

test("webhookRowLeadName falls back to Unknown lead when list value is blank", () => {
  assert.equal(webhookRowLeadName({ leadName: "" }), UNKNOWN_LEAD);
  assert.equal(webhookRowLeadName({ leadName: undefined }), UNKNOWN_LEAD);
});

test("webhookRowLeadName prefers a detail override over a stale Unknown list value", () => {
  const override = { leadName: "Simon squire", leadPhone: null, leadEmail: null };
  assert.equal(webhookRowLeadName({ leadName: "" }, override), "Simon squire");
});

test("webhookIdentityOverrideFromDetail reads the drawer top-line lead", () => {
  const override = webhookIdentityOverrideFromDetail({
    leadName: "Unknown lead",
    leadPhone: "+14692630417",
    leadEmail: "yeliab1950@yahoo.com",
    debug: { topLine: { lead: "Simon squire" } },
  } as Parameters<typeof webhookIdentityOverrideFromDetail>[0]);
  assert.equal(override.leadName, "Simon squire");
  assert.equal(override.leadPhone, "+14692630417");
});

test("webhookIdentityOverrideFromDetail falls back to detail leadName when no top line", () => {
  const override = webhookIdentityOverrideFromDetail({
    leadName: "Don Bailey",
    leadPhone: null,
    leadEmail: null,
  } as Parameters<typeof webhookIdentityOverrideFromDetail>[0]);
  assert.equal(override.leadName, "Don Bailey");
});
