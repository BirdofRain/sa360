"use server";

import { requireAdminCocReadSession } from "@/lib/admin-coc-session-guard";

import { fetchAdminSynthflowRequestDetail } from "@/lib/admin-api/server";

export async function loadSynthflowDetailAction(id: string) {
  await requireAdminCocReadSession();
  return fetchAdminSynthflowRequestDetail(id);
}
