import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { RoadmapBoundaryCard } from "./roadmap-boundary-card.tsx";

test("RoadmapBoundaryCard renders legacy and deprecated sections", () => {
  render(<RoadmapBoundaryCard />);
  assert.ok(screen.getByText("Legacy / Retainer Only"));
  assert.ok(screen.getByText("Deprecated / Do Not Build"));
  assert.ok(screen.getByText("Existing CRM support"));
  assert.ok(screen.getByText("Orion-style front-end AI/CRM clone"));
  cleanup();
});
