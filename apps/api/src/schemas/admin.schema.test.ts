import test from "node:test";
import assert from "node:assert/strict";
import { resolveSummaryDateRange } from "./admin.schema.js";

test("resolveSummaryDateRange: both omitted → ~7d window ending now", () => {
  const { from, to } = resolveSummaryDateRange();
  const spanMs = to.getTime() - from.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(spanMs >= sevenDays - 60_000 && spanMs <= sevenDays + 60_000);
  assert.ok(to.getTime() <= Date.now() + 1);
});

test("resolveSummaryDateRange: both provided validates order", () => {
  const { from, to } = resolveSummaryDateRange(
    "2025-01-01T00:00:00.000Z",
    "2025-01-10T00:00:00.000Z"
  );
  assert.equal(from.toISOString(), "2025-01-01T00:00:00.000Z");
  assert.equal(to.toISOString(), "2025-01-10T00:00:00.000Z");
});

test("resolveSummaryDateRange: from after to throws", () => {
  assert.throws(
    () =>
      resolveSummaryDateRange(
        "2025-02-01T00:00:00.000Z",
        "2025-01-01T00:00:00.000Z"
      ),
    /from after to/
  );
});
