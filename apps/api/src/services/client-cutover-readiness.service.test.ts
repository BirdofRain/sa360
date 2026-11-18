import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClientCutoverReadinessReport,
  readClientControlledDeliveryPaths,
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

test("a configured GHL destination with zero routing rules keeps destination readiness separate from the routing blocker", () => {
  const report = buildClientCutoverReadinessReport(
    makeInput({
      client: {
        clientAccountId: "morgan",
        clientDisplayName: "Morgan",
        status: "active",
        portalEnabled: false,
        portalLoginEmail: null,
      },
      routingRules: [],
    })
  );
  const ghl = report.sections.find((section) => section.key === "ghl_destination");
  const rules = report.sections.find((section) => section.key === "routing_rules");
  assert.equal(ghl?.complete, true);
  assert.equal(rules?.items.find((item) => item.key === "active_rule_exists")?.detail, "0 active of 0 total");
  assert.equal(rules?.items.find((item) => item.key === "rule_master_source")?.detail, "no master source");
  assert.equal(report.overallStatus, "not_ready");
  assert.ok(report.blockers.includes("No active routing rule maps a master source to this client."));
  assert.equal(report.blockers.some((blocker) => blocker.startsWith("Destination:")), false);
  assert.equal(report.blockers.some((blocker) => blocker.includes("GHL destination is not configured")), false);
});

test("an active master-source rule stays on the existing routing checklist", () => {
  const report = buildClientCutoverReadinessReport(makeInput());
  const rules = report.sections.find((section) => section.key === "routing_rules");
  assert.equal(rules?.items.find((item) => item.key === "active_rule_exists")?.detail, "1 active of 1 total");
  assert.equal(rules?.items.find((item) => item.key === "rule_master_source")?.complete, true);
  assert.equal(rules?.items.find((item) => item.key === "rule_master_source")?.detail, "lal_master_vet");
  assert.equal(report.blockers.some((blocker) => blocker.includes("No active routing rule")), false);
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

function readyForLiveReviewInput(
  overrides: Partial<ClientCutoverReadinessInput> = {}
): ClientCutoverReadinessInput {
  return makeInput({
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
    ...overrides,
  });
}

test("legacy env allowlist not configured is labeled and still withholds live review", () => {
  const report = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({ envAllowlistConfigured: false, destinationAllowlisted: false })
  );
  assert.equal(report.overallStatus, "ready_for_shadow");
  assert.ok(
    report.warnings.some(
      (w) =>
        w.includes("Legacy approve-delivery and bulk live-canary") &&
        w.includes("env allowlist is not configured") &&
        w.includes("Confirmed-source-association GHL delivery and Company Sheets campaign delivery do not use these lists")
    )
  );
  assert.ok(
    report.manualNextSteps.some(
      (s) =>
        s.includes("Legacy approve-delivery and bulk live canary only") &&
        s.includes("SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS") &&
        s.includes("SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS") &&
        s.includes("Do not add a client to these lists")
    )
  );
  const envSection = report.sections.find((s) => s.key === "environment");
  assert.equal(envSection?.label, "Legacy approve-delivery / bulk live-canary");
  assert.equal(envSection?.complete, false);
});

test("a legacy client absent from a configured allowlist stays off live review", () => {
  const report = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({ envAllowlistConfigured: true, destinationAllowlisted: false })
  );
  assert.equal(report.overallStatus, "ready_for_shadow");
  assert.ok(
    report.warnings.some(
      (w) =>
        w.includes("Legacy approve-delivery and bulk live-canary") &&
        w.includes("not on SA360_DIRECT_DELIVERY_ALLOWED_*")
    )
  );
  assert.equal(
    report.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS")),
    false
  );
});

test("ongoing GHL association delivery is not told to edit the legacy allowlists", () => {
  const before = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({ envAllowlistConfigured: false, destinationAllowlisted: false })
  );
  const report = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({
      envAllowlistConfigured: false,
      destinationAllowlisted: false,
      ongoingGhlAssociationDelivery: true,
    })
  );
  assert.equal(before.overallStatus, "ready_for_shadow");
  assert.equal(report.overallStatus, "ready_for_live_review");
  assert.equal(report.blockers.length, 0);
  const warning = report.warnings.find((w) => w.includes("SA360_DIRECT_DELIVERY_ALLOWED_"));
  assert.ok(warning);
  assert.match(warning ?? "", /Legacy approve-delivery and bulk live-canary/);
  assert.match(warning ?? "", /confirmed-source-association GHL delivery/);
  assert.match(warning ?? "", /Do not add this client/);
  assert.equal(warning?.includes("Company Sheets campaign delivery"), false);
  assert.equal(
    report.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_")),
    false
  );
  const envSection = report.sections.find((s) => s.key === "environment");
  assert.equal(envSection?.complete, true);
  assert.match(envSection?.items[0]?.detail ?? "", /Not required for this client's confirmed-source-association GHL delivery/);
  assert.match(envSection?.items[1]?.detail ?? "", /Do not add this client/);
});

