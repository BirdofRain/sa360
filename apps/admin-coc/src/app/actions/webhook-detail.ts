"use server";

import { requireAdminCocReadSession } from "@/lib/admin-coc-session-guard";

import { fetchAdminWebhookRequestDetail } from "@/lib/admin-api/server";

export async function loadWebhookDetailAction(id: string) {
  await requireAdminCocReadSession();
  return fetchAdminWebhookRequestDetail(id);
}
