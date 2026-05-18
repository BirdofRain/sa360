import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBoardProgress,
  computeWorkstreamProgress,
  dueLocalDayStartMs,
  getLocalWeekRangeMs,
  isDueOverdue,
  isDueSoon,
  isDueThisCalendarWeek,
  startOfLocalDayMs,
} from "./launch-kanban-metrics.ts";
import type { LaunchKanbanCard } from "./launch-kanban-types.ts";

function card(partial: Partial<LaunchKanbanCard> & Pick<LaunchKanbanCard, "id">): LaunchKanbanCard {
  return {
    boardKey: "b",
    title: "t",
    description: "",
    status: "TO DO",
    workstream: "WS",
    priority: "P2",
    dueDate: null,
    owner: null,
    blocked: false,
    dependencyCount: 0,
    tags: [],
    acceptanceCriteria: null,
    dependencies: null,
    notes: null,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

test("getLocalWeekRangeMs: Wed Jan 15 2025 spans Mon Jan 13 – Sun Jan 19", () => {
  const now = new Date(2025, 0, 15, 15, 0, 0);
  const { weekStart, weekEndExclusive } = getLocalWeekRangeMs(now);
  assert.equal(weekStart, startOfLocalDayMs(new Date(2025, 0, 13)));
  assert.equal(weekEndExclusive - weekStart, 7 * 86400000);
  assert.ok(isDueThisCalendarWeek(card({ id: "1", dueDate: new Date(2025, 0, 19).toISOString() }), now));
  assert.equal(isDueThisCalendarWeek(card({ id: "2", dueDate: new Date(2025, 0, 20).toISOString() }), now), false);
});

test("isDueOverdue excludes DONE and uses local midnight", () => {
  const now = new Date(2025, 0, 15, 12, 0, 0);
  assert.equal(isDueOverdue(card({ id: "a", dueDate: new Date(2025, 0, 14).toISOString(), status: "DOING" }), now), true);
  assert.equal(isDueOverdue(card({ id: "b", dueDate: new Date(2025, 0, 15).toISOString(), status: "DOING" }), now), false);
  assert.equal(isDueOverdue(card({ id: "c", dueDate: new Date(2025, 0, 14).toISOString(), status: "DONE" }), now), false);
});

test("isDueSoon: within soonDays, not overdue", () => {
  const now = new Date(2025, 0, 15, 12, 0, 0);
  assert.equal(isDueSoon(card({ id: "x", dueDate: new Date(2025, 0, 16).toISOString(), status: "TO DO" }), now, 3), true);
  assert.equal(isDueSoon(card({ id: "y", dueDate: new Date(2025, 0, 14).toISOString(), status: "TO DO" }), now, 3), false);
});

test("computeBoardProgress aggregates counts", () => {
  const now = new Date(2025, 0, 15, 12, 0, 0);
  const cards = [
    card({ id: "1", status: "DONE", blocked: false }),
    card({ id: "2", status: "TO DO", blocked: true }),
    card({
      id: "3",
      status: "DOING",
      dueDate: new Date(2025, 0, 14).toISOString(),
    }),
    card({
      id: "4",
      status: "TO DO",
      dueDate: new Date(2025, 0, 17).toISOString(),
    }),
  ];
  const s = computeBoardProgress(cards, now);
  assert.equal(s.total, 4);
  assert.equal(s.done, 1);
  assert.equal(s.blocked, 1);
  assert.equal(s.percentComplete, 25);
  assert.equal(s.overdue, 1);
  assert.equal(s.dueThisWeek, 2);
});

test("computeWorkstreamProgress groups by workstream", () => {
  const cards = [
    card({ id: "1", workstream: "A", status: "DONE" }),
    card({ id: "2", workstream: "A", status: "TO DO", blocked: true }),
    card({ id: "3", workstream: "B", status: "DONE" }),
  ];
  const rows = computeWorkstreamProgress(cards);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.workstream === "A");
  assert.ok(a);
  assert.equal(a!.total, 2);
  assert.equal(a!.done, 1);
  assert.equal(a!.blocked, 1);
  assert.equal(a!.percentComplete, 50);
});

test("dueLocalDayStartMs returns null for bad input", () => {
  assert.equal(dueLocalDayStartMs(null), null);
  assert.equal(dueLocalDayStartMs(""), null);
  assert.equal(dueLocalDayStartMs("not-a-date"), null);
});
