import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { BulkImportDestinationSelector } from "./bulk-import-destination-selector.tsx";
import type { BulkImportDestinationOption } from "@/app/actions/bulk-imports.ts";

const canonical: BulkImportDestinationOption = {
  clientAccountId: "smart_agent_360_demo",
  clientDisplayName: "Smart Agent 360 Demo",
  locationIdGhl: "VPuMIhN6JpxdoXvvlekZ",
  locationName: "Demo Location",
  readinessStatus: "ready",
  oauthStatus: "connected",
  readyForSimulation: true,
  readyForDirectCanary: true,
  blockers: [],
  isInitialCanaryTarget: true,
  canRunLiveCanary: true,
  liveCanaryBlockers: [],
};

const nonCanonical: BulkImportDestinationOption = {
  ...canonical,
  clientAccountId: "smart_agent_360_demo_2",
  clientDisplayName: "Smart Agent 360 Demo 2",
  isInitialCanaryTarget: false,
  canRunLiveCanary: false,
  liveCanaryBlockers: ["not_initial_canary_client"],
};

test.afterEach(() => {
  cleanup();
});

test("noncanonical demo client shows live-canary mismatch warning", () => {
  render(
    <BulkImportDestinationSelector
      options={[canonical, nonCanonical]}
      draft={{
        clientId: "smart_agent_360_demo_2",
        locationId: "VPuMIhN6JpxdoXvvlekZ",
      }}
      isDirty
      onDraftChange={() => {}}
    />
  );
  assert.ok(
    screen.getByText(/not the configured initial live-canary client/i)
  );
});

test("destination option missing blockers does not crash rendering", () => {
  const malformed = {
    ...canonical,
    blockers: undefined,
    liveCanaryBlockers: undefined,
  } as unknown as typeof canonical;
  render(
    <BulkImportDestinationSelector
      options={[malformed]}
      draft={{
        clientId: canonical.clientAccountId,
        locationId: canonical.locationIdGhl,
      }}
      isDirty={false}
      onDraftChange={() => {}}
    />
  );
  assert.ok(screen.getByText(/Readiness/i));
});

test("canonical client shows configured canary target message", () => {
  render(
    <BulkImportDestinationSelector
      options={[canonical, nonCanonical]}
      draft={{
        clientId: "smart_agent_360_demo",
        locationId: "VPuMIhN6JpxdoXvvlekZ",
      }}
      isDirty={false}
      onDraftChange={() => {}}
    />
  );
  assert.ok(screen.getByText(/Configured initial live-canary destination/i));
});

test("selector does not render a Save destination button", () => {
  render(
    <BulkImportDestinationSelector
      options={[canonical]}
      draft={{ clientId: "", locationId: "" }}
      isDirty={false}
      onDraftChange={() => {}}
    />
  );
  assert.equal(screen.queryByRole("button", { name: /save destination/i }), null);
});

test("manual ID button is type button", () => {
  render(
    <BulkImportDestinationSelector
      options={[canonical]}
      draft={{ clientId: "", locationId: "" }}
      isDirty={false}
      onDraftChange={() => {}}
    />
  );
  fireEvent.click(screen.getByText(/Advanced manual entry/i));
  const manualButton = screen.getByRole("button", { name: "Use manual IDs" });
  assert.equal(manualButton.getAttribute("type"), "button");
});
