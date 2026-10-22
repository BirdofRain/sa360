import assert from "node:assert/strict";
import module from "node:module";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { COC_ORDERS_API } from "@/lib/front-office/api/lead-order-review-client";
import { getMockOrders } from "@/lib/front-office/mock/orders";

const originalLoad = (module as NodeModule & { _load: typeof module._load })._load;
(module as NodeModule & { _load: typeof module._load })._load = function (
  request: string,
  parent: NodeModule,
  isMain: boolean
) {
  if (request === "next/navigation") {
    return { useRouter: () => ({ refresh: () => undefined }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

afterEach(() => {
  cleanup();
});

describe("FoOrdersContent review queue", () => {
  it("defaults to the Alex review queue and can isolate each payment state", async () => {
    const { FoOrdersContent } = await import("./fo-orders-content.tsx");
    render(<FoOrdersContent initial={getMockOrders("admin")} role="admin" />);

    assert.ok(screen.getByText("LO-1044"));
    assert.ok(screen.getByText("LO-1043"));
    assert.ok(screen.getByText("LO-1042"));
    assert.ok(screen.getByText("LO-1040"));
    assert.equal(screen.queryByText("LO-1041"), null);

    fireEvent.change(screen.getByLabelText("Review queue"), {
      target: { value: "submitted_payment_pending" },
    });
    assert.ok(screen.getByText("LO-1044"));
    assert.equal(screen.queryByText("LO-1043"), null);

    fireEvent.change(screen.getByLabelText("Review queue"), {
      target: { value: "submitted_payment_confirmed" },
    });
    assert.ok(screen.getByText("LO-1043"));
    assert.equal(screen.queryByText("LO-1044"), null);

    fireEvent.change(screen.getByLabelText("Review queue"), {
      target: { value: "submitted_payment_not_required" },
    });
    assert.ok(screen.getByText("LO-1042"));

    fireEvent.change(screen.getByLabelText("Review queue"), {
      target: { value: "approved_ready" },
    });
    assert.ok(screen.getByText("LO-1040"));
    assert.ok(screen.getByTestId("fo-order-row-ORD-1040"));
    assert.equal(screen.queryByText("LO-1044"), null);
    assert.ok(
      screen.getAllByText("Approved / Ready").some((el) => el.tagName === "SPAN")
    );
  });

  it("uses a responsive admin filter layout", async () => {
    const { FoOrdersContent } = await import("./fo-orders-content.tsx");
    const { container } = render(
      <FoOrdersContent initial={getMockOrders("admin")} role="admin" />
    );
    const filterGrid = container.querySelector(".sm\\:grid-cols-2");
    assert.ok(filterGrid);
    assert.match(filterGrid?.className ?? "", /lg:grid-cols-4/);
  });

  it("shows a filter empty state without dropping the loaded orders", async () => {
    const { FoOrdersContent } = await import("./fo-orders-content.tsx");
    render(<FoOrdersContent initial={getMockOrders("admin")} role="admin" />);
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "not-a-client" } });
    assert.ok(screen.getByTestId("orders-filter-empty"));
    assert.equal(screen.queryByText("No orders yet"), null);
  });

  it("shows a load error instead of an empty success state", async () => {
    const { FoOrdersContent } = await import("./fo-orders-content.tsx");
    render(
      <FoOrdersContent
        initial={{ orders: [], dataSource: "live" }}
        role="admin"
        initialError="Admin API error (503): unavailable"
      />
    );
    assert.equal(screen.queryByText("No orders yet"), null);
    assert.match(screen.getByTestId("orders-list-error").textContent ?? "", /unavailable/);
    assert.equal(screen.queryByText("LO-1044"), null);
  });

  it("refreshes from the COC orders API and surfaces a refresh error", async () => {
    const calls: string[] = [];
    let finish: (value: Response) => void = () => undefined;
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    }) as typeof fetch;
    try {
      const { FoOrdersContent } = await import("./fo-orders-content.tsx");
      const { waitFor } = await import("@testing-library/react");
      render(
        <FoOrdersContent
          initial={getMockOrders("admin")}
          role="admin"
          ordersApiBase={COC_ORDERS_API}
        />
      );
      fireEvent.click(screen.getByTestId("orders-refresh"));
      assert.ok(screen.getByTestId("orders-list-loading"));
      finish(
        new Response(JSON.stringify({ ok: false, error: "Could not load orders." }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        })
      );
      await waitFor(() => {
        assert.match(screen.getByTestId("orders-list-error").textContent ?? "", /Could not load orders/);
      });
      assert.deepEqual(calls, [COC_ORDERS_API]);
      assert.ok(screen.getByText("LO-1044"));
    } finally {
      globalThis.fetch = original;
    }
  });
});
