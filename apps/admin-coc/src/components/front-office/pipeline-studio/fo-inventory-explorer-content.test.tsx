import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { getInventoryExplorerFixture } from "@/lib/front-office/pipeline-studio/inventory-fixtures";
import { INVENTORY_EXPLORER_SAFETY_LINE } from "@/lib/front-office/pipeline-studio/inventory-types";

import { FoInventoryExplorerContent } from "./fo-inventory-explorer-content";

describe("FoInventoryExplorerContent", () => {
  it("renders compact snapshot strip with Trucker totals and unmapped notes", () => {
    try {
      render(
        <FoInventoryExplorerContent model={getInventoryExplorerFixture()} />
      );
      assert.equal(
        screen.getByTestId("inventory-explorer-notice").textContent,
        INVENTORY_EXPLORER_SAFETY_LINE
      );
      assert.match(
        screen.getByTestId("inventory-completeness-label").textContent ?? "",
        /Verified with geography notes/i
      );
      assert.match(
        screen.getByTestId("unmapped-geography-summary").textContent ?? "",
        /46 outside the supported map/
      );
      assert.match(
        screen.getByTestId("active-niche-label").textContent ?? "",
        /Inventory snapshot:\s*Truckers/
      );
      assert.equal(screen.queryByRole("heading", { name: /Lead Inventory Explorer/i, level: 2 }), null);
      assert.equal(screen.queryByText(/Publish Pipeline/i), null);
      assert.equal(screen.queryByTestId("ranked-row-AB"), null);
    } finally {
      cleanup();
    }
  });

  it("switches niches and updates snapshot disclosure totals", () => {
    try {
      render(
        <FoInventoryExplorerContent model={getInventoryExplorerFixture()} />
      );
      fireEvent.change(screen.getByTestId("filter-niche"), {
        target: { value: "VET" },
      });
      assert.match(
        screen.getByTestId("active-niche-label").textContent ?? "",
        /VET/
      );
      assert.match(
        screen.getByTestId("inventory-source-sheet").textContent ?? "",
        /Vet FEX/
      );
      assert.match(
        screen.getByTestId("unmapped-geography-summary").textContent ?? "",
        /255 outside the supported map/
      );
      assert.equal(
        screen.getByTestId("inventory-explorer").getAttribute("data-niche"),
        "VET"
      );
    } finally {
      cleanup();
    }
  });

  it("supports ranked list collapse/expand and search", () => {
    try {
      render(
        <FoInventoryExplorerContent model={getInventoryExplorerFixture()} />
      );
      const previewRows = screen.getAllByTestId(/^ranked-row-/);
      assert.ok(previewRows.length <= 12);
      assert.ok(previewRows.length > 0);

      fireEvent.click(screen.getByTestId("ranked-toggle-all"));
      const allRows = screen.getAllByTestId(/^ranked-row-/);
      assert.ok(allRows.length >= 50);

      fireEvent.change(screen.getByTestId("ranked-state-search"), {
        target: { value: "NC" },
      });
      const searched = screen.getAllByTestId(/^ranked-row-/);
      assert.ok(searched.some((el) => el.getAttribute("data-testid") === "ranked-row-NC"));
      assert.ok(searched.length < allRows.length);
    } finally {
      cleanup();
    }
  });

  it("opens the quote drawer locally without issuing a network request", () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    try {
      render(
        <FoInventoryExplorerContent model={getInventoryExplorerFixture()} />
      );
      fireEvent.change(screen.getByTestId("filter-quantity"), {
        target: { value: "5000" },
      });
      fireEvent.click(screen.getByTestId("map-state-NC"));
      fireEvent.click(screen.getByTestId("action-request-custom-fulfillment"));
      assert.ok(screen.getByTestId("inventory-quote-drawer"));
      const submit = screen.getByTestId("quote-submit-demo") as HTMLButtonElement;
      assert.equal(submit.disabled, true);
      fireEvent.click(submit);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      cleanup();
    }
  });

  it("exposes canCreateOrder and canReserveInventory as false", () => {
    const model = getInventoryExplorerFixture();
    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    try {
      render(<FoInventoryExplorerContent model={model} />);
      assert.match(
        screen.getByTestId("inventory-capabilities").textContent ?? "",
        /create order false/
      );
    } finally {
      cleanup();
    }
  });
});
