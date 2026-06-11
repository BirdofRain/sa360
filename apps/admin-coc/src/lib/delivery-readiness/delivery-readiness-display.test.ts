import test from "node:test";
import assert from "node:assert/strict";
import {
  deliveryReadinessTierSummary,
  directCanaryReadinessLabel,
  formatBlockersWarnings,
  liveDeliveryAllowedLabel,
  readinessStatusBadgeClass,
  readinessStatusLabel,
} from "./delivery-readiness-display.ts";
import type { DeliveryReadinessAssessment } from "./types.ts";

const assessment: DeliveryReadinessAssessment = {
  ruleId: "r1",
  clientAccountId: "c1",
  destinationSubaccountIdGhl: "loc",
  clientDisplayName: "Agent",
  readyForShadow: true,
  readyForDirectCanary: true,
  readyForLive: false,
  canDeliverLive: false,
  readinessStatus: "needs_config",
  blockers: ["Workflow missing"],
  warnings: ["No assigned user"],
  missingConfig: [],
  requiredApprovals: [],
  recommendedNextAction: "Configure workflow",
  checklist: [],
};

test("readinessStatusLabel formats snake case", () => {
  assert.equal(readinessStatusLabel("ready_for_live"), "Ready For Live");
});

test("readinessStatusBadgeClass returns amber for needs_config", () => {
  assert.ok(readinessStatusBadgeClass("needs_config").includes("amber"));
});

test("formatBlockersWarnings joins blockers and warnings", () => {
  const text = formatBlockersWarnings(assessment);
  assert.match(text, /Workflow missing/);
  assert.match(text, /No assigned user/);
});

test("liveDeliveryAllowedLabel reflects canDeliverLive", () => {
  assert.equal(liveDeliveryAllowedLabel(false), "No");
  assert.equal(liveDeliveryAllowedLabel(true), "Yes (config only)");
});

test("deliveryReadinessTierSummary distinguishes shadow canary and full delivery", () => {
  assert.equal(
    deliveryReadinessTierSummary({
      readyForShadow: true,
      readyForDirectCanary: true,
      readyForLive: false,
      canDeliverLive: false,
    }),
    "Ready for direct canary"
  );
  assert.equal(
    deliveryReadinessTierSummary({
      readyForShadow: true,
      readyForDirectCanary: false,
      readyForLive: false,
      canDeliverLive: false,
    }),
    "Ready for shadow"
  );
  assert.equal(directCanaryReadinessLabel(true), "Ready for direct canary");
});
