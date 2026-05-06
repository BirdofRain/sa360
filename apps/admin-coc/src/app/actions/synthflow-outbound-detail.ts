"use server";

import { fetchAdminSynthflowOutboundResultDetail } from "@/lib/admin-api/server";

export async function loadSynthflowOutboundDetailAction(id: string) {
  return fetchAdminSynthflowOutboundResultDetail(id);
}
