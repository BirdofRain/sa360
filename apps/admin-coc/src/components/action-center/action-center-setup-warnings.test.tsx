import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ActionCenterSetupWarnings } from "./action-center-setup-warnings.tsx";

test("missing setup warnings render as unavailable, not as no notes", () => {
  render(<ActionCenterSetupWarnings warnings={[]} availability="unavailable" />);
  assert.ok(screen.getByText("Setup notes unavailable"));
  assert.equal(screen.queryByText("Setup & data notes"), null);
  cleanup();
});

test("empty setup warnings render nothing", () => {
  const { container } = render(<ActionCenterSetupWarnings warnings={[]} availability="empty" />);
  assert.equal(container.textContent, "");
  cleanup();
});
