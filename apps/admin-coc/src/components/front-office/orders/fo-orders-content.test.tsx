import assert from "node:assert/strict";
import module from "node:module";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
    assert.ok(screen.getByText("Approved / Ready"));
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
});
