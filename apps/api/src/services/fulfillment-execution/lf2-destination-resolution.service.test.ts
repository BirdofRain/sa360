import test from "node:test";
import assert from "node:assert/strict";

import { resolveAuthoritativeGhlDestination } from "./lf2-destination-resolution.service.js";

const baseDestination = {
  destinationSubaccountIdGhl: "loc_authoritative",
} as const;

test("absent metadata uses ClientGhlDestination location", () => {
  const result = resolveAuthoritativeGhlDestination({
    clientDestination: baseDestination as never,
    targetConfigMetadataJson: {},
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.authoritativeLocationId, "loc_authoritative");
    assert.equal(result.metadataLocationId, null);
  }
});

test("matching metadata passes", () => {
  const result = resolveAuthoritativeGhlDestination({
    clientDestination: baseDestination as never,
    targetConfigMetadataJson: { destinationSubaccountIdGhl: "loc_authoritative" },
  });
  assert.equal(result.ok, true);
});

test("mismatched metadata blocks with delivery_target_destination_mismatch", () => {
  const result = resolveAuthoritativeGhlDestination({
    clientDestination: baseDestination as never,
    targetConfigMetadataJson: { destinationSubaccountIdGhl: "loc_other" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "delivery_target_destination_mismatch");
    assert.equal(result.authoritativeLocationId, "loc_authoritative");
    assert.equal(result.metadataLocationId, "loc_other");
  }
});

test("metadata location cannot authorize a different destination write", () => {
  const result = resolveAuthoritativeGhlDestination({
    clientDestination: { destinationSubaccountIdGhl: "loc_real" } as never,
    targetConfigMetadataJson: { destinationSubaccountIdGhl: "loc_allowlisted_only" },
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, "delivery_target_destination_mismatch");
    assert.equal(result.authoritativeLocationId, "loc_real");
  }
});
