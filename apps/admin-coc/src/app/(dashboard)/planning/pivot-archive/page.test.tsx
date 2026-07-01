import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import PivotArchivePage from "./page.tsx";

test.afterEach(() => {
  cleanup();
});

test("pivot archive page renders read-only historical header", () => {
  render(<PivotArchivePage />);
  assert.ok(screen.getByText("Pre-Pivot SA360 Archive"));
  assert.ok(screen.getByText("Archived / Read-only"));
  assert.ok(screen.getByText(/comparison only/i));
});

test("pivot archive comparison renders legacy and deprecated rows", () => {
  render(<PivotArchivePage />);
  assert.ok(screen.getAllByText("Legacy / Retainer Only").length >= 1);
  assert.ok(screen.getAllByText("Deprecated / Do Not Build").length >= 1);
  assert.ok(screen.getByText(/Blue\/Green channel orchestration expansion/i));
});
