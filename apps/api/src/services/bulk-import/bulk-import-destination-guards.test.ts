import assert from "node:assert/strict";
import test from "node:test";
import { BulkImportDestinationError } from "./bulk-import-destination-errors.js";

test("BulkImportDestinationError carries typed code and linked client", () => {
  const err = new BulkImportDestinationError(
    "destination_identity_mismatch",
    "The selected GHL location is linked to smart_agent_360_demo_2, not smart_agent_360_demo.",
    "smart_agent_360_demo_2"
  );
  assert.equal(err.code, "destination_identity_mismatch");
  assert.equal(err.linkedClientAccountId, "smart_agent_360_demo_2");
});

test("manual location/client mismatch message is explicit", () => {
  const err = new BulkImportDestinationError(
    "destination_identity_mismatch",
    "The selected GHL location is linked to smart_agent_360_demo_2, not smart_agent_360_demo.",
    "smart_agent_360_demo_2"
  );
  assert.match(err.message, /smart_agent_360_demo_2/);
  assert.match(err.message, /smart_agent_360_demo/);
});
