import "server-only";

import { adminFetchJson } from "@/lib/admin-api/server";

export type FrontOfficeDemandQueueItem = {
  orderId: string;
  orderNumber: string;
  clientAccountId: string;
  demandType: "PAY_PER_LEAD" | "RETAINER" | "UNKNOWN";
  campaignId: string | null;
  nicheKey: string;
  status: string;
  targetQuantity: number;
  delivered: number;
  remaining: number;
  deliveryHealth: string;
};

export async function getDemandQueueForClient(clientAccountId: string): Promise<{
  ok: boolean;
  items: FrontOfficeDemandQueueItem[];
  error?: string;
}> {
  const params = new URLSearchParams({
    clientAccountId,
    clientScoped: "true",
  });
  const res = await adminFetchJson<{ ok: boolean; items: FrontOfficeDemandQueueItem[] }>(
    `/admin/v1/demand-queue?${params.toString()}`
  );
  if (!res.ok) {
    return { ok: false, items: [], error: res.body };
  }
  return { ok: true, items: res.data.items ?? [] };
}
