import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ActionCenterPriorityList } from "./action-center-priority-list.tsx";
import type { PriorityCallItem } from "@/lib/action-center/types.ts";

const item: PriorityCallItem = {
  rank: 1,
  priorityScore: 90,
  contactIdGhl: "ghl_1",
  displayName: "Alex",
  phoneE164: "+15550001111",
  reason: "new reason from API",
  reasonCode: "brand_new_reason",
};

test("renders Unknown (RAW) for an unexpected reason code", () => {
  render(<ActionCenterPriorityList items={[item]} />);
  assert.ok(screen.getByText("Unknown (brand_new_reason)"));
  assert.ok(screen.getByText("Alex"));
  cleanup();
});

test("distinguishes unavailable priority leads from an empty queue", () => {
  render(<ActionCenterPriorityList items={[]} availability="unavailable" />);
  assert.ok(screen.getByText("Priority list unavailable"));
  assert.equal(screen.queryByText("No calls queued"), null);
  cleanup();
});

test("shows an empty-queue state when the API returned zero leads", () => {
  render(<ActionCenterPriorityList items={[]} availability="empty" />);
  assert.ok(screen.getByText("No calls queued"));
  assert.equal(screen.queryByText("Priority list unavailable"), null);
  cleanup();
});
