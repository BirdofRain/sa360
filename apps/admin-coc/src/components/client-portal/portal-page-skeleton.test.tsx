import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalPageSkeleton } from "./portal-page-skeleton.tsx";

test("order detail loading skeleton is announced to assistive tech", () => {
  render(<PortalPageSkeleton label="Loading order" cards={3} />);
  assert.ok(screen.getByRole("status"));
  assert.ok(screen.getByText("Loading order"));
  cleanup();
});
