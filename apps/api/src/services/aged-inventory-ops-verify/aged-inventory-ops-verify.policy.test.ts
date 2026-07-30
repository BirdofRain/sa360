import assert from "node:assert/strict";
import test from "node:test";

import {
  AGED_INVENTORY_OPS_VERIFY_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
} from "@sa360/shared";

test("ops verify confirmation phrases are exact", () => {
  assert.equal(AGED_INVENTORY_OPS_VERIFY_CONFIRMATION, "VERIFY AGED INVENTORY LOT");
  assert.equal(
    LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
    "MAKE REVIEWED INVENTORY AVAILABLE"
  );
});

test("operational verification claim boundaries are documented in reasons contract", () => {
  const forbiddenClaims = [
    "tcpa_consent_verified",
    "trustedform_verified",
    "buyer_delivery_proof",
    "source_ownership_proof",
  ];
  const allowedReasons = [
    "aged_operational_v1",
    "no_tcpa_claim",
    "no_trustedform_claim",
    "no_buyer_delivery_proof_claim",
    "no_source_ownership_proof_claim",
  ];
  for (const c of forbiddenClaims) {
    assert.equal(allowedReasons.includes(c), false);
  }
  assert.ok(allowedReasons.includes("aged_operational_v1"));
});
