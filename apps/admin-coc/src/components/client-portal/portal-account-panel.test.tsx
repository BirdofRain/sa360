import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalAccountPanel } from "./portal-account-panel.tsx";

test.afterEach(() => {
  cleanup();
});

test("customer account panel shows profile and focus, not operational diagnostics", () => {
  render(
    <PortalAccountPanel
      displayName="Northwind"
      loginEmail="alex@example.com"
      nicheLabels={["vet", "trucker"]}
      productLabels={["aged"]}
    />
  );
  assert.ok(screen.getByText("Your account"));
  assert.ok(screen.getByText("Northwind"));
  assert.ok(screen.getByText("alex@example.com"));
  assert.ok(screen.getByText("Veteran · Trucker"));
  assert.ok(screen.getByText("Aged"));
  assert.equal(screen.queryByText("GHL Connection"), null);
  assert.equal(screen.queryByText("Needs attention"), null);
  assert.equal(screen.queryByText(/Preview data/i), null);
  assert.equal(screen.queryByText(/Account status/i), null);
  assert.equal(screen.queryByText(/Location/i), null);
  cleanup();
});

test("empty focus rows are omitted instead of showing operator placeholders", () => {
  render(
    <PortalAccountPanel displayName="Northwind" loginEmail="alex@example.com" />
  );
  assert.ok(screen.getByText("Northwind"));
  assert.equal(screen.queryByText("Lead focus"), null);
  assert.equal(screen.queryByText("Product types"), null);
  assert.equal(screen.queryByText("—"), null);
  cleanup();
});
