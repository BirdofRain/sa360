"use server";

import { requireAdminCocSession } from "@/lib/admin-coc-session-guard";

import { fetchAdminSynthflowOutboundResultDetail } from "@/lib/admin-api/server";

export async function loadSynthflowOutboundDetailAction(id: string) {
  await requireAdminCocSession();
  return fetchAdminSynthflowOutboundResultDetail(id);
}
