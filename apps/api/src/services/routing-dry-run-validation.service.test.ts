import test from "node:test";
import assert from "node:assert/strict";
import { buildRoutingValidationUpdate } from "./routing-dry-run-validation.service.js";

const NOW = new Date("2026-05-19T14:00:00.000Z");

test("buildRoutingValidationUpdate persists legacy fields and review metadata", () => {
  const update = buildRoutingValidationUpdate(
    {
      validationStatus: "matched_legacy",
      legacyDeliveredClientAccountId: "client_legacy",
      legacyDeliveredSubaccountIdGhl: "loc_legacy",
      legacyDeliveryContactIdGhl: "ct_1",
      legacyDeliveryStatus: "delivered",
      validationNotes: "Matches Zapier destination",
      validatedBy: "ops",
    },
    NOW
  );
  assert.equal(update.validationStatus, "matched_legacy");
  assert.equal(update.legacyDeliveredClientAccountId, "client_legacy");
  assert.equal(update.legacyDeliveredSubaccountIdGhl, "loc_legacy");
  assert.equal(update.legacyDeliveryContactIdGhl, "ct_1");
  assert.equal(update.legacyDeliveryStatus, "delivered");
  assert.equal(update.validationNotes, "Matches Zapier destination");
  assert.equal(update.validatedBy, "ops");
  assert.equal(update.validatedAt, NOW);
});

test("buildRoutingValidationUpdate clears review metadata for unreviewed", () => {
  const update = buildRoutingValidationUpdate(
    {
      validationStatus: "unreviewed",
      legacyDeliveredClientAccountId: null,
      legacyDeliveredSubaccountIdGhl: null,
      legacyDeliveryContactIdGhl: null,
      legacyDeliveryStatus: null,
      validationNotes: null,
    },
    NOW
  );
  assert.equal(update.validationStatus, "unreviewed");
  assert.equal(update.validatedBy, null);
  assert.equal(update.validatedAt, null);
});

test("buildRoutingValidationUpdate defaults validatedBy when reviewed", () => {
  const update = buildRoutingValidationUpdate(
    {
      validationStatus: "mismatch",
      legacyDeliveredClientAccountId: null,
      legacyDeliveredSubaccountIdGhl: null,
      legacyDeliveryContactIdGhl: null,
      legacyDeliveryStatus: null,
      validationNotes: "Wrong subaccount",
    },
    NOW
  );
  assert.equal(update.validatedBy, "coc_operator");
});
