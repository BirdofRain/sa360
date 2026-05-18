import test from "node:test";
import assert from "node:assert/strict";
import { nextKanbanSortOrderForStatus } from "./launch-kanban-sort-order.ts";

test("nextKanbanSortOrderForStatus uses max existing order + 10 in column", () => {
  assert.equal(
    nextKanbanSortOrderForStatus(
      [
        { status: "TO DO", sortOrder: 10 },
        { status: "TO DO", sortOrder: 30 },
        { status: "DONE", sortOrder: 99 },
      ],
      "TO DO"
    ),
    40
  );
});

test("nextKanbanSortOrderForStatus defaults to 10 when column empty", () => {
  assert.equal(nextKanbanSortOrderForStatus([{ status: "DONE", sortOrder: 5 }], "TO DO"), 10);
});
