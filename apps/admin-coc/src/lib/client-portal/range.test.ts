import test from "node:test";
import assert from "node:assert/strict";
import { parseClientPortalRange, rangeLabel, resolveRangeBounds } from "./range.ts";

test("parseClientPortalRange defaults to 7d", () => {
  assert.equal(parseClientPortalRange(undefined), "7d");
  assert.equal(parseClientPortalRange(""), "7d");
  assert.equal(parseClientPortalRange("invalid"), "7d");
});

test("parseClientPortalRange accepts known keys", () => {
  assert.equal(parseClientPortalRange("30d"), "30d");
  assert.equal(parseClientPortalRange("MTD"), "mtd");
});

test("rangeLabel returns human labels", () => {
  assert.equal(rangeLabel("7d"), "Last 7 days");
  assert.equal(rangeLabel("mtd"), "Month to date");
});

test("resolveRangeBounds 7d spans seven calendar days", () => {
  const now = new Date("2026-05-19T15:00:00.000Z");
  const { from, to } = resolveRangeBounds("7d", now);
  const diffDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
  assert.ok(diffDays >= 6 && diffDays <= 7);
});
