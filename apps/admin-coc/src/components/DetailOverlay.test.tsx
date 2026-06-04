import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";

import { DetailOverlay } from "./DetailOverlay.tsx";

function ControlledOverlay({
  initialOpen = true,
  onOpenChange,
}: {
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <DetailOverlay
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange?.(next);
      }}
      title="Test detail"
      subtitle="Subtitle"
    >
      <p data-testid="detail-body">Body content</p>
      <button type="button">Inner action</button>
    </DetailOverlay>
  );
}

test.afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

test("DetailOverlay renders title and body when open", () => {
  render(<ControlledOverlay />);
  assert.ok(screen.getByRole("dialog"));
  assert.ok(screen.getByText("Test detail"));
  assert.ok(screen.getByTestId("detail-body"));
});

test("close button calls onOpenChange(false)", () => {
  let closed = false;
  render(<ControlledOverlay onOpenChange={(o) => { if (!o) closed = true; }} />);
  fireEvent.click(screen.getByLabelText("Close detail view"));
  assert.equal(closed, true);
});

test("Escape calls onOpenChange(false)", () => {
  let closed = false;
  render(<ControlledOverlay onOpenChange={(o) => { if (!o) closed = true; }} />);
  fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
  assert.equal(closed, true);
});

test("backdrop click calls onOpenChange(false)", () => {
  let closed = false;
  render(<ControlledOverlay onOpenChange={(o) => { if (!o) closed = true; }} />);
  const backdrop = document.querySelector('[data-testid="detail-overlay-backdrop"]');
  assert.ok(backdrop);
  fireEvent.click(backdrop!);
  assert.equal(closed, true);
});

test("card body click does not close", () => {
  let closed = false;
  render(<ControlledOverlay onOpenChange={(o) => { if (!o) closed = true; }} />);
  fireEvent.click(screen.getByTestId("detail-body"));
  assert.equal(closed, false);
});

test("long content stays inside scrollable body region", () => {
  render(
    <DetailOverlay open onOpenChange={() => {}} title="Scroll test">
      <div style={{ height: "4000px" }} data-testid="tall-block">
        tall
      </div>
    </DetailOverlay>
  );
  const tall = screen.getByTestId("tall-block");
  const scrollParent = tall.closest(".overflow-y-auto");
  assert.ok(scrollParent, "expected scrollable body wrapper");
});
