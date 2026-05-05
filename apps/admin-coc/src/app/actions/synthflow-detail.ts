"use server";

import { fetchAdminSynthflowRequestDetail } from "@/lib/admin-api/server";

export async function loadSynthflowDetailAction(id: string) {
  return fetchAdminSynthflowRequestDetail(id);
}
