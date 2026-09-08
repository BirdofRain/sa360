import test from "node:test";
import assert from "node:assert/strict";

import {
  filterPortalCustomerWarnings,
  isPortalCustomerTimelineMilestone,
  isPortalInternalLeadDiagnostic,
  isPortalInternalSourceToken,
  portalCustomerCampaign,
  portalCustomerErrorSummary,
  portalCustomerSourceLabel,
  portalCustomerState,
  readPortalCustomerLeadFacts,
} from "./portal-lead-customer.ts";

test("InboundContactIndex snapshot copy is an internal diagnostic", () => {
  assert.equal(
    isPortalInternalLeadDiagnostic("No InboundContactIndex snapshot found for this lead scope."),
    true
  );
  assert.equal(
    isPortalInternalLeadDiagnostic("Delivery approved but no adapter or live run recorded yet."),
    true
  );
  assert.equal(isPortalInternalLeadDiagnostic("GHL workflow did not start"), true);
  assert.equal(isPortalInternalLeadDiagnostic("Destination still syncing"), false);
});

test("filters internal warnings and keeps customer-safe notes", () => {
  assert.deepEqual(
    filterPortalCustomerWarnings([
      "No InboundContactIndex snapshot found for this lead scope.",
      "Destination still syncing",
      "Routing dry-run unmatched",
    ]),
    ["Destination still syncing"]
  );
  assert.equal(portalCustomerErrorSummary("LeadCapture webhook debug status: queued"), null);
  assert.equal(portalCustomerErrorSummary("Delivery is still in progress"), "Delivery is still in progress");
});

test("LeadCapture Webhook and similar source tokens are internal", () => {
  assert.equal(isPortalInternalSourceToken("leadcapture_io"), true);
  assert.equal(isPortalInternalSourceToken("webhook"), true);
  assert.equal(isPortalInternalSourceToken("meta"), false);
  assert.equal(portalCustomerSourceLabel("leadcapture_io · webhook"), null);
  assert.equal(portalCustomerSourceLabel("meta · form"), "Meta Form");
  assert.equal(portalCustomerSourceLabel("meta · webhook"), "Meta");
  assert.equal(portalCustomerCampaign("leadcapture_io"), null);
  assert.equal(portalCustomerCampaign("Vet Q2"), "Vet Q2");
  assert.equal(portalCustomerCampaign("—"), null);
});

test("customer timeline keeps delivery and outcome milestones only", () => {
  assert.equal(isPortalCustomerTimelineMilestone("lead_delivered"), true);
  assert.equal(isPortalCustomerTimelineMilestone("appointment_set"), true);
  assert.equal(isPortalCustomerTimelineMilestone("lead_routed"), false);
  assert.equal(isPortalCustomerTimelineMilestone("lead_matched"), false);
  assert.equal(isPortalCustomerTimelineMilestone("client_workflow_started"), false);
});

test("reads customer-safe facts from attribution without ad or email plumbing", () => {
  const facts = readPortalCustomerLeadFacts({
    sourceFunnelName: "Vet intake",
    adName: "Spring offer",
    sourceAttributes: {
      state: "tx",
      age: 42,
      niche: "vet",
      ad_id: "120235027296790436",
      email: "secret@example.com",
    },
  });
  assert.equal(facts.state, "tx");
  assert.equal(facts.age, "42");
  assert.equal(facts.leadType, "vet");
  assert.equal(portalCustomerState("tx"), "TX");
});

test("missing attribution facts stay empty instead of inventing values", () => {
  assert.deepEqual(readPortalCustomerLeadFacts(null), {
    state: null,
    age: null,
    leadType: null,
  });
  assert.deepEqual(readPortalCustomerLeadFacts({ sourceAttributes: { ad_id: "ad_1" } }), {
    state: null,
    age: null,
    leadType: null,
  });
});
