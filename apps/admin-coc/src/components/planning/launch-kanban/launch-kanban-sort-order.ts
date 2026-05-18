import type { KanbanStatus } from "./launch-kanban-types";

/** Next `sortOrder` for a new card at the end of a status column (matches drag-renumber step of 10). */
export function nextKanbanSortOrderForStatus(
  cards: ReadonlyArray<{ status: string; sortOrder: number }>,
  status: KanbanStatus
): number {
  let max = 0;
  for (const c of cards) {
    if (c.status === status && c.sortOrder > max) max = c.sortOrder;
  }
  return max + 10;
}
