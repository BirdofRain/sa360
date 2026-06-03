import test from "node:test";
import assert from "node:assert/strict";
import {
  hasGhlDeliveryConfigMissing,
  labelById,
  stagesForPipeline,
} from "./ghl-config-discovery-display.ts";

test("stagesForPipeline returns stages for selected pipeline", () => {
  const stages = stagesForPipeline(
    [
      {
        id: "p1",
        name: "Sales",
        stages: [{ id: "s1", name: "New Lead", position: 0 }],
      },
    ],
    "p1"
  );
  assert.equal(stages[0]?.id, "s1");
});

test("labelById resolves display name", () => {
  assert.equal(labelById([{ id: "wf1", name: "Start" }], "wf1"), "Start");
});

test("hasGhlDeliveryConfigMissing detects pipeline/workflow gaps", () => {
  assert.equal(hasGhlDeliveryConfigMissing(["destinationWorkflowIdGhl"]), true);
  assert.equal(hasGhlDeliveryConfigMissing(["backupSheetId"]), false);
});
