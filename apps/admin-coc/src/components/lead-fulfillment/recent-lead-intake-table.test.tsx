import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { RecentLeadIntakeTable } from "./recent-lead-intake-table.tsx";
import type { RecentLeadIntakeRow } from "@/lib/lead-fulfillment/types";

const sampleRows: RecentLeadIntakeRow[] = [
  {
    leadUid: "LF-TEST-001",
    sourceLane: "Vendor CSV",
    state: "TX",
    niche: "Solar",
    proofStatus: "attached",
    verificationStatus: "passed",
    inventoryStatus: "available",
    createdAt: "2026-06-30T12:00:00.000Z",
  },
];

test("RecentLeadIntakeTable renders column headers and lead UID", () => {
  render(<RecentLeadIntakeTable rows={sampleRows} />);
  assert.ok(screen.getByText("Lead UID"));
  assert.ok(screen.getByText("Source lane"));
  assert.ok(screen.getByText("LF-TEST-001"));
  cleanup();
});

test("RecentLeadIntakeTable shows reused inventory instead of INTAKE ONLY", () => {
  render(
    <RecentLeadIntakeTable
      rows={[
        {
          ...sampleRows[0]!,
          leadUid: "uid-reused",
          inventoryStatus: "FRESH_HOLD",
          inventoryLifecycleLabel: "Inventory reused · FRESH — HOLD",
          inventoryTrackingLabel: "Inventory reused",
          inventoryTrackingDetail: "Existing item on another source event",
          canonicalInventoryOnOtherEvent: true,
        },
      ]}
    />
  );
  assert.ok(screen.getByText("Inventory reused"));
  assert.ok(screen.getByText("Existing item on another source event"));
  assert.ok(screen.getByText("Inventory reused · FRESH — HOLD"));
  assert.equal(screen.queryByText("INTAKE ONLY"), null);
  assert.ok(screen.getByText("2026-06-30T12:00:00.000Z"));
  assert.ok(screen.getByText("Jun 30, 2026, 12:00:00 UTC"));
  cleanup();
});

test("RecentLeadIntakeTable shows empty state when no rows", () => {
  render(<RecentLeadIntakeTable rows={[]} />);
  assert.ok(screen.getByText("No recent intake"));
  cleanup();
});
