import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  fetchOrderReviewDetail,
  postOrderReviewAction,
  reviewActionPath,
} from "./lead-order-review-client";

describe("lead-order review client helpers", () => {
  it("posts confirm-payment and approve as distinct paths", () => {
    assert.match(
      reviewActionPath("ord_1", "confirm-payment"),
      /\/api\/front-office\/orders\/ord_1\/confirm-payment/
    );
    assert.match(reviewActionPath("ord_1", "approve"), /\/api\/front-office\/orders\/ord_1\/approve/);
    assert.match(
      reviewActionPath("ord_1", "mark-payment-not-required"),
      /\/api\/front-office\/orders\/ord_1\/mark-payment-not-required/
    );
  });

  it("returns 409 prerequisite errors without inventing success", async () => {
    const requestImpl = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: "payment_confirmation_required",
          reasons: ["payment_confirmation_required"],
        }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;

    const result = await postOrderReviewAction("ord_1", "approve", requestImpl);
    assert.equal(result.ok, false);
    assert.equal(result.status, 409);
    assert.equal(result.code, "payment_confirmation_required");
  });

  it("maps network failure to api unavailable", async () => {
    const requestImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as typeof fetch;
    const result = await postOrderReviewAction("ord_1", "confirm-payment", requestImpl);
    assert.equal(result.ok, false);
    assert.equal(result.status, 0);
    assert.equal(result.code, "api_unavailable");
  });

  it("refreshes the order after mutations", async () => {
    const requestImpl = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          order: { id: "ord_1", status: "submitted", paymentConfirmationStatus: "confirmed" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as typeof fetch;
    const result = await fetchOrderReviewDetail("ord_1", requestImpl);
    assert.equal(result.ok, true);
    assert.equal(result.order?.paymentConfirmationStatus, "confirmed");
  });
});
