import test from "node:test";
import assert from "node:assert/strict";
import type { DeliveryReadinessRuleInput } from "../services/delivery-readiness.service.js";
import {
  GHL_SINGLE_PLAN_CANARY_ID_ENV,
  applySinglePlanCanaryArmingException,
  getGhlSinglePlanCanaryId,
  ghlSinglePlanCanaryDecision,
} from "./ghl-single-plan-canary.js";

const base: DeliveryReadinessRuleInput = {
  id: "confirmed_source_association",
  masterClientAccountId: "lal_master_vet",
  clientAccountId: "alex_gross",
  destinationSubaccountIdGhl: "yCziKRW26eFg8IXAQZ73",
  deliveryEnabled: false,
  deliveryMode: "shadow",
  clientCutoverApproved: false,
  internalApprovalStatus: "not_reviewed",
  snapshotInstalled: false,
  requiredFieldsInstalled: false,
  ghlConnectionStatus: "connected",
};

test("single-plan pin is unset by default", () => {
  const prev = process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];
  delete process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];
  assert.equal(getGhlSinglePlanCanaryId(), null);
  assert.deepEqual(ghlSinglePlanCanaryDecision("plan_1"), { pinned: false });
  if (prev !== undefined) process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV] = prev;
});

test("pin allows only the named plan", () => {
  const prev = process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];
  process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV] = " plan_one ";
  assert.equal(getGhlSinglePlanCanaryId(), "plan_one");
  assert.deepEqual(ghlSinglePlanCanaryDecision("plan_one"), { pinned: true, allowed: true });
  assert.deepEqual(ghlSinglePlanCanaryDecision("plan_two"), { pinned: true, allowed: false });
  assert.deepEqual(ghlSinglePlanCanaryDecision(null), { pinned: true, allowed: false });
  if (prev !== undefined) process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV] = prev;
  else delete process.env[GHL_SINGLE_PLAN_CANARY_ID_ENV];
});

test("arming exception does not flip snapshot or field installation", () => {
  const next = applySinglePlanCanaryArmingException(base);
  assert.equal(next.deliveryEnabled, true);
  assert.equal(next.deliveryMode, "live");
  assert.equal(next.clientCutoverApproved, true);
  assert.equal(next.internalApprovalStatus, "approved");
  assert.equal(next.snapshotInstalled, false);
  assert.equal(next.requiredFieldsInstalled, false);
  assert.equal(base.deliveryEnabled, false);
  assert.equal(base.deliveryMode, "shadow");
});
