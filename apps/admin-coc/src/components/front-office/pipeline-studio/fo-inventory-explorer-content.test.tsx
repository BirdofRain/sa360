import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { getInventoryExplorerFixture } from "@/lib/front-office/pipeline-studio/inventory-fixtures";
import { INVENTORY_EXPLORER_NOTICE } from "@/lib/front-office/pipeline-studio/inventory-types";

import { FoInventoryExplorerContent } from "./fo-inventory-explorer-content";

describe("FoInventoryExplorerContent", () => {
  it("renders complete-with-warnings status and unmapped disclosure for Trucker", () => {
    try {
      render(
        <FoInventoryExplorerContent model={getInventoryExplorerFixture()} />
      );
      assert.equal(
        screen.getByTestId("inventory-explorer-notice").textContent,
        INVENTORY_EXPLORER_NOTICE
      );
      assert.match(
        screen.getByTestId("inventory-completeness-label").textContent ?? "",
        /Complete snapshot with geography warnings/i
      );
      assert.match(
        screen.getByTestId("unmapped-geography-summary").textContent ?? "",
        /Unmapped geography inventory:\s*46 leads/
      );
      assert.match(
        screen.getByTestId("unmapped-geography-help").textContent ?? "",
        /outside the supported 50-state \+ DC map/i
      );
      assert.match(
        screen.getByTestId("active-niche-label").textContent ?? "",
        /Truckers/
      );
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
        /Unmapped geography inventory:\s*255 leads/
      );
      assert.equal(
        screen.getByTestId("inventory-explorer").getAttribute("data-niche"),
        "VET"
      );
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
