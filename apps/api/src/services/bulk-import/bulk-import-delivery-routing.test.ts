import assert from "node:assert/strict";
import test from "node:test";
import { deliverBulkImportRow } from "./bulk-import-delivery.service.js";

const batchContext = {
  destinationClientAccountId: "smart_agent_360_demo_2",
  destinationLocationIdGhl: "loc_demo",
};

const demoEvent = {
  id: "evt_1",
  status: "routing_matched",
  clientAccountIdResolved: "smart_agent_360_demo_2",
  destinationLocationIdResolved: "loc_demo",
  normalizedPayloadJson: { event: { event_name_internal: "lead_created" } },
};

test("deliverBulkImportRow records routing failure before GHL write", async () => {
  const rowUpdates: Array<Record<string, unknown>> = [];
  const result = await deliverBulkImportRow(
    "evt_1",
    "row_1",
    batchContext,
    "operator@test",
    {
      findSourceLeadEventById: async () => demoEvent as never,
      updateSourceLeadEvent: async () => demoEvent as never,
      updateBulkLeadImportRow: async (_id, data) => {
        rowUpdates.push(data as Record<string, unknown>);
        return {} as never;
      },
      validateLiveDeliveryDestination: async () => ({ ok: true as const }),
      approveSourceLeadDelivery: async () => ({
        ok: false as const,
        error: "delivery_blocked",
        reason: "No active routing rule matched attribution; manual review required.",
        sourceLeadEventId: "evt_1",
      }),
    }
  );

  assert.equal(result.ok, false);
  assert.match(String(result.reason), /No active routing rule matched/);
  assert.equal(rowUpdates[0]?.deliveryStatus, "failed");
  assert.match(String(rowUpdates[0]?.errorSummary), /No active routing rule matched/);
});

test("deliverBulkImportRow proceeds on matched routing dry run result", async () => {
  let deliveryCalled = false;
  const result = await deliverBulkImportRow(
    "evt_2",
    "row_2",
    batchContext,
    "operator@test",
    {
      findSourceLeadEventById: async () => ({ ...demoEvent, id: "evt_2" }) as never,
      updateSourceLeadEvent: async () => ({}) as never,
      updateBulkLeadImportRow: async () => ({}) as never,
      validateLiveDeliveryDestination: async () => ({ ok: true as const }),
      approveSourceLeadDelivery: async () => {
        deliveryCalled = true;
        return {
          ok: true,
          externalCallExecuted: true,
          contactIdGhl: "contact_1",
          opportunityIdGhl: null,
          sourceLeadEventId: "evt_2",
        } as never;
      },
    }
  );

  assert.equal(deliveryCalled, true);
  assert.equal(result.ok, true);
});
