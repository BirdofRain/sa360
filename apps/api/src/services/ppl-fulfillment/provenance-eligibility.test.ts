import assert from "node:assert/strict";
import { test } from "node:test";

import { SOURCE_FUNNEL_LEADCAPTURE_PROVIDER } from "../source-intake/source-funnel.service.js";
import {
  CSV_IMPORT_SOURCE_SYSTEM,
  evaluateProvenanceEligibility,
  PPL_PROVENANCE_ELIGIBILITY_POLICY_ID,
} from "./provenance-eligibility.js";

test("unresolved manual_import / csv_import inventory is ineligible", () => {
  const decision = evaluateProvenanceEligibility({
    originClientAccountId: null,
    itemSourceProvider: "manual_import",
    eventSourceProvider: "manual_import",
    eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
    verifiedAcquisitionEvidenceId: null,
  });
  assert.equal(decision.eligible, false);
  assert.equal(decision.code, "unresolved_origin");
  assert.equal(decision.policyId, PPL_PROVENANCE_ELIGIBILITY_POLICY_ID);
});

test("a campaign label, exclusive mode, and Used By are not acquisition inputs", () => {
  const decision = evaluateProvenanceEligibility({
    originClientAccountId: null,
    itemSourceProvider: "manual_import",
    eventSourceProvider: "manual_import",
    eventSourceSystem: "leadcapture_io_legacy",
  });
  assert.equal(decision.eligible, false);
  assert.equal(
    "campaignName" in decision || "exclusivityMode" in decision || "usedBy" in decision,
    false
  );
});

test("null-origin LeadCapture stays eligible and a non-LeadCapture provider does not", () => {
  assert.equal(SOURCE_FUNNEL_LEADCAPTURE_PROVIDER, "leadcapture_io");
  const leadCapture = evaluateProvenanceEligibility({
    originClientAccountId: null,
    itemSourceProvider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
    eventSourceProvider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
    eventSourceSystem: "webhook",
  });
  assert.equal(leadCapture.eligible, true);
  assert.equal(leadCapture.code, "eligible_leadcapture_unstamped");

  const facebook = evaluateProvenanceEligibility({
    originClientAccountId: null,
    itemSourceProvider: "facebook",
    eventSourceProvider: "facebook",
  });
  assert.equal(facebook.eligible, false);
  assert.equal(facebook.code, "unresolved_origin");
});

test("missing providers and provider disagreement fail closed without acquisition evidence", () => {
  assert.equal(
    evaluateProvenanceEligibility({ originClientAccountId: null }).code,
    "unresolved_origin"
  );
  assert.equal(
    evaluateProvenanceEligibility({
      originClientAccountId: "  ",
      verifiedAcquisitionEvidenceId: "  ",
      itemSourceProvider: SOURCE_FUNNEL_LEADCAPTURE_PROVIDER,
      eventSourceProvider: "manual_import",
    }).eligible,
    false
  );
});

test("confirmed other-client origin is eligible and an explicit acquisition id is eligible", () => {
  const resale = evaluateProvenanceEligibility({
    originClientAccountId: "client_origin",
    itemSourceProvider: "manual_import",
    eventSourceProvider: "manual_import",
    eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
  });
  assert.equal(resale.eligible, true);
  assert.equal(resale.code, "eligible_confirmed_origin");

  const acquired = evaluateProvenanceEligibility({
    originClientAccountId: null,
    itemSourceProvider: "manual_import",
    eventSourceSystem: CSV_IMPORT_SOURCE_SYSTEM,
    verifiedAcquisitionEvidenceId: "acq_verified_1",
  });
  assert.equal(acquired.eligible, true);
  assert.equal(acquired.code, "eligible_verified_acquisition");
});
