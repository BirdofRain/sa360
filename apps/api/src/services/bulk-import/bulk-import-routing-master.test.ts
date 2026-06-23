import assert from "node:assert/strict";
import test from "node:test";
import {
  isBulkImportLifecyclePayload,
  prepareBulkImportPayloadForRoutingDryRun,
} from "./bulk-import-routing-master.service.js";

test("bulk import payload is detected from source_intake batch id", () => {
  assert.equal(
    isBulkImportLifecyclePayload({
      routing: { source_intake: { sourceImportBatchId: "batch_1" } },
    }),
    true
  );
});

test("prepareBulkImportPayloadForRoutingDryRun rewrites destination client to routing master", async () => {
  const payload = {
    client_account_id: "smart_agent_360_demo_2",
    routing: {
      source_intake: {
        sourceImportBatchId: "batch_1",
        destinationClientAccountId: "smart_agent_360_demo_2",
      },
    },
  };

  const prepared = await prepareBulkImportPayloadForRoutingDryRun(payload, "smart_agent_360_demo_2", {
    resolveRoutingMasterClientAccountIdForDestination: async () => "lal_master_vet",
  });

  assert.equal(prepared.client_account_id, "lal_master_vet");
});
