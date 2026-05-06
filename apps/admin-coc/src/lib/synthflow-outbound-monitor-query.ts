/** URL ↔ admin API query mapping for Synthflow outbound result logs. */

import type { AdminSynthflowOutboundResultListItem } from "@/lib/admin-api/types";

export type SynthflowOutboundTab = "requests" | "outbound";

export type OutboundBookedFilter = "any" | "yes" | "no";

export type SynthflowOutboundMonitorUrlQuery = {
  outcome?: string;
  booked?: OutboundBookedFilter;
  clientAccountId?: string;
  contactIdGhl?: string;
  callId?: string;
  modelId?: string;
  from?: string;
  to?: string;
};

export function parseSynthflowVoiceMonitorTab(sp: {
  [key: string]: string | string[] | undefined;
}): SynthflowOutboundTab {
  const v = sp.tab;
  const raw = Array.isArray(v) ? v[0] : v;
  return raw === "outbound" ? "outbound" : "requests";
}

/** Preserve all query params while switching tabs; default tab omits `tab`. */
export function buildSynthflowVoiceMonitorHref(
  sp: Record<string, string | string[] | undefined>,
  tab: SynthflowOutboundTab
): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (k === "tab") continue;
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === "string" && val.trim() !== "") next.set(k, val.trim());
  }
  if (tab === "outbound") next.set("tab", "outbound");
  const qs = next.toString();
  return qs ? `/synthflow?${qs}` : "/synthflow";
}

export function parseSynthflowOutboundMonitorSearchParams(sp: {
  [key: string]: string | string[] | undefined;
}): SynthflowOutboundMonitorUrlQuery {
  const get = (k: string): string | undefined => {
    const v = sp[k];
    const raw = Array.isArray(v) ? v[0] : v;
    return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
  };

  const bookedRaw = get("obk");
  let booked: OutboundBookedFilter | undefined;
  if (bookedRaw === "yes") booked = "yes";
  else if (bookedRaw === "no") booked = "no";

  return {
    outcome: get("oor"),
    booked,
    clientAccountId: get("ocl"),
    contactIdGhl: get("occ"),
    callId: get("oci"),
    modelId: get("omd"),
    from: get("from"),
    to: get("to"),
  };
}

export type AdminSynthflowOutboundFetchParams = {
  limit?: number;
  cursor?: string;
  outcome?: string;
  clientAccountId?: string;
  subaccountIdGhl?: string;
  contactIdGhl?: string;
  callId?: string;
  modelId?: string;
  from?: string;
  to?: string;
};

export function synthflowOutboundMonitorToAdminApiParams(
  query: SynthflowOutboundMonitorUrlQuery
): AdminSynthflowOutboundFetchParams {
  const params: AdminSynthflowOutboundFetchParams = {
    limit: 200,
  };

  if (query.outcome?.trim()) params.outcome = query.outcome.trim();
  if (query.clientAccountId?.trim()) params.clientAccountId = query.clientAccountId.trim();
  if (query.contactIdGhl?.trim()) params.contactIdGhl = query.contactIdGhl.trim();
  if (query.callId?.trim()) params.callId = query.callId.trim();
  if (query.modelId?.trim()) params.modelId = query.modelId.trim();
  if (query.from?.trim()) params.from = query.from.trim();
  if (query.to?.trim()) params.to = query.to.trim();

  return params;
}

/** Backend has no `booked` query param — filter the fetched page client-side. */
export function applyOutboundBookedClientFilter(
  items: AdminSynthflowOutboundResultListItem[],
  booked: OutboundBookedFilter | undefined
): AdminSynthflowOutboundResultListItem[] {
  if (!booked || booked === "any") {
    return items;
  }
  if (booked === "yes") {
    return items.filter((r) => r.booked === true);
  }
  return items.filter((r) => r.booked === false);
}
