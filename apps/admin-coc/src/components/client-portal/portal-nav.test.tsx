import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalNavLinks } from "./portal-nav.tsx";

test("renders portal section links and marks the active page", () => {
  render(<PortalNavLinks pathname="/portal/orders" />);
  assert.ok(screen.getByRole("navigation", { name: "Portal" }));
  assert.ok(screen.getByRole("link", { name: "Overview" }));
  assert.ok(screen.getByRole("link", { name: "Orders" }));
  assert.ok(screen.getByRole("link", { name: "Leads" }));
  assert.ok(screen.getByRole("link", { name: "Account" }));
  assert.equal(screen.getByRole("link", { name: "Orders" }).getAttribute("aria-current"), "page");
  assert.equal(screen.getByRole("link", { name: "Overview" }).getAttribute("aria-current"), null);
  cleanup();
});
