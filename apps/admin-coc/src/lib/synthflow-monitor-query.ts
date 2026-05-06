/** URL ↔ admin API query mapping for the Synthflow Voice Monitor. */

import type { AdminSynthflowListItem } from "@/lib/admin-api/types";
import { isRecognizableTestDevRow } from "@/lib/synthflow-monitor-badges";

export type SynthflowTestDevFilter = "only" | "hide";

export type SynthflowMonitorUrlQuery = {
  knownCaller?: string;
  lookupStatus?: string;
  matchedBy?: string;
  clientAccountId?: string;
  from?: string;
  to?: string;
  /** Client-side filter: `only` = test/dev heuristics only; `hide` = exclude them. */
  testDev?: SynthflowTestDevFilter;
};

export function parseSynthflowMonitorSearchParams(sp: {
  [key: string]: string | string[] | undefined;
}): SynthflowMonitorUrlQuery {
  const get = (k: string): string | undefined => {
    const v = sp[k];
    const raw = Array.isArray(v) ? v[0] : v;
    return typeof raw === "string" && raw.trim() !== "" ? raw : undefined;
  };

  const td = get("td");
  const testDev: SynthflowTestDevFilter | undefined =
    td === "only" || td === "hide" ? td : undefined;

  return {
    knownCaller: get("kc"),
    lookupStatus: get("ls"),
    matchedBy: get("mb"),
    clientAccountId: get("client"),
    from: get("from"),
    to: get("to"),
    testDev,
  };
}

export function applySynthflowTestDevClientFilter(
  items: AdminSynthflowListItem[],
  testDev: SynthflowTestDevFilter | undefined
): AdminSynthflowListItem[] {
  if (!testDev) {
    return items;
  }
  if (testDev === "only") {
    return items.filter((r) => isRecognizableTestDevRow(r));
  }
  return items.filter((r) => !isRecognizableTestDevRow(r));
}

export type AdminSynthflowFetchParams = {
  limit?: number;
  cursor?: string;
  processingStatus?: string;
  lookupStatus?: string;
  knownCaller?: string;
  matchedBy?: string;
  fromNumber?: string;
  toNumber?: string;
  phoneE164?: string;
  modelId?: string;
  clientAccountId?: string;
  subaccountIdGhl?: string;
  httpStatus?: number;
  from?: string;
  to?: string;
};

export function synthflowMonitorToAdminApiParams(query: SynthflowMonitorUrlQuery): AdminSynthflowFetchParams {
  const params: AdminSynthflowFetchParams = {
    limit: 200,
  };

  const kc = query.knownCaller?.trim();
  if (kc === "true" || kc === "false") params.knownCaller = kc;

  if (query.lookupStatus?.trim()) params.lookupStatus = query.lookupStatus.trim();
  if (query.matchedBy?.trim()) params.matchedBy = query.matchedBy.trim();
  if (query.clientAccountId?.trim()) params.clientAccountId = query.clientAccountId.trim();
  if (query.from?.trim()) params.from = query.from.trim();
  if (query.to?.trim()) params.to = query.to.trim();

  return params;
}
