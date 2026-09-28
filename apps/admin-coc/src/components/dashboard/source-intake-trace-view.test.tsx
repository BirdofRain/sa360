import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import type { AdminSourceIntakeTrace } from "@/lib/admin-api/types";

import { SourceIntakeTraceView } from "./source-intake-trace-view.tsx";

const SECRET_PHONE = "+15550177099";
const SECRET_EMAIL = "observer.hidden@example.test";

function trace(outcome: string): AdminSourceIntakeTrace {
  return {
    ok: true,
    readOnly: true,
    hasDestinationClient: false,
    destinationClientAccountId: null,
    webhookRequestLog: null,
    sourceLeadEvent: {
      id: "evt_cross",
      sourceProvider: "manual_import",
      sourceSystem: "csv_import",
      sourceType: "bulk_import",
      sourceRouteKey: null,
      sourceLeadId: "lead_cross",
      sourceLeadUid: null,
      status: "normalized",
      receivedAt: "2026-02-01T00:00:00.000Z",
      normalizedAt: null,
      clientAccountIdResolved: null,
      webhookRequestLogId: null,
      sourceFunnelName: null,
    },
    relatedSourceEventIds: [],
    sourceFunnel: null,
    inventoryItem: {
      id: "item_canonical",
      status: "pending_review",
      generatedAt: "2026-01-01T00:00:00.000Z",
      normalizedState: "NC",
      nicheKey: "unspecified",
      sourceLane: "leadcapture_io",
      sourceLeadEventId: "evt_owner",
      commerceExcluded: false,
      onOtherSourceEvent: true,
    },
    inventoryTracking: {
      diagnostic: "reused",
      outcome,
      label: "Inventory reused",
      detail: "Existing item on another source event",
      inventoryItemId: "item_canonical",
    },
  };
}

test("observer trace view shows cross-source reuse without contact data", () => {
  const view = render(<SourceIntakeTraceView trace={trace("reused_phone")} />);
  assert.ok(screen.getByText("reused_phone"));
  assert.ok(screen.getByText("Existing item on another source event"));
  assert.ok(screen.getByText("yes"));
  assert.ok(screen.getByText(/omits payloads, names, phones, and emails/i));
  const text = view.container.textContent ?? "";
  assert.equal(text.includes(SECRET_PHONE), false);
  assert.equal(text.includes(SECRET_EMAIL), false);
  cleanup();
});

test("observer trace view drops an unrecognized tracking outcome", () => {
  const poisoned = `${SECRET_EMAIL} ${SECRET_PHONE}`;
  const view = render(<SourceIntakeTraceView trace={trace(poisoned)} />);
  assert.equal(screen.getAllByText("Inventory reused").length >= 1, true);
  const text = view.container.textContent ?? "";
  assert.equal(text.includes(poisoned), false);
  assert.equal(text.includes(SECRET_EMAIL), false);
  assert.equal(text.includes(SECRET_PHONE), false);
  cleanup();
});
