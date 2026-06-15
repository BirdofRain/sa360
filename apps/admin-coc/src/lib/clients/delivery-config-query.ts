export function buildClientDeliveryConfigHref(input: {
  clientAccountId: string;
  locationId?: string;
}): string {
  const id = input.clientAccountId.trim();
  const params = new URLSearchParams();
  if (input.locationId?.trim()) params.set("locationId", input.locationId.trim());
  const qs = params.toString();
  return qs
    ? `/clients/${encodeURIComponent(id)}/delivery-config?${qs}`
    : `/clients/${encodeURIComponent(id)}/delivery-config`;
}

export function parseClientDeliveryConfigSearchParams(
  sp: Record<string, string | string[] | undefined>
): { locationId: string } {
  const raw = sp.locationId;
  const locationId =
    typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? (raw[0]?.trim() ?? "") : "";
  return { locationId };
}
