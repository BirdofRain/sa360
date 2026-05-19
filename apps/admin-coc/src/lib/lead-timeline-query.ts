export type LeadTimelineFetchParams = {
  clientAccountId?: string;
  subaccountIdGhl?: string;
  leadUid?: string;
  contactIdGhl?: string;
  phoneE164?: string;
  email?: string;
  requestId?: string;
  sort?: "asc" | "desc";
  limit?: number;
};

export function buildLeadTimelineQueryString(params: LeadTimelineFetchParams): string {
  const searchParams = new URLSearchParams();
  if (params.clientAccountId) searchParams.set("clientAccountId", params.clientAccountId);
  if (params.subaccountIdGhl) searchParams.set("subaccountIdGhl", params.subaccountIdGhl);
  if (params.leadUid) searchParams.set("leadUid", params.leadUid);
  if (params.contactIdGhl) searchParams.set("contactIdGhl", params.contactIdGhl);
  if (params.phoneE164) searchParams.set("phoneE164", params.phoneE164);
  if (params.email) searchParams.set("email", params.email);
  if (params.requestId) searchParams.set("requestId", params.requestId);
  if (params.sort) searchParams.set("sort", params.sort);
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  return searchParams.toString();
}

export function leadTimelinePageHref(params: LeadTimelineFetchParams): string {
  const qs = buildLeadTimelineQueryString(params);
  return qs ? `/lead-timeline?${qs}` : "/lead-timeline";
}
