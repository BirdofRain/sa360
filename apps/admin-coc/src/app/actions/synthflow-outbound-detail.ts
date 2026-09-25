"use server";

import { requireAdminCocReadSession } from "@/lib/admin-coc-session-guard";

import { fetchAdminSynthflowOutboundResultDetail } from "@/lib/admin-api/server";

export async function loadSynthflowOutboundDetailAction(id: string) {
  await requireAdminCocReadSession();
  return fetchAdminSynthflowOutboundResultDetail(id);
}
