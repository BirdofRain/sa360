import "server-only";

import { adminFetchJson } from "@/lib/admin-api/server";
import { formatAdminApiError } from "@/lib/admin-api/admin-api-error";

export async function fetchAdminClientCampaignInventory(clientAccountId: string): Promise<{
  data: unknown;
  error: string | null;
  status: number;
}> {
  const id = clientAccountId.trim();
  if (!id) return { data: null, error: "Missing clientAccountId", status: 400 };
  const res = await adminFetchJson<unknown>(
    `/admin/v1/clients/${encodeURIComponent(id)}/campaign-inventory`
  );
  if (!res.ok) return { data: null, error: formatAdminApiError(res), status: res.status };
  return { data: res.data, error: null, status: 200 };
}
