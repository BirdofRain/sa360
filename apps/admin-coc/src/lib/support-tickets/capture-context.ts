import type { SupportTicketContextOverride, SupportTicketCreateInput } from "./types";

const QUERY_ID_KEYS = [
  "masterClientAccountId",
  "clientAccountId",
  "subaccountIdGhl",
  "destinationSubaccountIdGhl",
] as const;

export function parseQueryParams(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!search || search === "?") return out;
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.forEach((value, key) => {
    const v = value.trim();
    if (v) out[key] = v;
  });
  return out;
}

export function extractIdsFromQuery(query: Record<string, string>) {
  return {
    masterClientAccountId: query.masterClientAccountId,
    clientAccountId: query.clientAccountId,
    subaccountIdGhl: query.subaccountIdGhl ?? query.destinationSubaccountIdGhl,
  };
}

/** Client-side page context for support ticket auto-fill. */
export function captureSupportPageContext(
  override: SupportTicketContextOverride = {}
): Pick<
  SupportTicketCreateInput,
  | "pagePath"
  | "pageUrl"
  | "queryJson"
  | "contextJson"
  | "userAgent"
  | "clientAccountId"
  | "masterClientAccountId"
  | "subaccountIdGhl"
  | "relatedEntityType"
  | "relatedEntityId"
> {
  if (typeof window === "undefined") {
    return {
      relatedEntityType: override.relatedEntityType,
      relatedEntityId: override.relatedEntityId,
      clientAccountId: override.clientAccountId,
      masterClientAccountId: override.masterClientAccountId,
      subaccountIdGhl: override.subaccountIdGhl,
      contextJson: override.contextJson,
    };
  }

  const queryJson = parseQueryParams(window.location.search);
  const ids = extractIdsFromQuery(queryJson);

  return {
    pagePath: window.location.pathname,
    pageUrl: window.location.href,
    queryJson,
    userAgent: navigator.userAgent,
    masterClientAccountId: override.masterClientAccountId ?? ids.masterClientAccountId,
    clientAccountId: override.clientAccountId ?? ids.clientAccountId,
    subaccountIdGhl: override.subaccountIdGhl ?? ids.subaccountIdGhl,
    relatedEntityType: override.relatedEntityType,
    relatedEntityId: override.relatedEntityId,
    contextJson: {
      capturedAt: new Date().toISOString(),
      queryKeys: QUERY_ID_KEYS.filter((k) => queryJson[k]),
      ...override.contextJson,
    },
  };
}
