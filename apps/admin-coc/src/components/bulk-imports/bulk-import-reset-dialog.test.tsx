import assert from "node:assert/strict";
import test from "node:test";
import { BULK_IMPORT_RESET_CONFIRMATION } from "@sa360/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";

import { BulkImportResetDialog } from "./bulk-import-reset-dialog.tsx";

function ResetDialogHarness({
  initialOpen = true,
  onConfirm = () => {},
}: {
  initialOpen?: boolean;
  onConfirm?: () => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [resetTarget, setResetTarget] = useState<"mapping" | "destination" | "review">("mapping");
  const [confirmation, setConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open reset
      </button>
      <BulkImportResetDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setConfirmation("");
            setError(null);
          }
        }}
        importId="batch-1"
        resetTarget={resetTarget}
        onResetTargetChange={setResetTarget}
        confirmation={confirmation}
        onConfirmationChange={setConfirmation}
        loading={loading}
        error={error}
        onConfirm={() => {
          onConfirm();
          if (confirmation.trim() === BULK_IMPORT_RESET_CONFIRMATION) {
            setOpen(false);
            setConfirmation("");
          } else {
            setError("Reset failed");
            setLoading(false);
          }
        }}
      />
      <span data-testid="harness-confirmation">{confirmation}</span>
    </>
  );
}

test.afterEach(() => {
  cleanup();
});

test("reset dialog opens and confirmation input receives initial focus", () => {
  render(<ResetDialogHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation");
  assert.equal(document.activeElement, input);
});

test("typing multiple characters keeps focus in the confirmation input", () => {
  render(<ResetDialogHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;

  assert.equal(document.activeElement, input);

  fireEvent.change(input, { target: { value: "R" } });
  assert.equal(document.activeElement, input);
  fireEvent.change(input, { target: { value: "RE" } });
  assert.equal(document.activeElement, input);
  fireEvent.change(input, { target: { value: "RESET" } });
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "RESET");
});

test("typing the full phrase enables confirm without losing focus", () => {
  render(<ResetDialogHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;
  const confirmButton = screen.getByRole("button", { name: "Confirm" });

  assert.equal(document.activeElement, input);

  fireEvent.change(input, { target: { value: BULK_IMPORT_RESET_CONFIRMATION } });
  assert.equal(document.activeElement, input);
  assert.equal(confirmButton.hasAttribute("disabled"), false);
});

test("pasting the confirmation phrase works", () => {
  render(<ResetDialogHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;

  fireEvent.change(input, { target: { value: BULK_IMPORT_RESET_CONFIRMATION } });
  assert.equal(input.value, BULK_IMPORT_RESET_CONFIRMATION);
  assert.equal(screen.getByRole("button", { name: "Confirm" }).hasAttribute("disabled"), false);
});

test("dropdown selection does not remount the input", () => {
  render(<ResetDialogHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;
  const select = screen.getByTestId("bulk-import-reset-target") as HTMLSelectElement;

  fireEvent.change(input, { target: { value: "RESET B" } });
  fireEvent.change(select, { target: { value: "destination" } });

  const nextInput = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;
  assert.equal(select.value, "destination");
  assert.equal(nextInput.value, "");
  fireEvent.focus(nextInput);
  fireEvent.change(nextInput, { target: { value: "RESET B" } });
  assert.equal(document.activeElement, nextInput);
  assert.equal(nextInput.value, "RESET B");
});

test("confirmation state persists across normal rerenders", async () => {
  function StatefulHarness() {
    const [, bump] = useState(0);
    return (
      <>
        <button type="button" onClick={() => bump((n) => n + 1)}>
          Rerender parent
        </button>
        <ResetDialogHarness />
      </>
    );
  }

  render(<StatefulHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;

  fireEvent.change(input, { target: { value: "RESET BULK" } });
  fireEvent.click(screen.getByRole("button", { name: "Rerender parent" }));

  const nextInput = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;
  assert.equal(nextInput.value, "RESET BULK");
});

test("confirm enables only on exact phrase match", () => {
  render(<ResetDialogHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation");
  const confirmButton = screen.getByRole("button", { name: "Confirm" });

  assert.equal(confirmButton.hasAttribute("disabled"), true);
  fireEvent.change(input, { target: { value: "reset bulk import" } });
  assert.equal(confirmButton.hasAttribute("disabled"), true);
  assert.ok(screen.getByText("Confirmation phrase does not match."));
  fireEvent.change(input, { target: { value: BULK_IMPORT_RESET_CONFIRMATION } });
  assert.equal(confirmButton.hasAttribute("disabled"), false);
});

test("closing and reopening clears confirmation", async () => {
  render(<ResetDialogHarness initialOpen={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Open reset" }));

  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "RESET BULK" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  assert.equal(screen.queryByTestId("bulk-import-reset-confirmation"), null);

  fireEvent.click(screen.getByRole("button", { name: "Open reset" }));
  const reopened = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;
  assert.equal(reopened.value, "");
});

test("failed API response keeps dialog open and input usable", async () => {
  function FailingHarness() {
    const [open, setOpen] = useState(true);
    const [confirmation, setConfirmation] = useState(BULK_IMPORT_RESET_CONFIRMATION);
    const [error, setError] = useState<string | null>(null);

    return (
      <BulkImportResetDialog
        open={open}
        onOpenChange={setOpen}
        importId="batch-1"
        resetTarget="mapping"
        onResetTargetChange={() => {}}
        confirmation={confirmation}
        onConfirmationChange={setConfirmation}
        loading={false}
        error={error}
        onConfirm={() => setError("Reset failed")}
      />
    );
  }

  render(<FailingHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;

  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  assert.ok(screen.getByTestId("bulk-import-reset-dialog"));
  assert.ok(screen.getByText("Reset failed"));

  fireEvent.change(input, { target: { value: "RESET BULK IMPORT!" } });
  assert.equal(document.activeElement, input);
  assert.equal(input.value, "RESET BULK IMPORT!");
});

test("successful reset closes the dialog", async () => {
  render(<ResetDialogHarness />);
  const input = screen.getByTestId("bulk-import-reset-confirmation") as HTMLInputElement;

  fireEvent.change(input, { target: { value: BULK_IMPORT_RESET_CONFIRMATION } });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  assert.equal(screen.queryByTestId("bulk-import-reset-dialog"), null);
});

test("dialog fits a narrow viewport", () => {
  render(<ResetDialogHarness />);
  const dialog = screen.getByRole("dialog") as HTMLElement;
  assert.equal(dialog.style.maxHeight, "calc(100vh - 48px)");
  assert.ok(dialog.className.includes("w-full"));
  assert.ok(dialog.querySelector(".overflow-y-auto"));
});
