import { EmptyState } from "@/components/dashboard/empty-state";
import { WarningBanner } from "@/components/dashboard/warning-banner";
import { PlanningSafetyCallout } from "@/components/planning/planning-safety-callout";
import { LaunchKanbanBoard } from "@/components/planning/launch-kanban/launch-kanban-board";
import { LAUNCH_KANBAN_BOARD_KEY } from "@/components/planning/launch-kanban/launch-kanban-types";
import { fetchAdminKanbanBoard, isAdminApiConfigured } from "@/lib/admin-api/server";

/**
 * Internal launch-kanban surface. Cards are persisted via the admin API
 * (`/admin/v1/kanban/*`); the first GET seeds the canonical beta-mvp board.
 *
 * When the admin API isn't configured (no `NEXT_PUBLIC_API_BASE_URL` or no
 * server-only admin key), we render a configuration warning instead of trying
 * to mount the board with empty state — that keeps the local-dev story clean.
 */
export default async function LaunchKanbanPage() {
  if (!isAdminApiConfigured()) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Admin API not configured">
          Set NEXT_PUBLIC_API_BASE_URL and SA360_ADMIN_API_KEY (or ADMIN_API_KEY) for this
          Next.js app, then restart the dev server. The launch-kanban needs the admin API
          to persist card edits and drag/drop moves.
        </WarningBanner>
        <EmptyState
          title="Launch kanban unavailable"
          hint="Configure the admin API to start using the board."
          className="rounded-xl border border-slate-200 bg-white py-16"
        />
      </div>
    );
  }

  const { board, error } = await fetchAdminKanbanBoard(LAUNCH_KANBAN_BOARD_KEY);
  if (!board) {
    return (
      <div className="space-y-4">
        <WarningBanner tone="warn" title="Could not load launch kanban">
          {error ?? "Unknown error fetching the board."}
        </WarningBanner>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PlanningSafetyCallout />
      <LaunchKanbanBoard initialCards={board.cards} boardKey={board.boardKey} />
    </div>
  );
}
