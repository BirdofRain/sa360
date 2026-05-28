import test from "node:test";
import assert from "node:assert/strict";
import {
  isObviousTestLead,
  isOperatorValidated,
  suggestLegacyPrefill,
  suggestRoutingValidation,
} from "./routing-validation-suggest.service.js";

const base = {
  matched: true,
  routingEventNameInternal: "lead_matched",
  destinationClientAccountId: "client_a",
  destinationSubaccountIdGhl: "loc_dest",
  legacyDeliveredClientAccountId: null,
  legacyDeliveredSubaccountIdGhl: null,
  legacyDeliveryContactIdGhl: null,
  legacyDeliveryStatus: null,
  validationStatus: null,
  sourceLeadUid: "lead_real_1",
  leadIdentity: null,
};

test("suggestRoutingValidation returns matched_legacy when subaccounts match", () => {
  const s = suggestRoutingValidation({
    ...base,
    legacyDeliveredSubaccountIdGhl: "loc_dest",
  });
  assert.equal(s.suggestedValidationStatus, "matched_legacy");
  assert.equal(s.suggestionConfidence, "high");
});

test("suggestRoutingValidation returns mismatch when subaccounts differ", () => {
  const s = suggestRoutingValidation({
    ...base,
    legacyDeliveredSubaccountIdGhl: "loc_other",
  });
  assert.equal(s.suggestedValidationStatus, "mismatch");
  assert.equal(s.suggestionConfidence, "high");
});

test("suggestRoutingValidation returns needs_mapping for unmatched decisions", () => {
  const s = suggestRoutingValidation({
    ...base,
    matched: false,
    routingEventNameInternal: "routing_review_required",
  });
  assert.equal(s.suggestedValidationStatus, "needs_mapping");
});

test("suggestRoutingValidation returns legacy_unknown when no legacy fields", () => {
  const s = suggestRoutingValidation(base);
  assert.equal(s.suggestedValidationStatus, "legacy_unknown");
});

test("isObviousTestLead detects test lead uid", () => {
  assert.equal(
    isObviousTestLead({ ...base, sourceLeadUid: "lead_test_sandbox_1" }),
    true
  );
});

test("isOperatorValidated treats non-unreviewed statuses as saved", () => {
  assert.equal(isOperatorValidated("matched_legacy"), true);
  assert.equal(isOperatorValidated("unreviewed"), false);
  assert.equal(isOperatorValidated(null), false);
});

test("suggestRoutingValidation does not depend on operator validationStatus", () => {
  const withManual = suggestRoutingValidation({
    ...base,
    legacyDeliveredSubaccountIdGhl: "loc_dest",
    validationStatus: "mismatch",
  });
  const fresh = suggestRoutingValidation({
    ...base,
    legacyDeliveredSubaccountIdGhl: "loc_dest",
    validationStatus: null,
  });
  assert.deepEqual(withManual, fresh);
});

test("suggestLegacyPrefill fills contact and subaccount from lifecycle event", () => {
  const p = suggestLegacyPrefill({
    legacyDeliveredClientAccountId: null,
    legacyDeliveredSubaccountIdGhl: null,
    legacyDeliveryContactIdGhl: null,
    legacyDeliveryStatus: null,
    destinationClientAccountId: "client_a",
    matched: true,
    lifecycleClientAccountId: "client_a",
    lifecycleSubaccountIdGhl: "loc_src",
    lifecycleContactIdGhl: "ct_99",
    lifecycleEventStatus: "received",
  });
  assert.equal(p.legacyDeliveryContactIdGhl, "ct_99");
  assert.equal(p.legacyDeliveredSubaccountIdGhl, "loc_src");
  assert.equal(p.legacyDeliveredClientAccountId, "client_a");
  assert.equal(p.prefillConfidence, "high");
});
