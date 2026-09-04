import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import PortalAccountLoading from "./loading.tsx";

test("account route loading UI is announced for initial navigation", () => {
  render(<PortalAccountLoading />);
  assert.ok(screen.getByRole("status"));
  assert.ok(screen.getByText("Loading account"));
  cleanup();
});
