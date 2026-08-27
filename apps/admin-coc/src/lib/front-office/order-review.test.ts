import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { LeadOrder } from "./types";
import {
  availableReviewActions,
  fulfillmentOpsHref,
  hasActivateShortcut,
  mapReviewApiError,
  matchesReviewQueueFilter,
  resolveReviewQueueKey,
  reviewQueueLabel,
  runConfirmAndApprove,
} from "./order-review";

function order(overrides: Partial<LeadOrder> = {}): LeadOrder {
  return {
    id: "ord_1",
    orderNumber: "LO-1001",
    clientName: "Pacific Solar Co",
    clientAccountId: "acct_pacific",
    niche: "Solar",
    states: ["AZ"],
    state: "AZ",
    volume: 100,
    campaignType: "Aged leads",
    crmPackage: "GHL Pro",
    aiVoiceAddon: false,
    deliveryDestination: "GHL",
    status: "submitted",
    adminStatus: "submitted",
    paymentConfirmationStatus: "pending_confirmation",
    createdAt: "2026-08-27T12:00:00.000Z",
    submittedAt: "2026-08-27T12:00:00.000Z",
    ...overrides,
  };
}

describe("Front Office order review queue", () => {
  it("labels submitted / payment pending", () => {
    const row = order();
    assert.equal(resolveReviewQueueKey(row), "submitted_payment_pending");
    assert.equal(reviewQueueLabel(row), "Submitted / Payment pending");
  });

  it("labels submitted / payment confirmed", () => {
    const row = order({ paymentConfirmationStatus: "confirmed" });
    assert.equal(resolveReviewQueueKey(row), "submitted_payment_confirmed");
    assert.equal(reviewQueueLabel(row), "Submitted / Payment confirmed");
  });

  it("labels submitted / payment not required", () => {
    const row = order({ paymentConfirmationStatus: "not_required" });
    assert.equal(resolveReviewQueueKey(row), "submitted_payment_not_required");
    assert.equal(reviewQueueLabel(row), "Submitted / Payment not required");
  });

  it("labels approved / ready", () => {
    const row = order({
      status: "ready",
      adminStatus: "ready",
      paymentConfirmationStatus: "confirmed",
      approvedAt: "2026-08-27T13:00:00.000Z",
    });
    assert.equal(resolveReviewQueueKey(row), "approved_ready");
    assert.equal(reviewQueueLabel(row), "Approved / Ready");
  });

  it("review filter includes the four Alex states only", () => {
    assert.equal(matchesReviewQueueFilter(order(), "review"), true);
    assert.equal(
      matchesReviewQueueFilter(order({ paymentConfirmationStatus: "confirmed" }), "review"),
      true
    );
    assert.equal(
      matchesReviewQueueFilter(order({ paymentConfirmationStatus: "not_required" }), "review"),
      true
    );
    assert.equal(
      matchesReviewQueueFilter(order({ status: "ready", adminStatus: "ready" }), "review"),
      true
    );
    assert.equal(
      matchesReviewQueueFilter(order({ status: "active", adminStatus: "active" }), "review"),
      false
    );
  });
});

describe("availableReviewActions", () => {
  it("offers combined confirm + approve for pending paid orders", () => {
    assert.deepEqual(availableReviewActions(order()), [
      "confirm-and-approve",
      "confirm-payment",
      "mark-payment-not-required",
    ]);
  });

  it("offers approve after payment is confirmed or not required", () => {
    assert.deepEqual(
      availableReviewActions(order({ paymentConfirmationStatus: "confirmed" })),
      ["approve"]
    );
    assert.deepEqual(
      availableReviewActions(order({ paymentConfirmationStatus: "not_required" })),
      ["approve"]
    );
  });

  it("hides payment/approve actions on approved orders", () => {
    assert.deepEqual(
      availableReviewActions(
        order({ status: "ready", adminStatus: "ready", paymentConfirmationStatus: "confirmed" })
      ),
      []
    );
  });

  it("does not offer an activate action", () => {
    const labels = availableReviewActions(order()).concat(
      availableReviewActions(order({ paymentConfirmationStatus: "confirmed" }))
    );
    assert.equal(hasActivateShortcut(labels), false);
  });
});

describe("mapReviewApiError", () => {
  it("maps payment prerequisite 409 without inventing success", () => {
    assert.equal(
      mapReviewApiError({
        status: 409,
        error: "payment_confirmation_required",
        code: "payment_confirmation_required",
        reasons: ["payment_confirmation_required"],
      }),
      "Payment must be confirmed or marked not required before approval."
    );
  });

  it("maps API unavailable", () => {
    assert.equal(
      mapReviewApiError({ status: 503, error: "bad gateway" }),
      "API unavailable. Refresh and try again."
    );
  });

  it("maps stale 409s honestly", () => {
    assert.match(
      mapReviewApiError({ status: 409, error: "order_not_approvable" }),
      /cannot be approved/
    );
  });
});

describe("runConfirmAndApprove", () => {
  it("calls confirm then approve as two operations", async () => {
    const calls: string[] = [];
    const pending = order();
    const confirmed = order({ paymentConfirmationStatus: "confirmed" });
    const approved = order({
      status: "ready",
      adminStatus: "ready",
      paymentConfirmationStatus: "confirmed",
    });
    const result = await runConfirmAndApprove({
      confirm: async () => {
        calls.push("confirm-payment");
        return { ok: true, order: confirmed };
      },
      approve: async () => {
        calls.push("approve");
        return { ok: true, order: approved };
      },
    });
    assert.deepEqual(calls, ["confirm-payment", "approve"]);
    assert.equal(result.outcome, "approved");
    assert.equal(result.message, "Approved — ready for fulfillment");
    assert.equal(pending.id, result.order?.id);
  });

  it("shows payment confirmed, approval failed when approve 409s", async () => {
    const confirmed = order({ paymentConfirmationStatus: "confirmed" });
    const result = await runConfirmAndApprove({
      confirm: async () => ({ ok: true, order: confirmed }),
      approve: async () => ({
        ok: false,
        status: 409,
        error: "order_not_approvable",
        code: "order_not_approvable",
        reasons: ["order_not_approvable"],
        order: confirmed,
      }),
    });
    assert.equal(result.outcome, "payment_confirmed_approval_failed");
    assert.match(result.message, /Payment confirmed, approval failed/);
    assert.equal(result.order?.paymentConfirmationStatus, "confirmed");
    assert.equal(result.order?.status, "submitted");
  });

  it("does not call approve when confirm fails", async () => {
    let approveCalled = false;
    const result = await runConfirmAndApprove({
      confirm: async () => ({ ok: false, status: 503, error: "down" }),
      approve: async () => {
        approveCalled = true;
        return { ok: true, order: order({ status: "ready", adminStatus: "ready" }) };
      },
    });
    assert.equal(approveCalled, false);
    assert.equal(result.outcome, "confirm_failed");
  });

  it("treats idempotent already-approved approve as the true state", async () => {
    const ready = order({
      status: "ready",
      adminStatus: "ready",
      paymentConfirmationStatus: "confirmed",
    });
    const result = await runConfirmAndApprove({
      confirm: async () => ({ ok: true, order: ready }),
      approve: async () => ({ ok: true, order: ready }),
    });
    assert.equal(result.outcome, "approved");
    assert.equal(result.message, "Approved — ready for fulfillment");
  });
});

describe("fulfillment navigation", () => {
  it("links approved orders to the existing fulfillment-ops seat", () => {
    assert.equal(fulfillmentOpsHref("ord_1"), "/fulfillment-ops?orderId=ord_1");
  });
});
