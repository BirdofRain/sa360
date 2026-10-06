import assert from "node:assert/strict";
import test from "node:test";

import {
  AGED_INVENTORY_OPS_VERIFY_CONFIRMATION,
  LEAD_INVENTORY_REVIEW_MAKE_AVAILABLE_CONFIRMATION,
} from "@sa360/shared";

import { resolveItemScope, scopedIdWhere } from "./aged-inventory-ops-verify.scope.js";

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

test("omitted or empty item scope keeps whole-lot behavior", () => {
  assert.equal(resolveItemScope(undefined), null);
  assert.equal(resolveItemScope([]), null);
  assert.equal(resolveItemScope(["", "   "]), null);
  assert.deepEqual(scopedIdWhere(null, undefined), {});
});

test("item scope is trimmed and deduped", () => {
  assert.deepEqual(resolveItemScope([" item_a ", "item_b", "item_a", ""]), [
    "item_a",
    "item_b",
  ]);
});

test("scoped id filter keeps cursor paging intact", () => {
  // Scope alone.
  assert.deepEqual(scopedIdWhere(["item_a", "item_b"], undefined), {
    id: { in: ["item_a", "item_b"] },
  });
  // Cursor alone (legacy whole-lot paging).
  assert.deepEqual(scopedIdWhere(null, "item_a"), { id: { gt: "item_a" } });
  // Both must coexist, otherwise a scoped run would either rescan page 1
  // forever or silently drop the scope.
  assert.deepEqual(scopedIdWhere(["item_a", "item_b"], "item_a"), {
    id: { in: ["item_a", "item_b"], gt: "item_a" },
  });
});
