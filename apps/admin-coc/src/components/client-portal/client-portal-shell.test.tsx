import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { emptyPortalAccountSnapshot } from "@/lib/client-portal/map-client-summary";

import { ClientPortalShell } from "./client-portal-shell.tsx";

test("unavailable dashboard shows an honest empty state instead of sample metrics", () => {
  render(<ClientPortalShell dashboard={null} snapshot={emptyPortalAccountSnapshot()} />);
  assert.ok(screen.getByText("Performance metrics unavailable"));
  assert.equal(screen.queryByText("Lead funnel"), null);
  cleanup();
});
