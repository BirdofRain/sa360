import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MarkSpreadsheetDeliveredDialog } from "./mark-spreadsheet-delivered-dialog.tsx";

afterEach(() => {
  cleanup();
});

describe("MarkSpreadsheetDeliveredDialog", () => {
  it("first render of the open button target does not write; Cancel does not confirm", () => {
    let confirmed = 0;
    render(
      <MarkSpreadsheetDeliveredDialog
        open
        clientLabel="Smart Agent 360 Demo"
        orderNumber="LO-1048"
        niche="VET"
        bucketLabel="9–12 Months"
        rowCount={1}
        onCancel={() => undefined}
        onConfirm={() => {
          confirmed += 1;
        }}
      />
    );
    assert.ok(screen.getByText("Approve & Release"));
    assert.ok(screen.getByText("Smart Agent 360 Demo"));
    assert.ok(screen.getByText("LO-1048"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    assert.equal(confirmed, 0);
  });

  it("Approve & Release is the only action that invokes onConfirm", () => {
    let confirmed = 0;
    render(
      <MarkSpreadsheetDeliveredDialog
        open
        clientLabel="Client"
        orderNumber="LO-1"
        niche="VET"
        bucketLabel="3–6 Months"
        rowCount={2}
        onCancel={() => undefined}
        onConfirm={() => {
          confirmed += 1;
        }}
      />
    );
    fireEvent.click(screen.getByTestId("confirm-delivery-button"));
    assert.equal(confirmed, 1);
    assert.ok(screen.getByText(/Approve & Release — 2 Leads/));
  });
});
