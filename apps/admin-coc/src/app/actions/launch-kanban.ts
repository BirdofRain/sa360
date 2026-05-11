"use server";

import {
  createAdminKanbanCard,
  reorderAdminKanbanBoard,
  updateAdminKanbanCard,
} from "@/lib/admin-api/server";
import type {
  AdminKanbanCard,
  AdminKanbanCardCreate,
  AdminKanbanCardUpdate,
  AdminKanbanReorderItem,
} from "@/lib/admin-api/types";

export type LaunchKanbanActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Server actions for the launch-kanban client board. Each action wraps a
 * single admin-API call and returns a tagged result so the client can flip
 * its save-state chip and (on failure) restore optimistic state.
 *
 * Auth: actions run server-side and use SA360_ADMIN_API_KEY directly via
 * the admin-api helpers. The admin key is never serialized to the browser.
 */

export async function updateLaunchKanbanCardAction(
  id: string,
  patch: AdminKanbanCardUpdate
): Promise<LaunchKanbanActionResult<AdminKanbanCard>> {
  const res = await updateAdminKanbanCard(id, patch);
  if (!res.card) return { ok: false, error: res.error ?? "Update failed" };
  return { ok: true, data: res.card };
}

export async function reorderLaunchKanbanBoardAction(
  boardKey: string,
  items: AdminKanbanReorderItem[]
): Promise<LaunchKanbanActionResult<AdminKanbanCard[]>> {
  const res = await reorderAdminKanbanBoard(boardKey, items);
  if (!res.cards) return { ok: false, error: res.error ?? "Reorder failed" };
  return { ok: true, data: res.cards };
}

export async function createLaunchKanbanCardAction(
  input: AdminKanbanCardCreate
): Promise<LaunchKanbanActionResult<AdminKanbanCard>> {
  const res = await createAdminKanbanCard(input);
  if (!res.card) return { ok: false, error: res.error ?? "Create failed" };
  return { ok: true, data: res.card };
}
