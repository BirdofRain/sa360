import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapGhlConnectionStatus, worstTrustStatus } from "./trust-builders";

describe("trust-builders", () => {
  it("maps GHL connection statuses", () => {
    assert.equal(mapGhlConnectionStatus("connected"), "verified");
    assert.equal(mapGhlConnectionStatus("revoked"), "failed");
    assert.equal(mapGhlConnectionStatus("pending_token"), "needs_setup");
  });

  it("picks worst trust status", () => {
    assert.equal(worstTrustStatus(["verified", "warning", "verified"]), "warning");
    assert.equal(worstTrustStatus(["verified", "failed"]), "failed");
  });
});
