import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { getInventoryExplorerFixture } from "@/lib/front-office/pipeline-studio/inventory-fixtures";
import { INVENTORY_EXPLORER_NOTICE } from "@/lib/front-office/pipeline-studio/inventory-types";

import { FoInventoryExplorerContent } from "./fo-inventory-explorer-content";

describe("FoInventoryExplorerContent", () => {
  it("renders inventory safety notice and explorer chrome", () => {
    render(<FoInventoryExplorerContent model={getInventoryExplorerFixture()} />);
    assert.equal(
      screen.getByTestId("inventory-explorer-notice").textContent,
      INVENTORY_EXPLORER_NOTICE
    );
    assert.ok(screen.getByText("Lead Inventory Explorer"));
    assert.ok(screen.getByTestId("inventory-explorer-map"));
    assert.equal(screen.queryByText(/Publish Pipeline/i), null);
    assert.equal(screen.queryByText(/Raleigh/i), null);
    assert.equal(screen.queryByText(/Power Dialer/i), null);
    cleanup();
  });

  it("opens the quote drawer locally without issuing a network request", () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("unexpected fetch");
    }) as typeof fetch;

    try {
      render(<FoInventoryExplorerContent model={getInventoryExplorerFixture()} />);
      fireEvent.click(screen.getByTestId("map-state-TX"));
      fireEvent.click(screen.getByTestId("action-request-inventory-review"));
      assert.ok(screen.getByTestId("inventory-quote-drawer"));
      assert.ok(
        screen.getByText(
          /Additional inventory may be available through manual stock review or new lead generation/i
        )
      );
      const submit = screen.getByTestId("quote-submit-demo") as HTMLButtonElement;
      assert.equal(submit.disabled, true);
      fireEvent.click(submit);
      assert.equal(fetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      cleanup();
    }
  });

  it("updates fulfillment when requested quantity changes", () => {
    render(<FoInventoryExplorerContent model={getInventoryExplorerFixture()} />);
    fireEvent.click(screen.getByTestId("map-state-NC"));
    assert.match(
      screen.getByTestId("inventory-state-detail").textContent ?? "",
      /Can fulfill|Strong coverage/
    );
    fireEvent.change(screen.getByTestId("filter-quantity"), {
      target: { value: "200" },
    });
    assert.match(
      screen.getByTestId("inventory-state-detail").textContent ?? "",
      /Partial fill|Custom review/
    );
    cleanup();
  });

  it("exposes canCreateOrder and canReserveInventory as false", () => {
    const model = getInventoryExplorerFixture();
    assert.equal(model.capabilities.canCreateOrder, false);
    assert.equal(model.capabilities.canReserveInventory, false);
    render(<FoInventoryExplorerContent model={model} />);
    assert.match(
      screen.getByTestId("inventory-capabilities").textContent ?? "",
      /create order false/
    );
    assert.match(
      screen.getByTestId("inventory-capabilities").textContent ?? "",
      /reserve false/
    );
    cleanup();
  });
});
