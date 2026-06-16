import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSourceLeadEventCorrelation } from "./source-lead-duplicate-risk.service.js";

test("evaluateSourceLeadEventCorrelation skips generated lead ids", async () => {
  const result = await evaluateSourceLeadEventCorrelation({
    sourceProvider: "leadcapture_io",
    sourceSystem: "leadcapture_io_legacy",
    sourceLeadId: "gen-abc123",
    excludeEventId: "evt_new",
    sourceLeadIdGenerated: true,
  });
  assert.equal(result.correlated, false);
  assert.equal(result.blocksDelivery, false);
});
