"use server";

import { fetchAdminWebhookRequestDetail } from "@/lib/admin-api/server";

export async function loadWebhookDetailAction(id: string) {
  return fetchAdminWebhookRequestDetail(id);
}
