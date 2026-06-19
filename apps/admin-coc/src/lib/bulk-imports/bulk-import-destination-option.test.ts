import assert from "node:assert/strict";
import test from "node:test";
import { normalizeBulkImportDestinationOption } from "@sa360/shared";

test("destination option missing blockers does not crash normalization", () => {
  const option = normalizeBulkImportDestinationOption({
    clientAccountId: "smart_agent_360_demo_2",
    locationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
  });
  assert.equal((option.blockers ?? []).length, 0);
  assert.equal((option.liveCanaryBlockers ?? []).length, 0);
});

test("canonical canary metadata normalizes booleans", () => {
  const option = normalizeBulkImportDestinationOption({
    clientAccountId: "smart_agent_360_demo",
    locationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    isInitialCanaryTarget: true,
    canRunLiveCanary: true,
  });
  assert.equal(option.isInitialCanaryTarget, true);
  assert.equal(option.canRunLiveCanary, true);
});
