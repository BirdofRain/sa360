/**
 * Local-only planning model for the SA360 beta MVP launch board.
 * No persistence; seed data lives in `launch-kanban-data.ts`. Field shape is
 * stable enough that wiring a future persistence layer (ReviewItem-style table
 * or a generic `LaunchTask` model) is a near-mechanical mapping.
 */

export const LAUNCH_KANBAN_COLUMNS = [
  "BCKLG",
  "SPRINT",
  "TO DO",
  "DOING",
  "VERIFY",
  "DONE",
] as const;

export type KanbanStatus = (typeof LAUNCH_KANBAN_COLUMNS)[number];

export const LAUNCH_KANBAN_PRIORITIES = ["P0", "P1", "P2"] as const;
export type KanbanPriority = (typeof LAUNCH_KANBAN_PRIORITIES)[number];

/** Free-form for now but pinned to a known list to make filters predictable. */
export const LAUNCH_KANBAN_WORKSTREAMS = [
  "Infra & Deploy",
  "API",
  "Admin C.O.C.",
  "Webhooks",
  "Synthflow Voice",
  "Review Queue",
  "Feature Flags",
  "Meta / Signals",
  "Onboarding",
  "Security",
  "Design / Figma",
  "Voice / Dialer",
  "Reporting",
  "Future Platform",
] as const;

export type KanbanWorkstream = (typeof LAUNCH_KANBAN_WORKSTREAMS)[number];

export type KanbanActivityEntry = {
  ts: string;
  message: string;
};

export type LaunchKanbanCard = {
  id: string;
  title: string;
  description: string;
  status: KanbanStatus;
  priority: KanbanPriority;
  workstream: KanbanWorkstream;
  owner?: string;
  dueDate?: string;
  blocked?: boolean;
  betaMvp?: boolean;
  dependencyIds?: string[];
  acceptanceCriteria?: string[];
  notes?: string[];
  activity?: KanbanActivityEntry[];
  updatedAt?: string;
};

export const LAUNCH_KANBAN_SORT_OPTIONS = [
  "manual",
  "priority",
  "due_date",
  "workstream",
  "recently_updated",
] as const;

export type LaunchKanbanSort = (typeof LAUNCH_KANBAN_SORT_OPTIONS)[number];

export type LaunchKanbanFilters = {
  search: string;
  workstream: KanbanWorkstream | "ALL";
  priority: KanbanPriority | "ALL";
  status: KanbanStatus | "ALL";
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
  p0Only: false,
  blockedOnly: false,
  betaMvpOnly: false,
  sort: "manual",
  groupBy: "status",
  density: "comfortable",
};
