import test from "node:test";
import assert from "node:assert/strict";
import { checkClientGhlLocationMismatch } from "./client-ghl-destination-upsert.js";

test("checkClientGhlLocationMismatch rejects unconfirmed destination mismatch", () => {
  const result = checkClientGhlLocationMismatch("loc_a", "loc_b", "loc_b");
  assert.ok(result);
  assert.equal(result?.code, "LOCATION_MISMATCH");
});

test("checkClientGhlLocationMismatch allows override with confirmLocationMismatch", () => {
  const result = checkClientGhlLocationMismatch("loc_a", "loc_b", "loc_b", true);
  assert.equal(result, null);
});

test("checkClientGhlLocationMismatch rejects client linked to different location", () => {
  const result = checkClientGhlLocationMismatch(null, "loc_b", "loc_a");
  assert.ok(result);
  assert.match(result!.error, /not linked to this client/i);
});
