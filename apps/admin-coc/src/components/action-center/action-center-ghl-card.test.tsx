import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ActionCenterGhlCard } from "./action-center-ghl-card.tsx";

test("renders Unknown (RAW) for an unexpected connection status", () => {
  render(
    <ActionCenterGhlCard
      connection={{
        status: "unknown",
        rawStatus: "maintenance",
        locationId: "loc_1",
        locationName: "Main",
        lastSyncAt: null,
      }}
    />
  );
  assert.ok(screen.getByText("Unknown (maintenance)"));
  assert.ok(screen.getByText("Main"));
  cleanup();
});

test("keeps the card usable when connection details are unavailable", () => {
  render(
    <ActionCenterGhlCard
      availability="unavailable"
      connection={{
        status: "unknown",
        rawStatus: "unavailable",
        locationId: "",
        locationName: "Connection details unavailable",
        lastSyncAt: null,
      }}
    />
  );
  assert.ok(screen.getByText("GHL connection unavailable"));
  cleanup();
});
