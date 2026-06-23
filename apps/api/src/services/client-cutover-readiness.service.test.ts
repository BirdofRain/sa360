import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClientCutoverReadinessReport,
  type ClientCutoverReadinessInput,
} from "./client-cutover-readiness.service.js";
import type { ClientGhlDestinationDto } from "./client-onboarding.present.js";
import type { DestinationReadinessAssessment } from "./destination-readiness.service.js";
import type { RoutingRuleWithReadinessItem } from "./delivery-readiness-admin.present.js";

function makeReadyDestinationReadiness(
  overrides: Partial<DestinationReadinessAssessment> = {}
): DestinationReadinessAssessment {
  return {
    readyForSimulation: true,
    checklist: [
      { key: "oauth_connected", label: "OAuth connected", complete: true },
      { key: "pipeline", label: "Pipeline configured", complete: true },
    ],
    blockers: [],
    warnings: [],
    ...overrides,
  } as DestinationReadinessAssessment;
}

function makeRule(
  overrides: Partial<RoutingRuleWithReadinessItem> = {}
): RoutingRuleWithReadinessItem {
  return {
    id: "rule_1",
    masterClientAccountId: "lal_master_vet",
    clientAccountId: "pilot_client",
    destinationSubaccountIdGhl: "LOC_PILOT",
    active: true,
    clientCutoverApproved: false,
    internalApprovalStatus: "not_reviewed",
    deliveryEnabled: false,
    deliveryMode: "shadow",
    ...overrides,
  } as RoutingRuleWithReadinessItem;
}

function makeInput(
  overrides: Partial<ClientCutoverReadinessInput> = {}
): ClientCutoverReadinessInput {
  return {
    client: {
      clientAccountId: "pilot_client",
      clientDisplayName: "Pilot Client",
      status: "onboarding",
      portalEnabled: false,
      portalLoginEmail: null,
    },
    ghlDestination: {} as ClientGhlDestinationDto,
    destinationReadiness: makeReadyDestinationReadiness(),
    locationId: "LOC_PILOT",
    routingRules: [makeRule()],
    envAllowlistConfigured: false,
    destinationAllowlisted: false,
    ...overrides,
  };
}

test("missing GHL destination produces a blocker and not_ready status", () => {
  const report = buildClientCutoverReadinessReport(
    makeInput({ ghlDestination: null, destinationReadiness: null, locationId: null })
  );
  assert.equal(report.overallStatus, "not_ready");
  assert.ok(report.blockers.some((b) => b.includes("GHL destination is not configured")));
  const ghlSection = report.sections.find((s) => s.key === "ghl_destination");
  assert.equal(ghlSection?.complete, false);
});

test("destination configured but no active routing rules is a blocker", () => {
  const report = buildClientCutoverReadinessReport(makeInput({ routingRules: [] }));
  assert.equal(report.overallStatus, "not_ready");
  assert.ok(report.blockers.some((b) => b.includes("No active routing rule")));
  const rulesSection = report.sections.find((s) => s.key === "routing_rules");
  assert.equal(rulesSection?.complete, false);
});

test("portal not enabled surfaces a warning (not a hard blocker)", () => {
  const report = buildClientCutoverReadinessReport(makeInput());
  assert.ok(report.warnings.some((w) => w.includes("Portal access is not enabled")));
  const portalSection = report.sections.find((s) => s.key === "portal_access");
  assert.equal(portalSection?.complete, false);
});

test("portal enabled without login email is a blocker", () => {
  const report = buildClientCutoverReadinessReport(
    makeInput({
      client: {
        clientAccountId: "pilot_client",
        clientDisplayName: "Pilot Client",
        status: "onboarding",
        portalEnabled: true,
        portalLoginEmail: null,
      },
    })
  );
  assert.ok(report.blockers.some((b) => b.includes("no portalLoginEmail")));
});

test("clientCutoverApproved=false surfaces a delivery readiness warning (report only)", () => {
  const report = buildClientCutoverReadinessReport(makeInput());
  assert.ok(
    report.warnings.some((w) => w.includes("client cutover not approved")),
    "expected cutover-not-approved warning"
  );
  const deliverySection = report.sections.find((s) => s.key === "delivery_readiness");
  const cutoverItem = deliverySection?.items.find((i) => i.key === "client_cutover_approved");
  assert.equal(cutoverItem?.complete, false);
});

test("env allowlist not configured surfaces a warning and manual next step", () => {
  const report = buildClientCutoverReadinessReport(makeInput({ envAllowlistConfigured: false }));
  assert.ok(report.warnings.some((w) => w.includes("env allowlist is not configured")));
  assert.ok(
    report.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_"))
  );
  const envSection = report.sections.find((s) => s.key === "environment");
  assert.equal(envSection?.complete, false);
});

test("a fully configured and approved client reaches ready_for_live_review", () => {
  const report = buildClientCutoverReadinessReport(
    makeInput({
      client: {
        clientAccountId: "pilot_client",
        clientDisplayName: "Pilot Client",
        status: "active",
        portalEnabled: true,
        portalLoginEmail: "pilot@example.test",
      },
      routingRules: [
        makeRule({
          clientCutoverApproved: true,
          internalApprovalStatus: "approved",
          deliveryEnabled: true,
          deliveryMode: "live",
        }),
      ],
      envAllowlistConfigured: true,
      destinationAllowlisted: true,
    })
  );
  assert.equal(report.blockers.length, 0);
  assert.equal(report.overallStatus, "ready_for_live_review");
});

test("a rule with blocked internal approval forces overall blocked", () => {
  const report = buildClientCutoverReadinessReport(
    makeInput({
      routingRules: [makeRule({ internalApprovalStatus: "blocked" })],
    })
  );
  assert.equal(report.overallStatus, "blocked");
});

test("report is always JSON-safe with stable section keys", () => {
  const report = buildClientCutoverReadinessReport(makeInput());
  assert.deepEqual(
    report.sections.map((s) => s.key),
    [
      "client_account",
      "ghl_destination",
      "routing_rules",
      "portal_access",
      "delivery_readiness",
      "environment",
    ]
  );
  assert.equal(typeof report.generatedAt, "string");
});
