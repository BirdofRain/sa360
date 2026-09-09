"use server";

import { requireAdminCocSession } from "@/lib/admin-coc-session-guard";

import { fetchAdminSynthflowRequestDetail } from "@/lib/admin-api/server";

export async function loadSynthflowDetailAction(id: string) {
  await requireAdminCocSession();
  return fetchAdminSynthflowRequestDetail(id);
}
