import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { BulkImportMonitorPanel } from "./bulk-import-monitor-panel.tsx";

test.afterEach(() => {
  cleanup();
});

test("delivered GHL record card renders delivery fields in readable layout", () => {
  render(
    <BulkImportMonitorPanel
      monitor={{
        batchId: "batch_1",
        batchStatus: "completed",
        approvedRowCount: 1,
        approvedRowIds: ["row_1"],
        queueJobs: [],
        rowsDelivering: 0,
        rowsDelivered: 1,
        rowsFailed: 0,
        rowsWaiting: 0,
        lastActivityAt: "2026-06-17T12:00:00.000Z",
        lastWorkerError: null,
        workerConfigured: true,
        queueReachable: true,
        queueStale: false,
        destinationClientAccountId: "client_a",
        destinationLocationIdGhl: "loc_a",
        workflowStrategy: "source_tag_only",
      }}
      deliveredRows={[
        {
          rowNumber: 1,
          name: "Avery Canary",
          ghlContactId: "contact_123",
          liveDelivery: {
            ghlContactId: "contact_123",
            ghlOpportunityId: "opp_456",
            destinationLocationIdGhl: "loc_a",
            contactAction: "created",
            ownerId: "owner_1",
            ownerName: "Demo Owner",
            tagsAdded: ["source:goat"],
            workflowTriggerStrategy: "source_tag_only",
            workflowTriggerNote:
              "Trigger tag added: SA360::TRIGGER::NEW_LEAD. No direct workflow start API call was made. Messaging will only start if a GHL workflow is configured to react to this tag.",
            liveRunId: "run_789",
            adapterStatus: "succeeded",
            deliveredAt: "2026-06-17T12:00:00.000Z",
          },
        },
      ]}
    />
  );

  const card = screen.getByTestId("delivered-ghl-record-row-1");
  assert.ok(card.className.includes("overflow-visible"));
  assert.ok(screen.getByText(/GHL contact ID:/).closest("[data-testid]") === card);
  assert.ok(screen.getByText("contact_123"));
  assert.ok(screen.getByText(/Opportunity ID:/));
  assert.ok(screen.getByText("opp_456"));
  assert.ok(screen.getByText(/Owner:/));
  assert.ok(screen.getByText("Demo Owner"));
  assert.ok(screen.getByText(/Live run ID:/));
  assert.ok(screen.getByText("run_789"));
  assert.ok(screen.getByText(/Delivered at:/));
  assert.match(screen.getByText(/Trigger tag added: SA360::TRIGGER::NEW_LEAD/).textContent ?? "", /No direct workflow start API call was made/);
});
