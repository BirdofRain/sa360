import { LaunchKanbanBoard } from "@/components/planning/launch-kanban/launch-kanban-board";
import { LAUNCH_KANBAN_SEED } from "@/components/planning/launch-kanban/launch-kanban-data";

/**
 * Internal planning surface — SA360 beta MVP launch board.
 * Pure local seed data; no admin API call. Drag/drop is intentionally not
 * wired (handle markup is ready for a future dnd-kit integration).
 */
export default function LaunchKanbanPage() {
  return <LaunchKanbanBoard seed={LAUNCH_KANBAN_SEED} />;
}
