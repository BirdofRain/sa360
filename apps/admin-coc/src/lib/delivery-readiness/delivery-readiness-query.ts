export type DeliveryReadinessQuery = {
  masterClientAccountId: string;
  clientAccountId: string;
  status: string;
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

export function parseDeliveryReadinessSearchParams(
  sp: Record<string, string | string[] | undefined>
): DeliveryReadinessQuery {
  return {
    masterClientAccountId: firstString(sp.masterClientAccountId)?.trim() ?? "",
    clientAccountId: firstString(sp.clientAccountId)?.trim() ?? "",
    status: firstString(sp.status)?.trim() ?? "",
  };
}

export function deliveryReadinessQueryToApiParams(query: DeliveryReadinessQuery): {
  masterClientAccountId?: string;
  clientAccountId?: string;
  status?: string;
} | null {
  const master = query.masterClientAccountId.trim();
  const client = query.clientAccountId.trim();
  if (!master && !client) return null;
  return {
    masterClientAccountId: master || undefined,
    clientAccountId: client || undefined,
    status: query.status || undefined,
  };
}

export function buildDeliveryReadinessHref(query: DeliveryReadinessQuery): string {
  const params = new URLSearchParams();
  if (query.masterClientAccountId.trim()) {
    params.set("masterClientAccountId", query.masterClientAccountId.trim());
  }
  if (query.clientAccountId.trim()) params.set("clientAccountId", query.clientAccountId.trim());
  if (query.status.trim()) params.set("status", query.status.trim());
  const qs = params.toString();
  return qs ? `/delivery-readiness?${qs}` : "/delivery-readiness";
}

export function getDeliveryReadinessDefaultMasterClientAccountId(): string {
  return process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID?.trim() ?? "";
}
