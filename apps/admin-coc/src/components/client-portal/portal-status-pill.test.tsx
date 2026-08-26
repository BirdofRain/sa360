import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { PortalStatusPill } from "./portal-status-pill.tsx";

test("status pills stay compact and content-sized", () => {
  const { container } = render(<PortalStatusPill label="Active" tone="good" />);
  const pill = container.querySelector("span");
  assert.ok(pill);
  assert.match(pill.className, /w-fit/);
  assert.match(pill.className, /self-start/);
  assert.match(pill.className, /max-w-full/);
  assert.match(pill.className, /inline-flex/);
  assert.ok(screen.getByText("Active"));
  cleanup();
});
