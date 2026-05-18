/**
 * Pure progress / due-date helpers for Launch Kanban (local calendar semantics).
 */

import type { LaunchKanbanCard } from "./launch-kanban-types";

export const KANBAN_DONE_STATUS = "DONE";

export function startOfLocalDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function dueLocalDayStartMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const t = Date.parse(iso.trim());
  if (Number.isNaN(t)) return null;
  return startOfLocalDayMs(new Date(t));
}

/** Monday 00:00 through following Monday exclusive, local time. */
export function getLocalWeekRangeMs(now: Date): { weekStart: number; weekEndExclusive: number } {
  const todayStart = startOfLocalDayMs(now);
  const dow = new Date(todayStart).getDay();
  const daysFromMonday = (dow + 6) % 7;
  const weekStart = todayStart - daysFromMonday * 86400000;
  return { weekStart, weekEndExclusive: weekStart + 7 * 86400000 };
}

export function isCardDone(card: Pick<LaunchKanbanCard, "status">): boolean {
  return card.status === KANBAN_DONE_STATUS;
}

export function isDueOverdue(
  card: Pick<LaunchKanbanCard, "dueDate" | "status">,
  now: Date
): boolean {
  if (isCardDone(card)) return false;
  const due = dueLocalDayStartMs(card.dueDate);
  if (due === null) return false;
  return due < startOfLocalDayMs(now);
}

export function isDueThisCalendarWeek(
  card: Pick<LaunchKanbanCard, "dueDate">,
  now: Date
): boolean {
  const due = dueLocalDayStartMs(card.dueDate);
  if (due === null) return false;
  const { weekStart, weekEndExclusive } = getLocalWeekRangeMs(now);
  return due >= weekStart && due < weekEndExclusive;
}

/** Actionable: open task due through end of local today + `soonDays`. */
export function isDueSoon(
  card: Pick<LaunchKanbanCard, "dueDate" | "status">,
  now: Date,
  soonDays = 3
): boolean {
  if (isCardDone(card)) return false;
  if (isDueOverdue(card, now)) return false;
  const due = dueLocalDayStartMs(card.dueDate);
  if (due === null) return false;
  const todayStart = startOfLocalDayMs(now);
  const soonEndInclusive = todayStart + soonDays * 86400000;
  return due <= soonEndInclusive;
}

export type BoardProgressSummary = {
  total: number;
  done: number;
  blocked: number;
  percentComplete: number;
  overdue: number;
  /** Open tasks with a due date falling in the current Mon–Sun week (local). */
  dueThisWeek: number;
};

export function computeBoardProgress(cards: LaunchKanbanCard[], now: Date): BoardProgressSummary {
  let done = 0;
  let blocked = 0;
  let overdue = 0;
  let dueThisWeek = 0;
  for (const c of cards) {
    if (isCardDone(c)) done++;
    if (c.blocked) blocked++;
    if (isDueOverdue(c, now)) overdue++;
    if (!isCardDone(c) && isDueThisCalendarWeek(c, now)) dueThisWeek++;
  }
  const total = cards.length;
  const percentComplete = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, blocked, percentComplete, overdue, dueThisWeek };
}

export type WorkstreamProgressRow = {
  workstream: string;
  total: number;
  done: number;
  blocked: number;
  percentComplete: number;
};

export function computeWorkstreamProgress(cards: LaunchKanbanCard[]): WorkstreamProgressRow[] {
  const map = new Map<
    string,
    { total: number; done: number; blocked: number }
  >();
  for (const c of cards) {
    const ws = c.workstream?.trim() || "—";
    const cur = map.get(ws) ?? { total: 0, done: 0, blocked: 0 };
    cur.total++;
    if (isCardDone(c)) cur.done++;
    if (c.blocked) cur.blocked++;
    map.set(ws, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([workstream, v]) => ({
      workstream,
      total: v.total,
      done: v.done,
      blocked: v.blocked,
      percentComplete: v.total === 0 ? 0 : Math.round((v.done / v.total) * 100),
    }));
}
