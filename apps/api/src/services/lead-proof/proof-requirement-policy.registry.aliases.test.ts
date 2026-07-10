import test from "node:test";
import assert from "node:assert/strict";

import {
  getProofRequirementPolicy,
  resolveProofPolicyKey,
} from "./proof-requirement-policy.registry.js";

test("facebook_meta_lead_ads resolves to meta_lead_ads policy", () => {
  assert.equal(resolveProofPolicyKey("facebook_meta_lead_ads"), "meta_lead_ads");
  assert.equal(getProofRequirementPolicy("facebook_meta_lead_ads").sourceLane, "meta_lead_ads");
  assert.deepEqual(getProofRequirementPolicy("facebook_meta_lead_ads").requiredArtifacts, []);
});

test("google_sheets_google_sheet_import resolves to google_sheet_import policy", () => {
  assert.equal(resolveProofPolicyKey("google_sheets_google_sheet_import"), "google_sheet_import");
  assert.equal(
    getProofRequirementPolicy("google_sheets_google_sheet_import").sourceLane,
    "google_sheet_import"
  );
});

test("unknown lanes still resolve to unknown policy", () => {
  assert.equal(resolveProofPolicyKey("totally_new_lane"), "unknown");
  assert.equal(getProofRequirementPolicy("totally_new_lane").sourceLane, "unknown");
});

test("lanes requiring proof artifacts retain those requirements", () => {
  const policy = getProofRequirementPolicy("leadconduit_facebook");
  assert.equal(policy.sourceLane, "leadconduit_facebook");
  assert.equal(policy.requiredArtifacts.length, 1);
  assert.equal(policy.requiredArtifacts[0]?.artifactType, "CONSENT_CERTIFICATE");
});

test("broad substring containment no longer maps unrelated lanes to manual_import", () => {
  assert.equal(resolveProofPolicyKey("some_manual_notes_lane"), "unknown");
  assert.equal(resolveProofPolicyKey("random_import_feed"), "unknown");
});