test("an allowlisted ongoing client is not warned to edit the legacy lists", () => {
  const report = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({ ongoingGhlAssociationDelivery: true, companySheetsCampaignDelivery: true })
  );
  assert.equal(report.overallStatus, "ready_for_live_review");
  assert.equal(
    report.warnings.some((w) => w.includes("SA360_DIRECT_DELIVERY_ALLOWED_")),
    false
  );
  assert.equal(
    report.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_")),
    false
  );
  assert.match(
    report.sections.find((s) => s.key === "environment")?.items[1]?.detail ?? "",
    /not required for confirmed-source-association GHL delivery and Company Sheets campaign delivery/
  );
});

test("Company Sheets campaign delivery is not told to edit the legacy allowlists", () => {
  const report = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({
      envAllowlistConfigured: false,
      destinationAllowlisted: false,
      companySheetsCampaignDelivery: true,
    })
  );
  assert.equal(report.overallStatus, "ready_for_live_review");
  const warning = report.warnings.find((w) => w.includes("SA360_DIRECT_DELIVERY_ALLOWED_"));
  assert.match(warning ?? "", /Company Sheets campaign delivery/);
  assert.match(warning ?? "", /Do not add this client/);
  assert.equal(warning?.includes("confirmed-source-association GHL delivery"), false);
  assert.equal(
    report.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_")),
    false
  );
  assert.equal(report.sections.find((s) => s.key === "environment")?.complete, true);
});

test("a client on both ongoing paths gets one legacy-only allowlist note", () => {
  const report = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({
      envAllowlistConfigured: false,
      destinationAllowlisted: false,
      ongoingGhlAssociationDelivery: true,
      companySheetsCampaignDelivery: true,
    })
  );
  assert.equal(report.overallStatus, "ready_for_live_review");
  const notes = report.warnings.filter((w) => w.includes("SA360_DIRECT_DELIVERY_ALLOWED_"));
  assert.equal(notes.length, 1);
  assert.match(notes[0] ?? "", /confirmed-source-association GHL delivery and Company Sheets campaign delivery/);
  assert.equal(
    report.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_")),
    false
  );
});

test("ongoing delivery still withholds live review for a non-allowlist gate", () => {
  const portalOff = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({
      client: {
        clientAccountId: "pilot_client",
        clientDisplayName: "Pilot Client",
        status: "active",
        portalEnabled: false,
        portalLoginEmail: null,
      },
      envAllowlistConfigured: false,
      destinationAllowlisted: false,
      ongoingGhlAssociationDelivery: true,
    })
  );
  assert.equal(portalOff.overallStatus, "ready_for_shadow");
  assert.equal(
    portalOff.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_")),
    false
  );

  const blocked = buildClientCutoverReadinessReport(
    readyForLiveReviewInput({
      routingRules: [makeRule({ internalApprovalStatus: "blocked", clientCutoverApproved: true, deliveryEnabled: true, deliveryMode: "live" })],
      envAllowlistConfigured: false,
      destinationAllowlisted: false,
      companySheetsCampaignDelivery: true,
    })
  );
  assert.equal(blocked.overallStatus, "blocked");
});

test("an ongoing client with no routing rule stays not_ready without an allowlist edit step", () => {
  const report = buildClientCutoverReadinessReport(
    makeInput({
      routingRules: [],
      envAllowlistConfigured: false,
      destinationAllowlisted: false,
      ongoingGhlAssociationDelivery: true,
      companySheetsCampaignDelivery: true,
    })
  );
  assert.equal(report.overallStatus, "not_ready");
  assert.ok(report.blockers.some((b) => b.includes("No active routing rule")));
  assert.equal(
    report.manualNextSteps.some((s) => s.includes("SA360_DIRECT_DELIVERY_ALLOWED_")),
    false
  );
});

test("readClientControlledDeliveryPaths follows persisted GHL flags and campaign dispatch", () => {
  const location = "LOC_ONGOING";
  const destination = {
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    destinationSubaccountIdGhl: location,
  };
  assert.deepEqual(
    readClientControlledDeliveryPaths({
      ghlDestination: destination,
      locationId: location,
      companySheetsCampaignDispatchEnabled: false,
    }),
    { ongoingGhlAssociationDelivery: true, companySheetsCampaignDelivery: false }
  );
  assert.deepEqual(
    readClientControlledDeliveryPaths({
      ghlDestination: { ...destination, deliveryEnabled: false },
      locationId: location,
      companySheetsCampaignDispatchEnabled: true,
    }),
    { ongoingGhlAssociationDelivery: false, companySheetsCampaignDelivery: true }
  );
  assert.deepEqual(
    readClientControlledDeliveryPaths({
      ghlDestination: destination,
      locationId: "OTHER",
      companySheetsCampaignDispatchEnabled: false,
    }),
    { ongoingGhlAssociationDelivery: false, companySheetsCampaignDelivery: false }
  );
  assert.deepEqual(
    readClientControlledDeliveryPaths({
      ghlDestination: null,
      locationId: null,
      companySheetsCampaignDispatchEnabled: false,
    }),
    { ongoingGhlAssociationDelivery: false, companySheetsCampaignDelivery: false }
  );
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
