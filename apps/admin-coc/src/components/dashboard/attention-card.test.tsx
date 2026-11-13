import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { AttentionCard, AttentionCardLoading } from "./attention-card.tsx";

test.afterEach(() => {
  cleanup();
});

test("a ready card shows the count and links to the filtered queue", () => {
  render(
    <AttentionCard
      title="Orders awaiting operator action"
      hint="Submitted payment states."
      emptyHint="None waiting."
      href="/orders?review=awaiting_action"
      read={{ state: "ready", count: 4 }}
      testId="attention-orders"
    />
  );
  assert.equal(screen.getByTestId("attention-orders-count").textContent, "4");
  assert.equal(
    screen.getByTestId("attention-orders").getAttribute("href"),
    "/orders?review=awaiting_action"
  );
  assert.equal(screen.queryByText("0"), null);
});

test("zero is shown only for a successful empty read", () => {
  render(
    <AttentionCard
      title="Source intake awaiting review"
      hint="needs_review"
      emptyHint="No source leads are waiting in needs_review."
      href="/source-intake?status=needs_review"
      read={{ state: "ready", count: 0 }}
      testId="attention-source-intake"
    />
  );
  assert.equal(screen.getByTestId("attention-source-intake-count").textContent, "0");
  assert.ok(screen.getByText("No source leads are waiting in needs_review."));
  assert.equal(
    screen.getByTestId("attention-source-intake").getAttribute("href"),
    "/source-intake?status=needs_review"
  );
});

test("unavailable does not show zero or a queue link", () => {
  render(
    <AttentionCard
      title="Orders awaiting operator action"
      hint="Submitted payment states."
      emptyHint="None waiting."
      href="/orders?review=awaiting_action"
      read={{ state: "unavailable", reason: "The orders queue is limited to administrators." }}
      testId="attention-orders"
    />
  );
  assert.ok(screen.getByTestId("attention-orders-unavailable"));
  assert.equal(screen.queryByTestId("attention-orders-count"), null);
  assert.equal(screen.queryByText("0"), null);
  assert.equal(screen.getByTestId("attention-orders").getAttribute("href"), null);
});

test("loading does not show a count", () => {
  render(<AttentionCardLoading title="Orders awaiting operator action" />);
  assert.ok(screen.getByText("Loading…"));
  assert.equal(screen.queryByText("0"), null);
});
