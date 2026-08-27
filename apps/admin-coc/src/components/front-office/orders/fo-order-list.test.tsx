import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { getMockOrders } from "@/lib/front-office/mock/orders";

import { FoOrderList } from "./fo-order-list";

afterEach(() => {
  cleanup();
});

describe("FoOrderList review queue", () => {
  it("renders pending, confirmed, not-required, and approved queue labels", () => {
    const { orders } = getMockOrders("admin");
    render(<FoOrderList orders={orders} />);

    assert.ok(screen.getByText("Submitted / Payment pending"));
    assert.ok(screen.getByText("Submitted / Payment confirmed"));
    assert.ok(screen.getByText("Submitted / Payment not required"));
    assert.ok(screen.getByText("Approved / Ready"));
    assert.ok(screen.getByText("LO-1044"));
    assert.ok(screen.getByText("Pacific Solar Co"));
    assert.equal(screen.queryByText("Activate"), null);
  });

  it("uses existing customer and order identity columns", () => {
    const { orders } = getMockOrders("admin");
    render(<FoOrderList orders={orders.slice(0, 1)} />);
    assert.ok(screen.getByText("LO-1044"));
    assert.ok(screen.getByText("Pacific Solar Co"));
    assert.ok(screen.getByText("Solar"));
  });
});
