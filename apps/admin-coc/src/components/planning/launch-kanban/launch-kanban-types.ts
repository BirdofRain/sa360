/**
 * UI types for the editable launch-kanban board.
 *
 * The card shape is whatever the admin API returns (`AdminKanbanCard`); this
 * file owns the column vocabulary, priorities, filter shape, and save state.
 */

import type { AdminKanbanCard } from "@/lib/admin-api/types";

/** Column order left → right on the board (stakeholder launch view). */
export const LAUNCH_KANBAN_COLUMNS = ["DONE", "DOING", "TO DO", "VERIFY", "BCKLG"] as const;

export type KanbanStatus = (typeof LAUNCH_KANBAN_COLUMNS)[number];

export const LAUNCH_KANBAN_COLUMN_LABELS: Record<KanbanStatus, string> = {
  DONE: "Done",
  DOING: "In Progress This Week",
  "TO DO": "Next",
  VERIFY: "Blocked / Needs Info",
  BCKLG: "Later",
};

export function launchKanbanColumnLabel(status: string): string {
  return LAUNCH_KANBAN_COLUMN_LABELS[status as KanbanStatus] ?? status;
}

export const LAUNCH_KANBAN_PRIORITIES = ["P0", "P1", "P2"] as const;
export type KanbanPriority = (typeof LAUNCH_KANBAN_PRIORITIES)[number];

/** Known workstreams shown in the filter dropdown. The actual card.workstream
 * field is free-form so new workstreams can be added by editing a card. */
export const LAUNCH_KANBAN_WORKSTREAMS = [
  "Infra & Deploy",
  "API",
  "Admin C.O.C.",
  "Client Portal",
  "Routing",
  "Delivery & GHL",
  "Onboarding",
  "Webhooks",
  "Synthflow Voice",
  "Meta / Signals",
  "Security",
  "Future Platform",
] as const;

export const BETA_MVP_TAG = "beta-mvp";

/** Workstream stored when the user leaves workstream blank (API requires non-empty trimmed workstream). */
export const DEFAULT_NEW_CARD_WORKSTREAM = "General";

export const LAUNCH_KANBAN_BOARD_KEY = "sa360_beta_mvp_launch";

/** Public card shape used everywhere in the UI. */
export type LaunchKanbanCard = AdminKanbanCard;

export const LAUNCH_KANBAN_SORT_OPTIONS = [
  "manual",
  "priority",
  "due_date",
  "workstream",
  "recently_updated",
] as const;

export type LaunchKanbanSort = (typeof LAUNCH_KANBAN_SORT_OPTIONS)[number];

export const OWNER_FILTER_UNASSIGNED = "__UNASSIGNED__";

export type LaunchKanbanFilters = {
  search: string;
  workstream: string | "ALL";
  priority: KanbanPriority | "ALL";
  status: KanbanStatus | "ALL";
  /** `ALL`, {@link OWNER_FILTER_UNASSIGNED}, or exact owner string */
  owner: "ALL" | typeof OWNER_FILTER_UNASSIGNED | string;
  /** Open tasks only: due date falls in current Mon–Sun week (local). */
  dueThisWeekOnly: boolean;
  p0Only: boolean;
  blockedOnly: boolean;
  betaMvpOnly: boolean;
  sort: LaunchKanbanSort;
  groupBy: "status" | "workstream";
  density: "compact" | "comfortable";
};

export const DEFAULT_LAUNCH_KANBAN_FILTERS: LaunchKanbanFilters = {
  search: "",
  workstream: "ALL",
  priority: "ALL",
  status: "ALL",
  owner: "ALL",
  dueThisWeekOnly: false,
  p0Only: false,
  blockedOnly: false,
  betaMvpOnly: false,
  sort: "manual",
  groupBy: "status",
  density: "comfortable",
};

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "failed"; message: string };

export function isBetaMvpCard(card: LaunchKanbanCard): boolean {
  return Array.isArray(card.tags) && card.tags.includes(BETA_MVP_TAG);
}
