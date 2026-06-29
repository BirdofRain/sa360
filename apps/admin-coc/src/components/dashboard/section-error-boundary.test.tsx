import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

import { SectionErrorBoundary } from "./section-error-boundary.tsx";

function Boom(): React.ReactElement {
  throw new Error("delivery plan exploded");
}

test("renders children when they do not throw", () => {
  render(
    <SectionErrorBoundary title="Delivery plan">
      <p>healthy section</p>
    </SectionErrorBoundary>
  );
  assert.ok(screen.getByText("healthy section"));
  cleanup();
});

test("isolates a throwing child as an inline warning instead of crashing", () => {
  // React logs the caught error to console.error; silence it for a clean test run.
  const originalError = console.error;
  console.error = () => {};
  try {
    render(
      <SectionErrorBoundary title="Delivery plan">
        <Boom />
      </SectionErrorBoundary>
    );
  } finally {
    console.error = originalError;
  }
  assert.ok(screen.getByText("Delivery plan could not be displayed"));
  assert.ok(screen.getByText("delivery plan exploded"));
  cleanup();
});
