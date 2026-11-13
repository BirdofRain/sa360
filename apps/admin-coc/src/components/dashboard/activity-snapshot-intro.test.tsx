import assert from "node:assert/strict";
import test from "node:test";
import { cleanup, render, screen } from "@testing-library/react";

import { ActivitySnapshotIntro } from "./activity-snapshot-intro.tsx";
import { AttentionCard } from "./attention-card.tsx";

test.afterEach(() => {
  cleanup();
});

test("activity snapshot does not mention the omitted leads-received-today count", () => {
  render(<ActivitySnapshotIntro />);
  assert.equal(screen.getByRole("heading", { name: "Activity" }).textContent, "Activity");
  assert.match(screen.getByText(/Refresh times use America\/New_York/).textContent ?? "", /America\/New_York/);
  assert.equal(screen.queryByText(/Leads received today/), null);
  assert.equal(screen.queryByTestId("activity-leads-today-gap"), null);
  assert.equal(screen.queryByTestId("activity-leads-today"), null);
  assert.equal(screen.queryByTestId("activity-leads-today-count"), null);
});

test("a delivery failure card shows the count, queue, and Eastern refresh time", () => {
  render(
    <AttentionCard
      title="Source Intake delivery failures"
      hint="Source leads in delivery_failed."
      emptyHint="No source leads are waiting in delivery_failed."
      href="/source-intake?status=delivery_failed"
      read={{ state: "ready", count: 2 }}
      detail="Refreshed Jan 15, 2026, 12:00 AM EST"
      testId="activity-delivery-failures"
    />
  );
  assert.equal(screen.getByTestId("activity-delivery-failures-count").textContent, "2");
  assert.equal(
    screen.getByTestId("activity-delivery-failures").getAttribute("href"),
    "/source-intake?status=delivery_failed"
  );
  assert.equal(
    screen.getByTestId("activity-delivery-failures-refreshed").textContent,
    "Refreshed Jan 15, 2026, 12:00 AM EST"
  );
});

test("an unavailable delivery failure card has no count, link, or refresh time", () => {
  render(
    <AttentionCard
      title="Source Intake delivery failures"
      hint="Source leads in delivery_failed."
      emptyHint="No source leads are waiting in delivery_failed."
      href="/source-intake?status=delivery_failed"
      read={{ state: "unavailable", reason: "Admin API error (503): unavailable" }}
      detail="Refreshed Jan 15, 2026, 12:00 AM EST"
      testId="activity-delivery-failures"
    />
  );
  assert.ok(screen.getByTestId("activity-delivery-failures-unavailable"));
  assert.equal(screen.queryByTestId("activity-delivery-failures-count"), null);
  assert.equal(screen.queryByTestId("activity-delivery-failures-refreshed"), null);
  assert.equal(screen.getByTestId("activity-delivery-failures").getAttribute("href"), null);
});
