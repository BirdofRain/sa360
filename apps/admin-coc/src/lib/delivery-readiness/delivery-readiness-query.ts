export type DeliveryReadinessQuery = {
  masterClientAccountId: string;
  clientAccountId: string;
  status: string;
  ruleId: string;
  locationId: string;
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
    ruleId: firstString(sp.ruleId)?.trim() ?? "",
    locationId: firstString(sp.locationId)?.trim() ?? "",
  };
}

/**
 * Build API params. Delivery Readiness defaults to ALL rows: when no master/client filter is
 * specified, params are returned with undefined filters so the API returns every routing rule.
 */
export function deliveryReadinessQueryToApiParams(query: DeliveryReadinessQuery): {
  masterClientAccountId?: string;
  clientAccountId?: string;
  status?: string;
} {
  const master = query.masterClientAccountId.trim();
  const client = query.clientAccountId.trim();
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
  if (query.ruleId.trim()) params.set("ruleId", query.ruleId.trim());
  if (query.locationId.trim()) params.set("locationId", query.locationId.trim());
  const qs = params.toString();
  return qs ? `/delivery-readiness?${qs}` : "/delivery-readiness";
}

export function buildDeliveryReadinessConfigureHref(input: {
  masterClientAccountId?: string;
  clientAccountId?: string;
  ruleId?: string;
  locationId?: string;
}): string {
  return buildDeliveryReadinessHref({
    masterClientAccountId: input.masterClientAccountId?.trim() ?? "",
    clientAccountId: input.clientAccountId?.trim() ?? "",
    status: "",
    ruleId: input.ruleId?.trim() ?? "",
    locationId: input.locationId?.trim() ?? "",
  });
}
