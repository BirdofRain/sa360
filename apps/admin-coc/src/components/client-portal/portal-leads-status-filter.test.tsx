import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalLeadsStatusFilter } from "./portal-leads-status-filter.tsx";

test("default All state marks All current and keeps Delivered shareable", () => {
  render(<PortalLeadsStatusFilter active="all" />);
  const all = screen.getByRole("link", { name: "All" });
  const delivered = screen.getByRole("link", { name: "Delivered" });
  assert.equal(all.getAttribute("href"), "/portal/leads");
  assert.equal(all.getAttribute("aria-current"), "page");
  assert.equal(delivered.getAttribute("href"), "/portal/leads?status=delivered");
  assert.equal(delivered.getAttribute("aria-current"), null);
  assert.ok(screen.getByRole("navigation", { name: "Lead status" }));
  cleanup();
});

test("supported status filter marks Delivered current", () => {
  render(<PortalLeadsStatusFilter active="delivered" />);
  assert.equal(screen.getByRole("link", { name: "Delivered" }).getAttribute("aria-current"), "page");
  assert.equal(screen.getByRole("link", { name: "All" }).getAttribute("aria-current"), null);
  cleanup();
});

test("filter pills wrap instead of forcing horizontal page overflow", () => {
  const { container } = render(<PortalLeadsStatusFilter active="all" />);
  const nav = container.querySelector("nav");
  assert.ok(nav);
  assert.match(nav.className, /flex-wrap/);
  assert.match(nav.className, /max-w-full/);
  cleanup();
});
