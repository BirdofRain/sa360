import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { LeadOrder } from "@/lib/front-office/types";

import { FoOrderReviewActions } from "./fo-order-review-actions";

afterEach(() => {
  cleanup();
});

function pendingOrder(): LeadOrder {
  return {
    id: "ord_pending",
    orderNumber: "LO-1044",
    clientName: "Pacific Solar Co",
    niche: "Solar",
    states: ["AZ"],
    state: "AZ",
    volume: 400,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro",
    aiVoiceAddon: true,
    deliveryDestination: "GHL",
    status: "submitted",
    adminStatus: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
    createdAt: "2026-08-27T15:10:00.000Z",
    submittedAt: "2026-08-27T15:10:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("FoOrderReviewActions", () => {
  it("confirms payment through the dedicated confirm-payment operation", async () => {
    const calls: string[] = [];
    const confirmed = {
      ...pendingOrder(),
      paymentConfirmationStatus: "confirmed",
    };
    const requestImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/confirm-payment")) {
        return jsonResponse({ ok: true, order: confirmed });
      }
      return jsonResponse({ ok: true, order: confirmed });
    }) as typeof fetch;

    render(<FoOrderReviewActions order={pendingOrder()} requestImpl={requestImpl} />);
    fireEvent.click(screen.getByTestId("fo-review-action-confirm-payment"));
    await waitFor(() => {
      assert.ok(screen.getByTestId("fo-review-notice").textContent?.includes("Payment confirmed"));
    });
    assert.ok(calls.some((url) => url.endsWith("/confirm-payment")));
    assert.equal(calls.some((url) => url.endsWith("/approve")), false);
  });

  it("runs Confirm Payment & Approve as two sequential backend operations", async () => {
    const calls: string[] = [];
    const confirmed = { ...pendingOrder(), paymentConfirmationStatus: "confirmed" as const };
    const approved = {
      ...confirmed,
      status: "ready" as const,
      adminStatus: "ready" as const,
    };
    const requestImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/confirm-payment")) return jsonResponse({ ok: true, order: confirmed });
      if (url.endsWith("/approve")) return jsonResponse({ ok: true, order: approved });
      return jsonResponse({ ok: true, order: approved });
    }) as typeof fetch;

    render(<FoOrderReviewActions order={pendingOrder()} requestImpl={requestImpl} />);
    fireEvent.click(screen.getByTestId("fo-review-action-confirm-and-approve"));
    await waitFor(() => {
      assert.equal(
        screen.getByTestId("fo-review-notice").textContent,
        "Approved — ready for fulfillment"
      );
    });
    const confirmAt = calls.findIndex((url) => url.endsWith("/confirm-payment"));
    const approveAt = calls.findIndex((url) => url.endsWith("/approve"));
    assert.ok(confirmAt >= 0);
    assert.ok(approveAt > confirmAt);
  });

  it("shows payment confirmed, approval failed when approve returns 409", async () => {
    const confirmed = { ...pendingOrder(), paymentConfirmationStatus: "confirmed" as const };
    const requestImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/confirm-payment")) return jsonResponse({ ok: true, order: confirmed });
      if (url.endsWith("/approve")) {
        return jsonResponse(
          {
            ok: false,
            error: "order_not_approvable",
            reasons: ["order_not_approvable"],
          },
          409
        );
      }
      return jsonResponse({ ok: true, order: confirmed });
    }) as typeof fetch;

    render(<FoOrderReviewActions order={pendingOrder()} requestImpl={requestImpl} />);
    fireEvent.click(screen.getByTestId("fo-review-action-confirm-and-approve"));
    await waitFor(() => {
      assert.match(
        screen.getByTestId("fo-review-notice").textContent ?? "",
        /Payment confirmed, approval failed/
      );
    });
  });

  it("rejects approve while payment is still pending and keeps submitted state", async () => {
    const pending = pendingOrder();
    const requestImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/approve")) {
        return jsonResponse(
          {
            ok: false,
            error: "payment_confirmation_required",
            reasons: ["payment_confirmation_required"],
          },
          409
        );
      }
      return jsonResponse({ ok: true, order: pending });
    }) as typeof fetch;

    render(
      <FoOrderReviewActions
        order={{ ...pending, paymentConfirmationStatus: "confirmed" }}
        requestImpl={requestImpl}
      />
    );
    fireEvent.click(screen.getByTestId("fo-review-action-approve"));
    await waitFor(() => {
      assert.match(
        screen.getByTestId("fo-review-notice").textContent ?? "",
        /Payment must be confirmed or marked not required before approval/
      );
    });
    assert.equal(screen.queryByText("Approved — ready for fulfillment"), null);
  });

  it("treats repeating confirm on an already-confirmed order as the true state", async () => {
    const confirmed = { ...pendingOrder(), paymentConfirmationStatus: "confirmed" as const };
    const requestImpl = (async () => jsonResponse({ ok: true, order: confirmed })) as typeof fetch;
    render(<FoOrderReviewActions order={pendingOrder()} requestImpl={requestImpl} />);
    fireEvent.click(screen.getByTestId("fo-review-action-confirm-payment"));
    await waitFor(() => {
      assert.ok(screen.getByTestId("fo-review-notice").textContent?.includes("Payment confirmed"));
    });
    fireEvent.click(screen.getByTestId("fo-review-action-confirm-payment"));
    await waitFor(() => {
      assert.ok(screen.getByTestId("fo-review-notice").textContent?.includes("Payment confirmed"));
    });
  });

  it("renders approved ready state with fulfillment navigation and no activate shortcut", () => {
    render(
      <FoOrderReviewActions
        order={{
          ...pendingOrder(),
          status: "ready",
          adminStatus: "ready",
          paymentConfirmationStatus: "confirmed",
        }}
      />
    );
    assert.ok(screen.getByTestId("fo-approved-ready-banner"));
    assert.ok(screen.getByText("Approved — ready for fulfillment"));
    const link = screen.getByTestId("fo-fulfillment-ops-link") as HTMLAnchorElement;
    assert.equal(link.getAttribute("href"), "/fulfillment-ops?orderId=ord_pending");
    assert.equal(screen.queryByRole("button", { name: /^Activate$/i }), null);
    assert.equal(screen.queryByTestId("fo-review-action-confirm-and-approve"), null);
  });
});
