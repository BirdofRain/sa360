"use server";

import { requireAdminCocSession } from "@/lib/admin-coc-session-guard";

import { fetchAdminWebhookRequestDetail } from "@/lib/admin-api/server";

export async function loadWebhookDetailAction(id: string) {
  await requireAdminCocSession();
  return fetchAdminWebhookRequestDetail(id);
}
